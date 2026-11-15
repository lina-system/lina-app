import { useEffect, useState } from "preact/hooks";
import { USAGE_RANGES, type RouteName, type Routes, type UsageRange, type UsageView } from "../api/client";
import type { ModelInput } from "../model";
import { nowSeconds, type Source, type WriteResult } from "./source";
import type { StoredCopy, StoredRoute, StoredSnapshot } from "./stored";

type Status = "pending" | "ok" | "missing" | "failed";

interface Entry {
  data?: unknown;
  receivedAt?: number;
  status: Status;
}

export type Want = readonly (readonly [RouteName, string?])[];

/**
 * Whether an id can name a worker run: one token of letters, digits, dots, dashes and underscores with at least one
 * digit (r1, OT-SIO1113214433). A card's worker runs from the hub once held the words of the commands its text names
 * (status, wait, accept, ...); those are not runs and are never read (lina-app#128).
 */
export function isRunId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && /\d/.test(id);
}

/** The routes once each, in order, without a record whose id cannot name a run. */
function distinct(routes: Want): Want {
  const seen = new Set<string>();
  return routes.filter(([name, id]) => {
    const key = id === undefined ? name : `${name}:${id}`;
    if (seen.has(key) || (name === "record" && (id === undefined || !isRunId(id)))) return false;
    seen.add(key);
    return true;
  });
}

/** The change stream: not opened yet, open (the screens are current), or down (they may be stale). */
export type LiveState = "connecting" | "open" | "down";

const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox"];
/**
 * Machines, quota, usage, OCX's models and links, the hub's own checks and the settings' OCX model list change
 * slowly: read on the same refresh trigger, at most once a minute. Usage is one route per range, the route's id
 * being the range.
 */
export const SLOW_ROUTES: Want = [
  ["devices"],
  ["quota"],
  ...USAGE_RANGES.map((range) => ["usage", range] as const),
  ["modelsState"],
  ["checks"],
  ["settingsModels"],
];
export const SLOW_REFRESH_S = 60;

/** How many finished cards the work tab reads first (lina-app#186); the rest are read when its fold opens. */
export const FINISHED_SHOWN = 5;

/** The finished cards the core holds (`total`), the ones this page read, whether those are all, and a read of the rest out. */
export interface FinishedCards {
  readonly total: number;
  readonly loaded: number;
  readonly all: boolean;
  readonly loading: boolean;
}

export interface StoreOptions {
  /**
   * Resolves once the browser has drawn what the last change showed; reads the open screen does not draw wait for it.
   * The page passes nextPaint; without it they follow the lists at once.
   */
  readonly afterPaint?: () => Promise<void>;
  /** The copy of the store kept on this device (lina-app#194); none for the synthetic scene and tests. */
  readonly stored?: StoredCopy | null;
}

/** The cards a kept copy holds: every unfinished card and the first FINISHED_SHOWN finished ones, with the core's total. */
function firstPage(view: Routes["cards"]): Routes["cards"] {
  let finished = 0;
  const cards = view.cards.filter((card) => card.state !== "done" || ++finished <= FINISHED_SHOWN);
  return { ...view, cards, finishedTotal: view.finishedTotal ?? view.cards.filter((card) => card.state === "done").length };
}

/** The frame after the next one, or a tenth of a second when no frame comes (a hidden tab draws none). */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 100);
    window.requestAnimationFrame(() =>
      window.setTimeout(() => {
        window.clearTimeout(timer);
        resolve();
      }, 0),
    );
  });
}

/**
 * The last answer of every route the screens read. A read that returns 304 keeps the same objects, so the
 * screens keep their rows, selection and scroll; only routes that changed bump the version.
 */
export class Store {
  version = 0;
  /** Finished refreshes; a line that lasts "until the next refresh" remembers the count it was drawn at. */
  refreshes = 0;
  lastOk: number | null = null;
  offline = false;
  live: LiveState = "connecting";
  /** The board's last read failed while the core answered: the stream alone does not make the screens current. */
  boardFailed = false;
  /** The core refused the page's credential again after one renewal: nothing will read until something changes. */
  denied = false;
  private renewing: Promise<boolean> | null = null;
  private renewedInStreak = false;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private wanted: Want = [];
  private slowReadAt: number | null = null;
  private shown: ModelInput;
  /** A screen lists or counts every finished card: the cards are read without a limit from then on. */
  private finishedAll = false;
  private finishing: Promise<void> | null = null;
  /** The last read of every finished card left the page short: a screen's own asks stop until the user asks again. */
  private finishFailed = false;
  private cardsReading = 0;
  private readonly afterPaint: () => Promise<void>;
  private firstPaint: () => void = () => {};
  /**
   * The first refresh has landed, its lists on screen: what no screen draws (the change stream, the push key) may start.
   * A store opened from its kept copy says so once the stream has caught up instead, so nothing is read before it.
   */
  readonly painted: Promise<void> = new Promise((resolve) => (this.firstPaint = resolve));
  /**
   * The cursor of the kept copy the store opened from (lina-app#194): the stream resumes there and the routes it names
   * are read, instead of every list. Null: no copy, the first refresh reads them all.
   */
  readonly restored: string | null;
  /** The screens show the kept copy and the stream has not caught up since: the freshness line says how old it is. */
  catchingUp = false;
  private readonly stored: StoredCopy | null;
  /** The owner the kept copy belonged to, until a read of the items says who is signed in. */
  private keptOwner: string | null | undefined;
  /** The last stream cursor whose reads have landed, and what the kept copy was last written with. */
  private cursor: string | null = null;
  private keptAt: { readonly cursor: string; readonly version: number } | null = null;
  /** The core refused the credential since a read last answered: nothing is kept (an open socket may still send). */
  private refused = false;

  constructor(
    readonly source: Source,
    options: StoreOptions = {},
  ) {
    this.afterPaint = options.afterPaint ?? (() => Promise.resolve());
    this.stored = options.stored ?? null;
    const kept = this.stored?.load() ?? null;
    this.restored = kept?.cursor ?? null;
    if (kept) this.restore(kept);
    this.shown = this.read();
  }

  /** The kept copy on screen at once, before anything is read; the stream says what changed since. */
  private restore(kept: StoredSnapshot): void {
    for (const [key, route] of Object.entries(kept.routes)) this.entries.set(key, { data: route.data, receivedAt: route.receivedAt, status: "ok" });
    this.keptOwner = kept.owner;
    this.lastOk = this.entries.get("board")?.receivedAt ?? null;
    this.catchingUp = true;
    this.version = 1;
  }

  /**
   * Writes the kept copy at the stream's cursor: the lists, the slow routes and the open screen's routes as last read,
   * the finished cards cut to the first page. Not while the credential is refused, and not again for the same state.
   */
  private keep(): void {
    if (!this.stored || this.refused || this.denied || this.cursor === null) return;
    if (this.keptAt?.cursor === this.cursor && this.keptAt.version === this.version) return;
    // A route whose last read failed still holds older data: a copy written now would carry it as current under a
    // cursor past the change it missed. The earlier copy stays; it is consistent at its own cursor.
    for (const entry of this.entries.values()) if (entry.status === "failed" && entry.data !== undefined) return;
    // A list that never answered would be missing from the copy while the cursor says nothing changed: a page opened from
    // it would not read that list until some event named it. Without every list there is no copy.
    for (const list of LIST_ROUTES) if (this.entries.get(list)?.data === undefined) return;
    const routes: Record<string, StoredRoute> = {};
    for (const [name, id] of [...LIST_ROUTES.map((list) => [list] as const), ...SLOW_ROUTES, ...this.wanted]) {
      // The settings' writes need the ETag of the read that is on screen, which a kept copy does not hold.
      if (name === "settings" || name === "settingsHistory") continue;
      const key = this.key(name, id);
      const entry = this.entries.get(key);
      if (entry?.data === undefined) continue;
      routes[key] = { data: name === "cards" ? firstPage(entry.data as Routes["cards"]) : entry.data, receivedAt: entry.receivedAt };
    }
    this.stored.save({ cursor: this.cursor, owner: this.get("items")?.owner?.id ?? null, routes });
    this.keptAt = { cursor: this.cursor, version: this.version };
  }

  /** The core refused the credential: the kept copy goes, and nothing is written until a read answers again. */
  private forget(): void {
    this.stored?.clear();
    this.keptAt = null;
    this.refused = true;
  }

  /** A read of the items names another owner than the kept copy's: the copy goes and every list is read again. */
  private checkOwner(owner: string | null): void {
    if (this.keptOwner === undefined) return;
    const same = owner === this.keptOwner;
    this.keptOwner = undefined;
    if (same) return;
    this.forget();
    void this.refresh();
  }

  private key(name: RouteName, id?: string): string {
    return id === undefined ? name : `${name}:${id}`;
  }

  get<N extends RouteName>(name: N, id?: string): Routes[N] | undefined {
    return this.entries.get(this.key(name, id))?.data as Routes[N] | undefined;
  }

  status(name: RouteName, id?: string): Status {
    return this.entries.get(this.key(name, id))?.status ?? "pending";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async load(name: RouteName, id?: string): Promise<boolean> {
    const key = this.key(name, id);
    const cards = name === "cards";
    if (cards) this.cardsReading += 1;
    const result = await this.source.read(name, cards && !this.finishedAll ? String(FINISHED_SHOWN) : id);
    if (cards) this.cardsReading -= 1;
    // What the store holds when the answer lands: another read of the route may have landed meanwhile.
    const before = this.entries.get(key);
    if (result.kind === "data" || result.kind === "unchanged") {
      this.refused = false;
      this.setDenied(false);
    } else if (result.kind === "failed" && result.denied) {
      // A 401 or 403 is the core's own answer: signed out, or a credential it no longer takes.
      this.forget();
      void this.credentialRefused();
    }
    if (name === "board") {
      this.offline = result.kind === "failed" && result.offline;
      this.boardFailed = result.kind === "failed";
      if (result.kind === "data" || result.kind === "unchanged") this.lastOk = result.at;
    }
    switch (result.kind) {
      case "data":
        this.entries.set(key, { data: result.data, receivedAt: result.at, status: "ok" });
        if (name === "items") this.checkOwner((result.data as Routes["items"]).owner?.id ?? null);
        return true;
      case "unchanged":
        if (before?.status === "ok") return false;
        this.entries.set(key, { ...before, status: before?.data === undefined ? "pending" : "ok" });
        return before?.data !== undefined;
      case "missing":
        this.entries.set(key, { status: "missing" });
        return before?.status !== "missing";
      case "failed":
        this.entries.set(key, { ...before, status: "failed" });
        return before?.status !== "failed";
    }
  }

  private changed(): void {
    this.version += 1;
    this.shown = this.read();
    this.notify();
  }

  /** Redraw without a data change: the stream's state moved. */
  notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * The core refused the page's credential (a 401 or 403 on a read, or the stream turned away at the upgrade). The
   * first refusal of a streak reads the credential again and, when it got one, reads every snapshot with it; the
   * answer says whether to connect again now. A refusal after that renewal marks the store denied (연결 끊김) and asks
   * nothing more. A page signed in by cookie renews nothing: its sign-in path handles a 401. Concurrent refusals share
   * one renewal.
   */
  credentialRefused(): Promise<boolean> {
    if (this.renewing) return this.renewing;
    if (this.renewedInStreak) {
      this.setDenied(true);
      return Promise.resolve(false);
    }
    this.renewing = this.source
      .renewCredential()
      .then((renewal) => {
        if (renewal === "gated" || renewal === "unreachable") return false;
        // The core served the page again: a new credential, or none. A stream that never opened only says the core
        // was not reached, which keeps the copy.
        if (renewal !== "same") this.forget();
        this.renewedInStreak = true;
        if (renewal === "none") {
          this.setDenied(true);
          return false;
        }
        void this.refresh();
        return true;
      })
      .finally(() => {
        this.renewing = null;
      });
    return this.renewing;
  }

  /**
   * The streak ends when the stream opens, or when the person comes back (the tab shown, online again), which may
   * renew once more. A read that answers only clears the red line: a stream refused while reads pass must not renew
   * on every try.
   */
  credentialTaken(): void {
    this.renewedInStreak = false;
    this.setDenied(false);
  }

  private setDenied(denied: boolean): void {
    if (this.denied === denied) return;
    if (denied) this.forget();
    this.denied = denied;
    this.notify();
  }

  setLive(state: LiveState): void {
    if (this.live === state) return;
    this.live = state;
    this.notify();
  }

  /**
   * Refreshes and invalidations run one at a time, in the order they were asked for: an older read never lands over
   * a newer one, and two reads of one route never race.
   */
  private reading: Promise<void> = Promise.resolve();

  private queue(run: () => Promise<void>): Promise<void> {
    this.reading = this.reading.then(run, run);
    return this.reading;
  }

  /**
   * Reads again only the routes a change touched: list routes always, a detail only when a screen has read it. A card
   * the list names for the first time is not read until a screen opens it (lina-app#100). Unchanged routes answer 304
   * and keep their objects, so rows, selection and scroll stay.
   */
  invalidate(routes: Want): Promise<void> {
    const run = async () => {
      const keys = new Map<string, readonly [RouteName, string?]>();
      for (const [name, id] of routes) {
        const key = this.key(name, id);
        if (id === undefined || this.entries.has(key)) keys.set(key, [name, id]);
      }
      if (!keys.size) return;
      const changes = await Promise.all([...keys.values()].map(([name, id]) => this.load(name, id)));
      if (changes.some(Boolean)) this.changed();
      else this.notify();
    };
    return this.queue(run);
  }

  /**
   * The stream's message at `cursor` and every read it asked for have landed (lina-app#194): the kept copy is written
   * with that cursor, and what waits on the first paint may start. Queued behind those reads, so the kept cursor is
   * never ahead of the kept routes. The first after opening from the kept copy also reads the slow routes, which no
   * event names, once, as a first refresh does.
   */
  caughtUp(cursor: string): Promise<void> {
    return this.queue(async () => {
      this.cursor = cursor;
      this.keep();
      this.firstPaint();
      if (!this.catchingUp) return;
      this.catchingUp = false;
      const slow = this.slowDue();
      const changes = await Promise.all(slow.map(([name, id]) => this.load(name, id)));
      if (changes.some(Boolean)) this.changed();
      else this.notify();
    });
  }

  /** The slow routes when they are due (at most once a minute), marking them read now. */
  private slowDue(): Want {
    const now = nowSeconds();
    if (this.slowReadAt !== null && now - this.slowReadAt < SLOW_REFRESH_S - 1) return [];
    this.slowReadAt = now;
    return SLOW_ROUTES;
  }

  /** Loaded card details that list a worker run, for a worker event about it. */
  cardsWithRun(runId: string): string[] {
    const ids: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!key.startsWith("card:")) continue;
      const detail = entry.data as Routes["card"] | undefined;
      if (detail?.workerRuns.some((run) => run.id === runId)) ids.push(key.slice("card:".length));
    }
    return ids;
  }

  /**
   * One read of every list route, then whatever the open screen wants. The lists are drawn as soon as they answer; a
   * work card's detail is read only while a screen shows it (lina-app#100: one read per card held the first screen
   * for a minute).
   */
  refresh(): Promise<void> {
    return this.queue(() => this.readAll());
  }

  /**
   * The lists first, with the slow routes the open screen draws; once they are on screen, the other slow routes and the
   * open screen's own routes (lina-app#186: fifteen reads leaving at once held the first screen back). A route the open
   * screen asked for and is still reading for the first time is not asked again.
   */
  private async readAll(): Promise<void> {
    const slow = this.slowDue();
    const reading = ([name, id]: Want[number]) => this.entries.get(this.key(name, id))?.status === "pending";
    const drawn = ([name, id]: Want[number]) => this.wanted.some(([wanted, wantedId]) => wanted === name && wantedId === id);
    const firstWave = await Promise.all([...LIST_ROUTES.map((name) => this.load(name)), ...slow.filter((route) => drawn(route) && !reading(route)).map(([name, id]) => this.load(name, id))]);
    const listed = firstWave.some(Boolean) || this.version === 0;
    if (listed) this.changed();
    const later = slow.filter((route) => !drawn(route) && !reading(route));
    if (later.length) await this.afterPaint();
    // The lists are on screen: what waits on them (the change stream, the push key) starts without waiting for the rest.
    this.firstPaint();
    // A slow route the screen draws was read in the first wave when it was due; it keeps its once-a-minute pace.
    const slowRoute = ([name, id]: Want[number]) => SLOW_ROUTES.some(([slowName, slowId]) => slowName === name && slowId === id);
    const reread = this.wanted.filter((route) => !reading(route) && !slowRoute(route));
    const secondWave = await Promise.all([...later, ...reread].map(([name, id]) => this.load(name, id)));
    this.refreshes += 1;
    if (secondWave.some(Boolean)) this.changed();
    else if (!listed) this.notify();
    // Read after the last cursor whose reads landed, so the copy stays at least as new as its cursor.
    this.keep();
  }

  /**
   * One of the owner's writes. After the core takes it, one read brings the record's own state back, so the
   * screen shows what the record says rather than what the tap assumed; `refresh: false` leaves that to the
   * next refresh.
   */
  async write<T>(send: (source: Source) => Promise<WriteResult<T>>, options: { refresh?: boolean } = {}): Promise<WriteResult<T>> {
    const result = await send(this.source);
    if (result.ok && options.refresh !== false) await this.refresh();
    return result;
  }

  /** What the page holds of the finished cards, from the last cards read. A core that sends no total sent every one. */
  finished(): FinishedCards {
    const loaded = (this.get("cards")?.cards ?? []).filter((card) => card.state === "done").length;
    const total = this.get("cards")?.finishedTotal ?? loaded;
    return { total, loaded, all: loaded >= total, loading: this.finishing !== null };
  }

  /**
   * Every finished card from now on: the fold under the work tab's 완료, or a screen that lists or counts them all. A
   * cards read already out or landed is followed by one without a limit; before the first, the first asks for them all.
   */
  showFinished(automatic = false): Promise<void> {
    if (this.finishing) return this.finishing;
    // A screen asks again on every change of the store, a failed read included: only the user's own ask reads again after it.
    if (automatic && this.finishFailed) return Promise.resolve();
    const entry = this.entries.get("cards");
    // Asked for already: nothing to read while a read is out, before the first read, or once the page holds them all. A
    // read that failed leaves the page with the few it had, so the next ask reads again.
    if (this.finishedAll && (this.cardsReading > 0 || !entry || (entry.status === "ok" && this.finished().all))) return Promise.resolve();
    this.finishedAll = true;
    if (!entry && !this.cardsReading) return Promise.resolve();
    this.finishing = this.invalidate([["cards"]]).finally(() => {
      this.finishing = null;
      this.finishFailed = !this.finished().all;
      this.notify();
    });
    this.notify();
    return this.finishing;
  }

  /** Reads routes not read yet without changing what the open screen wants (an expanded row's record). */
  ensure(routes: Want): void {
    const missing = distinct(routes).filter(([name, id]) => !this.entries.has(this.key(name, id)));
    if (!missing.length) return;
    for (const [name, id] of missing) this.entries.set(this.key(name, id), { status: "pending" });
    void Promise.all(missing.map(([name, id]) => this.load(name, id))).then((changes) => {
      if (changes.some(Boolean)) this.changed();
    });
  }

  want(routes: Want): void {
    this.wanted = distinct(routes);
    const missing = this.wanted.filter(([name, id]) => !this.entries.has(this.key(name, id)));
    if (!missing.length) return;
    // Held as pending while the read is out, so a redraw meanwhile does not ask for it again.
    for (const [name, id] of missing) this.entries.set(this.key(name, id), { status: "pending" });
    void Promise.all(missing.map(([name, id]) => this.load(name, id))).then((changes) => {
      if (changes.some(Boolean)) this.changed();
    });
  }

  /**
   * What the screens draw: the routes as of the last change. A redraw for another reason (the stream opening, a
   * refresh with nothing new) in the middle of a refresh does not draw a half-read store.
   */
  input(): ModelInput {
    return this.shown;
  }

  private read(): ModelInput {
    const cardDetails: Record<string, Routes["card"]> = {};
    for (const card of this.get("cards")?.cards ?? []) {
      const detail = this.get("card", card.id);
      if (detail) cardDetails[card.id] = detail;
    }
    const failed: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.status !== "failed") continue;
      // A route with an id is a detail, except usage and the settings' history, whose ids are what they were read for.
      failed.push(key.startsWith("usage:") ? "usage" : key.startsWith("settingsHistory:") ? "settingsHistory" : key.includes(":") ? "detail" : key);
    }
    const usage: Partial<Record<UsageRange, UsageView>> = {};
    for (const range of USAGE_RANGES) {
      const view = this.get("usage", range);
      if (view) usage[range] = view;
    }
    return {
      board: this.get("board"),
      items: this.get("items"),
      goals: this.get("goals"),
      cards: this.get("cards"),
      cardsAt: this.entries.get("cards")?.receivedAt,
      finished: this.finished(),
      inbox: this.get("inbox"),
      devices: this.get("devices"),
      quota: this.get("quota"),
      usage,
      modelsState: this.get("modelsState"),
      checks: this.get("checks"),
      cardDetails,
      failed: this.offline ? [] : failed,
    };
  }
}

export function useStore(store: Store): number {
  const [tick, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((value) => value + 1)), [store]);
  return store.version * 1_000_000 + tick;
}

export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowSeconds()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
