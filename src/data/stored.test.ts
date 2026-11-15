import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HttpSource } from "./http-source";
import { Live, type LiveHost } from "./live";
import type { Source } from "./source";
import { FINISHED_SHOWN, SLOW_ROUTES, Store } from "./store";
import { STORED_FORMAT, STORED_MAX_CHARS, storedCopy, storedKey, type StoredCopy } from "./stored";
import { MANY_FINISHED } from "../fixtures/synthetic";
import { SyntheticSource } from "./synthetic-source";

// lina-app#194: the app opens from the copy it kept on the device, and the change stream says what changed since.

const ORIGIN = "https://hub.test";
const KEY = storedKey(ORIGIN, "");
const LISTS = ["board", "items", "goals", `cards:${FINISHED_SHOWN}`, "inbox"];
const slowNames = SLOW_ROUTES.map(([name, id]) => (id === undefined ? name : `${name}:${id}`));

/** Web storage in memory; `fail` makes every call throw, as a private window or a full quota does. */
function memory(fail: { get?: boolean; set?: boolean } = {}) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => {
      if (fail.get) throw new Error("storage refused");
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (fail.set) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => {
      if (fail.get) throw new Error("storage refused");
      items.delete(key);
    },
  };
}

/** The kept copy of a core at ORIGIN in `storage`, as the page's core source gets it. */
function copyIn(storage: ReturnType<typeof memory>, app = "test-1"): StoredCopy {
  const copy = storedCopy(new HttpSource({ fetch: (() => Promise.reject(new Error("no core"))) as typeof fetch, token: "token-a" }), { storage: () => storage, origin: ORIGIN, app });
  if (!copy) throw new Error("the core's source keeps a copy");
  return copy;
}

/** The routes `source` is asked for, in order, as `name` or `name:id`, and how many were asked before its stream opened. */
function asked(source: Source) {
  const names: string[] = [];
  const atStream: number[] = [];
  const read = source.read.bind(source);
  source.read = ((name, id) => {
    names.push(id === undefined ? name : `${name}:${id}`);
    return read(name, id);
  }) as Source["read"];
  const changes = source.changes.bind(source);
  source.changes = (since, handlers) => {
    atStream.push(names.length);
    return changes(since, handlers);
  };
  return { names, atStream };
}

const host: LiveHost = {
  document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } as unknown as LiveHost["document"],
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
  random: () => 0,
};

async function settle() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

/** One page of the app on `source`: its store opens from `copy`, its stream starts, and everything it read lands. */
async function open(source: Source, copy: StoredCopy | null) {
  const store = new Store(source, { stored: copy });
  const drawn = { version: store.version, board: store.get("board") !== undefined };
  const stop = new Live(store, host).start();
  await settle();
  return { store, drawn, stop };
}

/** A first page that leaves a kept copy behind, on a scene another page can share. */
async function firstVisit(storage: ReturnType<typeof memory>, options: ConstructorParameters<typeof SyntheticSource>[0] = {}) {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), ...options });
  const page = await open(source, copyIn(storage));
  page.stop();
  return source;
}

const kept = (storage: ReturnType<typeof memory>) => JSON.parse(storage.items.get(KEY) ?? "null");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

test("a page with a kept copy draws it before any read, reads nothing before its stream, then only what the missed change touched", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const cursor = kept(storage).cursor;
  expect(cursor).toMatch(/^s\./);
  // Another device answers a to-do while no page is open.
  await new SyntheticSource({ scene: first.scene }).comment("T4", { text: "다른 기기에서" });

  const source = new SyntheticSource({ scene: first.scene });
  const { names, atStream } = asked(source);
  const page = await open(source, copyIn(storage));
  expect(page.drawn).toEqual({ version: 1, board: true });
  expect(atStream).toEqual([0]);
  expect(source.stream[0]).toMatchObject({ since: cursor, first: "missed", missed: 1 });
  // The work event names the board and the items; the to-do's detail was never read, so it is not read now.
  expect(names.filter((name) => !slowNames.includes(name))).toEqual(["board", "items"]);
  expect(names.filter((name) => slowNames.includes(name))).toEqual(slowNames);
  expect(page.store.catchingUp).toBe(false);
  expect(kept(storage).cursor).not.toBe(cursor);
  page.stop();
});

test("no kept copy: the first refresh reads every list, as before", async () => {
  const storage = memory();
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const { names } = asked(source);
  const page = await open(source, copyIn(storage));
  expect(page.drawn).toEqual({ version: 0, board: false });
  expect(names.slice(0, 5)).toEqual(LISTS);
  expect(kept(storage)).toMatchObject({ format: STORED_FORMAT, app: "test-1", owner: page.store.get("items")?.owner?.id });
  page.stop();
});

test("a kept cursor the stream no longer keeps gets one resync, which reads every list", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  storage.items.set(KEY, JSON.stringify({ ...kept(storage), cursor: "s.gone" }));
  const source = new SyntheticSource({ scene: first.scene });
  const { names, atStream } = asked(source);
  const page = await open(source, copyIn(storage));
  expect(page.drawn.board).toBe(true);
  expect(atStream).toEqual([0]);
  expect(source.stream[0].first).toBe("resync");
  expect(names.slice(0, 5)).toEqual(LISTS);
  expect(page.store.catchingUp).toBe(false);
  page.stop();
});

test("a copy another app version wrote is dropped unread, and the page reads every list", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const source = new SyntheticSource({ scene: first.scene });
  const { names } = asked(source);
  const page = await open(source, copyIn(storage, "test-2"));
  expect(page.drawn).toEqual({ version: 0, board: false });
  expect(names.slice(0, 5)).toEqual(LISTS);
  expect(kept(storage).app).toBe("test-2");
  page.stop();
});

test("a stream refused at the upgrade with a renewed credential drops the copy and reads every list", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const source = new SyntheticSource({ scene: first.scene });
  const { names } = asked(source);
  const changes = source.changes.bind(source);
  let refusals = 1;
  source.changes = (since, handlers) => {
    if (refusals-- > 0) {
      queueMicrotask(() => handlers.closed(true));
      return { close() {} };
    }
    return changes(since, handlers);
  };
  const removed: string[] = [];
  const removeItem = storage.removeItem;
  storage.removeItem = (key) => {
    removed.push(key);
    removeItem(key);
  };
  source.renewCredential = () => Promise.resolve("renewed");
  const page = await open(source, copyIn(storage));
  expect(removed).toEqual([KEY]);
  expect(names.slice(0, 5)).toEqual(LISTS);
  // The renewed credential reads again, and the copy is written anew from what it read.
  expect(kept(storage)?.cursor).toMatch(/^s\./);
  page.stop();
});

test("signed out: a read the core answers 401 removes the copy, and nothing is written while the stream still sends", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const source = new SyntheticSource({ scene: first.scene });
  const read = source.read.bind(source);
  source.read = ((name, id) => (name === "items" ? Promise.resolve({ kind: "failed", offline: false, at: 0, denied: true }) : read(name, id))) as Source["read"];
  source.renewCredential = () => Promise.resolve("gated");
  const page = await open(source, copyIn(storage));
  await new SyntheticSource({ scene: first.scene }).comment("T4", { text: "다른 기기에서" });
  await vi.advanceTimersByTimeAsync(1_000);
  await settle();
  expect(storage.items.has(KEY)).toBe(false);
  page.stop();
});

test("the core's final refusal after a renewal removes the copy", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const source = new SyntheticSource({ scene: first.scene });
  source.changes = (_since, handlers) => {
    queueMicrotask(() => handlers.closed(true));
    return { close() {} };
  };
  source.renewCredential = () => Promise.resolve("same");
  const page = await open(source, copyIn(storage));
  // The first refusal renewed to the same token, which keeps the copy; the second one is the store's denial.
  await vi.advanceTimersByTimeAsync(1_000);
  await settle();
  expect(page.store.denied).toBe(true);
  expect(storage.items.has(KEY)).toBe(false);
  page.stop();
});

test("a stream that cannot reach the core keeps the copy on screen and on the device", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const source = new SyntheticSource({ scene: first.scene });
  source.changes = (_since, handlers) => {
    queueMicrotask(() => handlers.closed(true));
    return { close() {} };
  };
  source.renewCredential = () => Promise.resolve("unreachable");
  const before = storage.items.get(KEY);
  const page = await open(source, copyIn(storage));
  expect(page.store.catchingUp).toBe(true);
  expect(page.store.get("board")).toBeDefined();
  expect(storage.items.get(KEY)).toBe(before);
  page.stop();
});

test("storage that throws on every call leaves the app reading the core as it would without a copy", async () => {
  const storage = memory({ get: true, set: true });
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const { names } = asked(source);
  const page = await open(source, copyIn(storage));
  expect(names.slice(0, 5)).toEqual(LISTS);
  expect(page.store.live).toBe("open");
  expect(page.store.get("board")).toBeDefined();
  page.stop();
});

test("a full storage removes the older copy instead of keeping a stale one", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const full = memory({ set: true });
  full.items.set(KEY, storage.items.get(KEY) ?? "");
  const page = await open(new SyntheticSource({ scene: first.scene }), copyIn(full));
  expect(page.drawn.board).toBe(true);
  expect(full.items.has(KEY)).toBe(false);
  page.stop();
});

test("the synthetic scene and a test's source keep no copy", async () => {
  const storage = memory();
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  expect(storedCopy(source, { storage: () => storage, origin: ORIGIN })).toBeNull();
  const page = await open(source, storedCopy(source, { storage: () => storage, origin: ORIGIN }));
  expect(page.store.version).toBeGreaterThan(0);
  expect(storage.items.size).toBe(0);
  page.stop();
});

test("the copy keeps the first page of the finished cards with the core's total, and a copy over the cap is not kept", async () => {
  const storage = memory();
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), manyFinished: true });
  const page = await open(source, copyIn(storage));
  await page.store.showFinished();
  await new SyntheticSource({ scene: source.scene }).comment("T4", { text: "다른 기기에서" });
  await vi.advanceTimersByTimeAsync(1_000);
  await settle();
  const cards = kept(storage).routes.cards.data;
  expect(cards.cards.filter((card: { state: string }) => card.state === "done")).toHaveLength(FINISHED_SHOWN);
  expect(cards.finishedTotal).toBe(MANY_FINISHED + 1);
  page.stop();

  copyIn(storage).save({ cursor: "s.1.0", owner: null, routes: { board: { data: "x".repeat(STORED_MAX_CHARS) } } });
  expect(storage.items.has(KEY)).toBe(false);
});

test("the kept cursor never runs ahead of the routes: a change's cursor is written only once its reads land", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const cursor = kept(storage).cursor;
  await new SyntheticSource({ scene: first.scene }).comment("T4", { text: "다른 기기에서" });
  const source = new SyntheticSource({ scene: first.scene });
  const read = source.read.bind(source);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  source.read = ((name, id) => (name === "items" ? held.then(() => read(name, id)) : read(name, id))) as Source["read"];
  const page = await open(source, copyIn(storage));
  expect(source.stream[0].missed).toBe(1);
  expect(kept(storage).cursor).toBe(cursor);
  expect(page.store.catchingUp).toBe(true);
  release();
  await settle();
  expect(kept(storage).cursor).not.toBe(cursor);
  page.stop();
});

test("a copy of another owner is dropped once a read of the items names who is signed in, and every list is read", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  storage.items.set(KEY, JSON.stringify({ ...kept(storage), owner: "someone-else" }));
  await new SyntheticSource({ scene: first.scene }).comment("T4", { text: "다른 기기에서" });
  const source = new SyntheticSource({ scene: first.scene });
  const { names } = asked(source);
  const page = await open(source, copyIn(storage));
  expect(names.filter((name) => LISTS.includes(name))).toEqual(["board", "items", ...LISTS]);
  expect(kept(storage).owner).toBe(page.store.get("items")?.owner?.id);
  page.stop();
});

test("a route the stream asked for that fails to read leaves the earlier copy, so the next page still reads that change", async () => {
  const storage = memory();
  const first = await firstVisit(storage);
  const cursor = kept(storage).cursor;
  const before = storage.items.get(KEY);
  await new SyntheticSource({ scene: first.scene }).comment("T4", { text: "다른 기기에서" });
  const source = new SyntheticSource({ scene: first.scene });
  const read = source.read.bind(source);
  source.read = ((name, id) => (name === "items" ? Promise.resolve({ kind: "failed", offline: false, at: Math.floor(Date.now() / 1000) }) : read(name, id))) as Source["read"];
  const page = await open(source, copyIn(storage));
  expect(page.store.status("items")).toBe("failed");
  expect(storage.items.get(KEY)).toBe(before);
  expect(kept(storage).cursor).toBe(cursor);
  page.stop();

  // The next page resumes from the old cursor and reads the change the failed read missed.
  const next = new SyntheticSource({ scene: first.scene });
  const { names } = asked(next);
  const again = await open(next, copyIn(storage));
  expect(names).toContain("items");
  expect(kept(storage).cursor).not.toBe(cursor);
  again.stop();
});

test("the settings are not kept: a page opened again reads them, so its edits carry the ETag of that read", async () => {
  const storage = memory();
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const store = new Store(source, { stored: copyIn(storage) });
  const stop = new Live(store, host).start();
  store.want([["settings"], ["settingsHistory", "5"]]);
  await settle();
  expect(store.get("settings")).toBeDefined();
  store.refresh();
  await settle();
  expect(Object.keys(kept(storage).routes).filter((key) => key.startsWith("settings") && key !== "settingsModels")).toEqual([]);
  stop();
});
