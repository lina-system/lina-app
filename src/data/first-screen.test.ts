import { expect, test, vi } from "vitest";
import { HttpSource } from "./http-source";
import { FINISHED_SHOWN, SLOW_ROUTES, Store } from "./store";
import { MANY_FINISHED } from "../fixtures/synthetic";
import { SyntheticSource } from "./synthetic-source";
import type { Source } from "./source";

// lina-app#186: the first screen asks only for what it draws, and the finished cards past the first few on demand.

const NOW = Math.floor(Date.now() / 1000);

/** The routes `source` is asked for, in order, as `name` or `name:id`. */
function asked(source: Source): string[] {
  const names: string[] = [];
  const read = source.read.bind(source);
  source.read = ((name, id) => {
    names.push(id === undefined ? name : `${name}:${id}`);
    return read(name, id);
  }) as Source["read"];
  return names;
}

const slowNames = SLOW_ROUTES.map(([name, id]) => (id === undefined ? name : `${name}:${id}`));

test("the first refresh asks for the lists with the cards' finished_limit, and the slow routes only after the first paint", async () => {
  const source = new SyntheticSource({ now: NOW });
  const names = asked(source);
  let paint = () => {};
  const painted = new Promise<void>((resolve) => (paint = resolve));
  const store = new Store(source, { afterPaint: () => painted });
  const refresh = store.refresh();
  await vi.waitFor(() => expect(store.version).toBe(1));
  expect(names).toEqual(["board", "items", "goals", `cards:${FINISHED_SHOWN}`, "inbox"]);
  paint();
  await refresh;
  expect(names.slice(5)).toEqual(slowNames);
});

test("a slow route the open screen draws is read with the lists, not after the paint", async () => {
  const source = new SyntheticSource({ now: NOW });
  const names = asked(source);
  const store = new Store(source, { afterPaint: () => new Promise(() => {}) });
  void store.refresh();
  store.want([["checks"]]);
  await vi.waitFor(() => expect(store.version).toBeGreaterThan(0));
  expect(names).toContain("checks");
  expect(names.filter((name) => name === "checks")).toHaveLength(1);
  expect(names).not.toContain("devices");
});

test("the rest of the finished cards are read once on demand, with no limit, while the total stays the core's", async () => {
  const source = new SyntheticSource({ now: NOW, manyFinished: true });
  const names = asked(source);
  const store = new Store(source, { afterPaint: async () => {} });
  await store.refresh();
  const total = MANY_FINISHED + 1;
  expect(store.finished()).toEqual({ total, loaded: FINISHED_SHOWN, all: false, loading: false });

  const more = store.showFinished();
  expect(store.finished()).toEqual({ total, loaded: FINISHED_SHOWN, all: false, loading: true });
  store.showFinished();
  await more;
  expect(store.finished()).toEqual({ total, loaded: total, all: true, loading: false });
  expect(names.filter((name) => name.startsWith("cards"))).toEqual([`cards:${FINISHED_SHOWN}`, "cards"]);

  // A later refresh keeps every finished card the page holds.
  await store.refresh();
  expect(names.filter((name) => name.startsWith("cards"))).toEqual([`cards:${FINISHED_SHOWN}`, "cards", "cards"]);
});

test("a screen that lists every finished card asks for them all on its first read", async () => {
  const source = new SyntheticSource({ now: NOW, manyFinished: true });
  const names = asked(source);
  const store = new Store(source, { afterPaint: async () => {} });
  store.showFinished();
  await store.refresh();
  expect(names.filter((name) => name.startsWith("cards"))).toEqual(["cards"]);
  expect(store.finished()).toMatchObject({ all: true, loading: false });
});

test("a core that does not know finished_limit sends every card: the total is the finished cards it sent, and nothing is left to read", async () => {
  const urls: string[] = [];
  const card = (id: string, state: string) => ({ id, title: null, agent: "a", state, reason: null, elapsedSeconds: 60, todoProgress: { done: 0, total: 0 }, now: null, plain: { title: id, now: null, result: null } });
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.startsWith("/api/plugins/kanban/work/cards")) return new Response(JSON.stringify({ cards: [card("k1", "in_progress"), ...Array.from({ length: 12 }, (_, index) => card(`d${index}`, "done"))] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const store = new Store(new HttpSource({ fetch: fetchImpl, token: "token-a" }), { afterPaint: async () => {} });
  await store.refresh();
  expect(urls).toContain(`/api/plugins/kanban/work/cards?finished_limit=${FINISHED_SHOWN}`);
  expect(store.finished()).toEqual({ total: 12, loaded: 12, all: true, loading: false });
});
