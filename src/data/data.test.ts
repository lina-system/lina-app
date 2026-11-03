import { expect, test, vi } from "vitest";
import { bootstrapOptions, HttpSource } from "./http-source";
import { startRefresh, type RefreshHost } from "./refresh";
import { chooseSource } from "./select";
import { Store } from "./store";
import { SYNTHETIC_REPLY_AFTER, SyntheticSource } from "./synthetic-source";

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

function recordingFetch(answer: (url: string) => Response) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) }, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return answer(url);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ACTION = { ok: true, id: "T4", state: "in_progress", reason: null, cid: "c9", undoUntil: null };

test("a comment posts its text as JSON to the item's comments route with the session token", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify(ACTION), { status: 200 }));
  const source = new HttpSource({ fetch: fetchImpl, token: "token-a", basePath: "/core" });
  expect(await source.comment("T 4", { text: "한 줄" })).toEqual({ ok: true, data: ACTION });
  expect(calls).toEqual([
    {
      url: "/core/api/lina/work/items/T%204/comments",
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Hermes-Session-Token": "token-a" },
      body: { text: "한 줄" },
    },
  ]);
});

test("a refused write answers the core's status and detail; no answer reads status 0", async () => {
  const refused = new HttpSource({ fetch: recordingFetch(() => new Response(JSON.stringify({ detail: "no open decision" }), { status: 409 })).fetchImpl });
  expect(await refused.comment("T4", { text: "네", answer: true })).toEqual({ ok: false, status: 409, detail: "no open decision" });
  const broken = new HttpSource({ fetch: recordingFetch(() => new Response("oops", { status: 500 })).fetchImpl });
  expect(await broken.comment("T4", { text: "네" })).toEqual({ ok: false, status: 500, detail: null });
  const offline = new HttpSource({ fetch: (async () => Promise.reject(new TypeError("network"))) as typeof fetch });
  expect(await offline.comment("T4", { text: "네" })).toEqual({ ok: false, status: 0, detail: null });
});

test("the synthetic source adds the comment to its copy and the agent replies on a read after a few seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const source = new SyntheticSource();
    await source.read("item", "T4");
    expect((await source.read("item", "T4")).kind).toBe("unchanged");
    const result = await source.comment("T4", { text: "  한 줄 더  " });
    expect(result).toMatchObject({ ok: true, data: { id: "T4", cid: expect.any(String) } });
    const after = await source.read("item", "T4");
    expect(after.kind).toBe("data");
    const added = after.kind === "data" ? after.data.comments.at(-1) : undefined;
    expect(added).toMatchObject({ by: "owner", text: "한 줄 더", status: "open", kind: "comment", replies: [] });
    vi.advanceTimersByTime((SYNTHETIC_REPLY_AFTER - 1) * 1000);
    expect((await source.read("item", "T4")).kind).toBe("unchanged");
    vi.advanceTimersByTime(1000);
    const replied = await source.read("item", "T4");
    expect(replied.kind === "data" ? replied.data.comments.at(-1)?.replies : []).toMatchObject([{ by: "ag-2", result: "applied" }]);
    expect(await source.comment("T4", { text: "네", answer: true })).toMatchObject({ ok: false, status: 409 });
    expect(await source.comment("T4", { text: "   " })).toMatchObject({ ok: false, status: 422 });
  } finally {
    vi.useRealTimers();
  }
});
