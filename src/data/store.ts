import { useEffect, useState } from "preact/hooks";
import type { RouteName, Routes } from "../api/client";
import type { ModelInput } from "../model";
import { nowSeconds, type Source } from "./source";

type Status = "pending" | "ok" | "missing" | "failed";

interface Entry {
  data?: unknown;
  receivedAt?: number;
  status: Status;
}

export type Want = readonly (readonly [RouteName, string?])[];

const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota"];

/**
 * The last answer of every route the screens read. A read that returns 304 keeps the same objects, so the
 * screens keep their rows, selection and scroll; only routes that changed bump the version.
 */
export class Store {
  version = 0;
  lastOk: number | null = null;
  offline = false;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private wanted: Want = [];

  constructor(readonly source: Source) {}

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
    for (const listener of this.listeners) listener();
  }

  /** One read of every list route, every work card's detail and whatever the open screen wants. */
  async refresh(): Promise<void> {
    const firstWave = await Promise.all(LIST_ROUTES.map((name) => this.load(name)));
    const cardIds = (this.get("cards")?.cards ?? []).map((card) => card.id);
    const secondWave = await Promise.all([
      ...cardIds.map((id) => this.load("card", id)),
      ...this.wanted.filter(([name, id]) => !(name === "card" && id && cardIds.includes(id))).map(([name, id]) => this.load(name, id)),
    ]);
    if ([...firstWave, ...secondWave].some(Boolean) || this.version === 0) this.changed();
    else for (const listener of this.listeners) listener();
  }

  want(routes: Want): void {
    this.wanted = routes;
    const missing = routes.filter(([name, id]) => !this.entries.has(this.key(name, id)));
    if (!missing.length) return;
    void Promise.all(missing.map(([name, id]) => this.load(name, id))).then((changes) => {
      if (changes.some(Boolean)) this.changed();
    });
  }

  input(): ModelInput {
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
