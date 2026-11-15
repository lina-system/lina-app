import { SETTINGS_HISTORY, type ChangeEvent, type ChangeMessage } from "../api/client";
import type { ChangeSocket } from "./source";
import type { Store, Want } from "./store";

/** First retry after a failure, and the longest wait between two tries; each failure doubles the wait. */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/**
 * How long a dropped stream must stay down before the store says `down` (lina-app#150): a drop the reconnect mends
 * sooner never shows, so the header cannot alternate 실시간 and 갱신 지연 faster than this. A reconnect says `open` at once.
 * A stream that was never open stays `connecting` however long its first connection takes (lina-app#172). A hidden tab
 * closes its socket without saying `down`; the settle time starts when it is shown again (lina-app#176).
 */
export const LIVE_SETTLE_MS = 3_000;

/** The wait before try `attempt` (0 = the first retry): doubling up to the cap, then a random half to all of it. */
export function backoffMs(attempt: number, random: () => number): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(cap * (0.5 + random() / 2));
}

/** The settings and their history (each limit only when a screen read it): a settings event, and the page shown again. */
export const SETTINGS_ROUTES: Want = [["settings"], ["settingsHistory", SETTINGS_HISTORY.recent], ["settingsHistory", SETTINGS_HISTORY.all]];

/** A new revision of the settings, written here or elsewhere: the settings, their history and the model list, whose warnings follow the settings. */
export const SETTINGS_REVISED: Want = [...SETTINGS_ROUTES, ["settingsModels"]];

/**
 * The routes one change touches. work: the record's to-dos and goals (board, items, the item); worker: a worker run
 * (board, and the cards that list it); kanban: a work card or goal card (cards, goals, inbox, the card, the goal);
 * settings: a new revision of the work settings (the settings, their history and the model list).
 */
export function routesFor(events: readonly ChangeEvent[], store: Pick<Store, "cardsWithRun">): Want {
  const routes: (readonly [Parameters<Store["get"]>[0], string?])[] = [];
  for (const event of events) {
    switch (event.source) {
      case "work":
        routes.push(["board"], ["items"], ["item", event.id]);
        break;
      case "worker":
        // A worker run's change: the board, the cards that list it and its own record (read only when a screen read it).
        routes.push(["board"], ["record", event.id], ...store.cardsWithRun(event.id).map((id) => ["card", id] as const));
        break;
      case "kanban":
        routes.push(["cards"], ["goals"], ["inbox"], ["card", event.id], ["goal", event.id]);
        break;
      case "settings":
        routes.push(...SETTINGS_REVISED);
        break;
    }
  }
  return routes;
}

export interface LiveHost {
  readonly document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  addEventListener(type: "online" | "pageshow", listener: () => void): void;
  removeEventListener(type: "online" | "pageshow", listener: () => void): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  readonly random: () => number;
}

const browserHost = (): LiveHost => ({
  document,
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
  random: Math.random,
});

/**
 * The app's one change stream, opened through the store's source. A reconnect (after sleep, a network change, or the
 * tab shown again) resumes with the last cursor as `since` and gets what it missed. A page opened from the store's
 * kept copy resumes from the copy's cursor and reads only what the missed events touch (lina-app#194). A resync
 * reads every snapshot once. A failed or dropped connection tries again after a doubling, jittered wait; nothing
 * polls. Once an open stream has had no connection for LIVE_SETTLE_MS, the store says `down` and the freshness line
 * says the screens may be stale; until the first connection opens it says `connecting`.
 */
export class Live {
  cursor: string | null = null;
  private socket: ChangeSocket | null = null;
  private timer: number | null = null;
  /** Runs out LIVE_SETTLE_MS after the stream dropped, unless a connection opened meanwhile. */
  private settling: number | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly host: LiveHost = browserHost(),
  ) {}

  /** Reads every snapshot, or none when the store opened from its kept copy, and opens the stream; the returned function closes it for good. */
  start(): () => void {
    const onVisibility = () => {
      if (this.host.document.visibilityState === "hidden") {
        this.pause();
        return;
      }
      // The core turns an edit made outside the app into a revision only when the settings are read: a page that read
      // them reads them again when it is shown.
      if (this.store.status("settings") !== "pending") void this.store.invalidate(SETTINGS_ROUTES);
      this.resume();
    };
    const onResume = () => this.resume();
    this.host.document.addEventListener("visibilitychange", onVisibility);
    this.host.addEventListener("online", onResume);
    this.host.addEventListener("pageshow", onResume);
    if (this.store.restored !== null) {
      // The kept copy is on screen: nothing is read before the stream says what changed since its cursor.
      this.cursor = this.store.restored;
      if (this.host.document.visibilityState !== "hidden") this.connect();
    } else {
      void this.store.refresh();
      // The stream draws nothing on the first screen: it opens once the first refresh has landed (lina-app#186).
      void this.store.painted.then(() => {
        if (!this.stopped && !this.socket && this.timer === null && this.host.document.visibilityState !== "hidden") this.connect();
      });
    }
    return () => {
      this.stopped = true;
      this.pause();
      this.host.document.removeEventListener("visibilitychange", onVisibility);
      this.host.removeEventListener("online", onResume);
      this.host.removeEventListener("pageshow", onResume);
    };
  }

  /**
   * A hidden tab closes its socket; showing it again resumes from the cursor. Nobody reads the line meanwhile, so it
   * keeps its word: shown again, it says `down` only if the reconnect has not landed within the settle time.
   */
  private pause(): void {
    this.clearTimer();
    this.clearSettling();
    this.socket?.close();
    this.socket = null;
  }

  /** Now, not after the wait: the tab is back or the network changed. A denied page tries one more renewal. */
  private resume(): void {
    if (this.stopped || this.socket || this.host.document.visibilityState === "hidden") return;
    this.store.credentialTaken();
    this.clearTimer();
    this.attempt = 0;
    this.wentDown();
    this.connect();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.host.clearTimeout(this.timer);
    this.timer = null;
  }

  private clearSettling(): void {
    if (this.settling !== null) this.host.clearTimeout(this.settling);
    this.settling = null;
  }

  /** The stream dropped: `down` only once it has stayed down for the settle time, and only if it was ever open. */
  private wentDown(): void {
    if (this.settling !== null || this.store.live !== "open") return;
    this.settling = this.host.setTimeout(() => {
      this.settling = null;
      this.store.setLive("down");
    }, LIVE_SETTLE_MS);
  }

  private connect(): void {
    const since = this.cursor;
    let first = true;
    const socket = this.store.source.changes(since, {
      message: (message) => {
        if (this.socket !== socket) return;
        if (first) {
          first = false;
          this.attempt = 0;
          this.store.credentialTaken();
          this.clearSettling();
          this.store.setLive("open");
        }
        this.receive(message, since === null && this.cursor === null);
      },
      closed: (refused) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.wentDown();
        if (!refused) {
          this.retry();
          return;
        }
        // Turned away at the upgrade: read the credential again and come back at once with the same cursor (a cursor
        // the core no longer keeps gets one resync); denied after a renewal, stop; the core unreachable, wait as usual.
        void this.store.credentialRefused().then((again) => {
          if (this.stopped || this.socket || this.timer !== null) return;
          if (again) {
            this.attempt = 0;
            this.connect();
          } else if (!this.store.denied) this.retry();
        });
      },
    });
    this.socket = socket;
  }

  private receive(message: ChangeMessage, fromTail: boolean): void {
    this.cursor = message.cursor;
    // The first tail has no events; anything written between the first snapshot and it is read once more.
    if ("resync" in message || fromTail) void this.store.refresh();
    else if (message.events.length) void this.store.invalidate(routesFor(message.events, this.store));
    // After those reads land, the store is current at this cursor.
    void this.store.caughtUp(message.cursor);
  }

  private retry(): void {
    if (this.stopped || this.host.document.visibilityState === "hidden") return;
    const wait = backoffMs(this.attempt, this.host.random);
    this.attempt += 1;
    this.timer = this.host.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, wait);
  }
}

export function startLive(store: Store, host?: LiveHost): () => void {
  return new Live(store, host).start();
}
