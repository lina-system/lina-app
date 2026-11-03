import { useEffect, useState } from "preact/hooks";
import type { RouteName, Routes } from "../api/client";
import type { ModelInput } from "../model";
import { nowSeconds, type Source, type WriteResult } from "./source";

type Status = "pending" | "ok" | "missing" | "failed";

interface Entry {
  data?: unknown;
  receivedAt?: number;
  status: Status;
}

export type Want = readonly (readonly [RouteName, string?])[];

/** The change stream: not opened yet, open (the screens are current), or down (they may be stale). */
export type LiveState = "connecting" | "open" | "down";

const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox"];
/** Machines and quota change slowly: read on the same refresh trigger, at most once a minute. */
const SLOW_ROUTES: readonly RouteName[] = ["devices", "quota"];
export const SLOW_REFRESH_S = 60;

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
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private wanted: Want = [];
  private slowReadAt: number | null = null;
  private shown: ModelInput;

  constructor(readonly source: Source) {
    this.shown = this.read();
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
    const before = this.entries.get(key);
    const result = await this.source.read(name, id);
    if (name === "board") {
      this.offline = result.kind === "failed" && result.offline;
      this.boardFailed = result.kind === "failed";
      if (result.kind === "data" || result.kind === "unchanged") this.lastOk = result.at;
    }
    switch (result.kind) {
      case "data":
        this.entries.set(key, { data: result.data, receivedAt: result.at, status: "ok" });
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
   * Reads again only the routes a change touched: list routes always, a detail only when a screen has read it. A
   * changed card list also reads the details of cards it did not list before. Unchanged routes answer 304 and keep
   * their objects, so rows, selection and scroll stay.
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
      if (keys.has("cards")) {
        const added = (this.get("cards")?.cards ?? []).map((card) => card.id).filter((id) => !this.entries.has(this.key("card", id)));
        changes.push(...(await Promise.all(added.map((id) => this.load("card", id)))));
      }
      if (changes.some(Boolean)) this.changed();
      else this.notify();
    };
    return this.queue(run);
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

  /** One read of every list route, every work card's detail and whatever the open screen wants. */
  refresh(): Promise<void> {
    return this.queue(() => this.readAll());
  }

  private async readAll(): Promise<void> {
    const now = nowSeconds();
    const slow = this.slowReadAt === null || now - this.slowReadAt >= SLOW_REFRESH_S - 1 ? SLOW_ROUTES : [];
    if (slow.length) this.slowReadAt = now;
    const firstWave = await Promise.all([...LIST_ROUTES, ...slow].map((name) => this.load(name)));
    const cardIds = (this.get("cards")?.cards ?? []).map((card) => card.id);
    const secondWave = await Promise.all([
      ...cardIds.map((id) => this.load("card", id)),
      ...this.wanted.filter(([name, id]) => !(name === "card" && id && cardIds.includes(id))).map(([name, id]) => this.load(name, id)),
    ]);
    this.refreshes += 1;
    if ([...firstWave, ...secondWave].some(Boolean) || this.version === 0) this.changed();
    else this.notify();
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

  /** Reads routes not read yet without changing what the open screen wants (an expanded row's record). */
  ensure(routes: Want): void {
    const missing = routes.filter(([name, id]) => !this.entries.has(this.key(name, id)));
    if (!missing.length) return;
    for (const [name, id] of missing) this.entries.set(this.key(name, id), { status: "pending" });
    void Promise.all(missing.map(([name, id]) => this.load(name, id))).then((changes) => {
      if (changes.some(Boolean)) this.changed();
    });
  }

  want(routes: Want): void {
    this.wanted = routes;
    const missing = routes.filter(([name, id]) => !this.entries.has(this.key(name, id)));
    if (!missing.length) return;
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
      failed.push(key.includes(":") ? "detail" : key);
    }
    return {
      board: this.get("board"),
      items: this.get("items"),
      goals: this.get("goals"),
      cards: this.get("cards"),
      cardsAt: this.entries.get("cards")?.receivedAt,
      inbox: this.get("inbox"),
      devices: this.get("devices"),
      quota: this.get("quota"),
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
