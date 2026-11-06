import { SETTINGS_HISTORY, type ChangeEvent, type ChangeMessage } from "../api/client";
import type { ChangeSocket } from "./source";
import type { Store, Want } from "./store";

/** First retry after a failure, and the longest wait between two tries; each failure doubles the wait. */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

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
 * The app's one change stream, opened through the store's source. The last cursor stays in memory: a reconnect
 * (after sleep, a network change, or the tab shown again) resumes with `since` and gets what it missed. A resync
 * reads every snapshot once. A failed or dropped connection tries again after a doubling, jittered wait; nothing
 * polls. While no connection is open, the store says `down` and the freshness line says the screens may be stale.
 */
export class Live {
  cursor: string | null = null;
  private socket: ChangeSocket | null = null;
  private timer: number | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly host: LiveHost = browserHost(),
  ) {}

  /** Reads every snapshot and opens the stream; the returned function closes it for good. */
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
    void this.store.refresh();
    if (this.host.document.visibilityState !== "hidden") this.connect();
    return () => {
      this.stopped = true;
      this.pause();
      this.host.document.removeEventListener("visibilitychange", onVisibility);
      this.host.removeEventListener("online", onResume);
      this.host.removeEventListener("pageshow", onResume);
    };
  }

  /** A hidden tab closes its socket; showing it again resumes from the cursor. */
  private pause(): void {
    this.clearTimer();
    this.socket?.close();
    this.socket = null;
    if (this.store.live === "open") this.store.setLive("down");
  }

  /** Now, not after the wait: the tab is back or the network changed. A denied page tries one more renewal. */
  private resume(): void {
    if (this.stopped || this.socket || this.host.document.visibilityState === "hidden") return;
    this.store.credentialTaken();
    this.clearTimer();
    this.attempt = 0;
    this.connect();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.host.clearTimeout(this.timer);
    this.timer = null;
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
          this.store.setLive("open");
        }
        this.receive(message, since === null && this.cursor === null);
      },
      closed: (refused) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.store.setLive("down");
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
    if ("resync" in message) {
      void this.store.refresh();
      return;
    }
    // The first tail has no events; anything written between the first snapshot and it is read once more.
    if (fromTail) {
      void this.store.refresh();
      return;
    }
    if (message.events.length) void this.store.invalidate(routesFor(message.events, this.store));
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
