import { expect, test, vi } from "vitest";
import { bootstrapOptions, HttpSource } from "./http-source";
import { startRefresh, type RefreshHost } from "./refresh";
import { chooseSource } from "./select";
import { Store } from "./store";
import { SyntheticSource } from "./synthetic-source";

test("reads each route on its schema's server url with the session token and the last ETag", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if ((init?.headers as Record<string, string>)["If-None-Match"] === '"v1"') return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ goals: [] }), { status: 200, headers: { ETag: '"v1"' } });
  }) as typeof fetch;
  const source = new HttpSource({ fetch: fetchImpl, token: "token-a", basePath: "/core/" });

  expect((await source.read("goals")).kind).toBe("data");
  expect((await source.read("goals")).kind).toBe("unchanged");
  await source.read("board");
  await source.read("item", "a b");

  expect(calls.map((call) => call.url)).toEqual([
    "/core/api/plugins/kanban/work/goals",
    "/core/api/plugins/kanban/work/goals",
    "/core/api/lina/board",
    "/core/api/lina/work/items/a%20b",
  ]);
  expect(calls[0].headers["X-Hermes-Session-Token"]).toBe("token-a");
  expect(calls[0].headers["If-None-Match"]).toBeUndefined();
  expect(calls[1].headers["If-None-Match"]).toBe('"v1"');
  expect(calls[2].headers["If-None-Match"]).toBeUndefined();
});

test("tells an unreachable core from a failed route and a missing record", async () => {
  const offline = new HttpSource({ fetch: (async () => Promise.reject(new TypeError("network"))) as typeof fetch });
  expect(await offline.read("board")).toMatchObject({ kind: "failed", offline: true });
  const failing = new HttpSource({ fetch: (async (url: string) => new Response("{}", { status: url.endsWith("/quota") ? 500 : 404 })) as typeof fetch });
  expect(await failing.read("quota")).toMatchObject({ kind: "failed", offline: false });
  expect(await failing.read("card", "gone")).toMatchObject({ kind: "missing" });
});

test("takes the token and base path from the core's bootstrap globals, and no token when the gate is on", () => {
  expect(bootstrapOptions({ __HERMES_SESSION_TOKEN__: "token-b", __HERMES_BASE_PATH__: "/x" })).toEqual({ token: "token-b", basePath: "/x" });
  expect(bootstrapOptions({ __HERMES_AUTH_REQUIRED__: true })).toEqual({ token: null, basePath: "" });
});

test("picks the synthetic scene only when asked", () => {
  expect(chooseSource({ search: "?source=synthetic" }, undefined)).toBeInstanceOf(SyntheticSource);
  expect(chooseSource({ search: "" }, "synthetic")).toBeInstanceOf(SyntheticSource);
  expect(chooseSource({ search: "" }, undefined)).toBeInstanceOf(HttpSource);
});

test("refreshes every 10 s while visible, pauses while hidden and reads once on return", () => {
  vi.useFakeTimers();
  try {
    let visibility: DocumentVisibilityState = "visible";
    const listeners: (() => void)[] = [];
    const host: RefreshHost = {
      document: {
        get visibilityState() {
          return visibility;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => {},
      } as unknown as RefreshHost["document"],
      setInterval: (handler, ms) => setInterval(handler, ms) as unknown as number,
      clearInterval: (handle) => clearInterval(handle),
    };
    const run = vi.fn();
    const stop = startRefresh(run, host);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(run).toHaveBeenCalledTimes(3);
    visibility = "hidden";
    for (const listener of listeners) listener();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    visibility = "visible";
    for (const listener of listeners) listener();
    expect(run).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});

test("machines and quota are read on the same refresh, at most once a minute", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const reads: string[] = [];
    const inner = new SyntheticSource();
    const source = new Proxy(inner, {
      get(target, key, receiver) {
        if (key !== "read") return Reflect.get(target, key, receiver);
        return (name: Parameters<SyntheticSource["read"]>[0], id?: string) => {
          reads.push(name);
          return target.read(name, id);
        };
      },
    });
    const store = new Store(source);
    const slow = () => reads.filter((name) => name === "devices" || name === "quota").length;
    await store.refresh();
    expect(slow()).toBe(2);
    for (let tick = 1; tick <= 5; tick += 1) {
      vi.advanceTimersByTime(10_000);
      await store.refresh();
    }
    expect(slow()).toBe(2);
    expect(reads.filter((name) => name === "board")).toHaveLength(6);
    vi.advanceTimersByTime(10_000);
    await store.refresh();
    expect(slow()).toBe(4);
  } finally {
    vi.useRealTimers();
  }
});
