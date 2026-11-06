import { expect, test, vi } from "vitest";
import { bootstrapOptions, HttpSource } from "./http-source";
import { chooseSource } from "./select";
import { Store } from "./store";
import type { TalkEvent } from "../api/client";
import { SCENE_COUNTS } from "../fixtures/synthetic";
import { SYNTHETIC_REPLY_AFTER, SyntheticSource, TALK_FRAME_MS, TALK_REPLY_DELTAS, UNDO_SECONDS } from "./synthetic-source";

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
  await source.read("checks");

  expect(calls.map((call) => call.url)).toEqual([
    "/core/api/plugins/kanban/work/goals",
    "/core/api/plugins/kanban/work/goals",
    "/core/api/lina/board",
    "/core/api/lina/work/items/a%20b",
    "/core/api/lina/status/checks",
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

test("&error=checks fails the checks read and leaves the other slow routes answering", async () => {
  const source = chooseSource({ search: "?source=synthetic&error=checks" }, undefined);
  expect(source).toBeInstanceOf(SyntheticSource);
  expect(await source.read("checks")).toMatchObject({ kind: "failed", offline: false });
  expect((await source.read("quota")).kind).toBe("data");
});

test("machines, quota and checks are read on the same refresh, at most once a minute", async () => {
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
    const slow = () => ["devices", "quota", "checks"].map((route) => reads.filter((name) => name === route).length);
    await store.refresh();
    expect(slow()).toEqual([1, 1, 1]);
    expect(store.get("checks")?.checks).toHaveLength(SCENE_COUNTS.checks);
    for (let tick = 1; tick <= 5; tick += 1) {
      vi.advanceTimersByTime(10_000);
      await store.refresh();
    }
    expect(slow()).toEqual([1, 1, 1]);
    expect(reads.filter((name) => name === "board")).toHaveLength(6);
    vi.advanceTimersByTime(10_000);
    await store.refresh();
    expect(slow()).toEqual([2, 2, 2]);
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
    expect(await source.comment("T4", { text: "   " })).toMatchObject({ ok: false, status: 400, detail: "text must be 1-2000 characters after trimming" });
  } finally {
    vi.useRealTimers();
  }
});

test("done, undo, retry and a card answer post to their routes with their bodies", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify(ACTION), { status: 200 }));
  const source = new HttpSource({ fetch: fetchImpl, token: "token-a" });
  await source.done("G1", { withOpen: true });
  await source.done("T3", {});
  await source.undo("G1");
  await source.retry("T5");
  await source.answerCard("k-102", { text: "네" });
  expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
    ["POST", "/api/lina/work/items/G1/done", { withOpen: true }],
    ["POST", "/api/lina/work/items/T3/done", {}],
    ["POST", "/api/lina/work/items/G1/undo", {}],
    ["POST", "/api/lina/work/items/T5/retry", {}],
    ["POST", "/api/plugins/kanban/work/inbox/k-102/answer", { text: "네" }],
  ]);
  expect(calls.every((call) => call.headers["X-Hermes-Session-Token"] === "token-a" && call.headers["Content-Type"] === "application/json")).toBe(true);
});

test("the synthetic copy marks done, refuses a goal with open to-dos, and one undo within ten minutes reopens all", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const source = new SyntheticSource();
    const scene = source.scene;
    expect(await source.done("G1", {})).toMatchObject({ ok: false, status: 409, detail: "G1에 열린 할 일이 남아 있어 완료로 표시하지 않았다: T1, T2, T3 — 함께 닫으려면 --with-open" });
    const marked = await source.done("G1", { withOpen: true });
    expect(marked).toMatchObject({ ok: true, data: { state: "done", undoUntil: expect.any(Number) } });
    expect(["G1", "T1", "T2", "T3"].map((id) => scene.itemDetails[id].state)).toEqual(["done", "done", "done", "done"]);
    expect(scene.itemDetails.G1.ownerDone?.with).toEqual(["T1", "T2", "T3"]);
    expect(scene.items.items.find((item) => item.id === "G1")?.todos).toEqual({ done: 3, total: 3 });
    expect(scene.board.inbox.mine.map((row) => row.id)).toEqual(["T9"]);
    expect(await source.undo("G1")).toMatchObject({ ok: true, data: { state: "in_progress" } });
    expect(["G1", "T1", "T2", "T3"].map((id) => scene.itemDetails[id].state)).toEqual(["in_progress", "in_progress", "waiting", "planned"]);
    expect(scene.board.inbox.mine.map((row) => row.id)).toEqual(["T3", "T9"]);
    expect(await source.undo("G1")).toMatchObject({ ok: false, status: 409 });

    await source.done("T3", {});
    vi.advanceTimersByTime((UNDO_SECONDS + 1) * 1000);
    expect(await source.undo("T3")).toMatchObject({ ok: false, status: 409, detail: expect.stringMatching(/^완료 표시 뒤 10분이 지나 되돌리지 않았다/) });
    await source.done("T9", {});
    await source.comment("T9", { text: "끝냈어요" });
    expect(await source.undo("T9")).toMatchObject({ ok: false, status: 409, detail: "T9의 마지막 기록이 주인의 완료 표시가 아니다" });
  } finally {
    vi.useRealTimers();
  }
});

test("a card answer leaves a comment on the card and takes its question out of the work inbox", async () => {
  const source = new SyntheticSource();
  expect(await source.answerCard("k-102", { text: "네, 여섯 자리까지요" })).toMatchObject({ ok: true, data: { cardId: "k-102" } });
  expect(source.scene.cardDetails["k-102"].comments.at(-1)).toMatchObject({ author: "owner", body: "네, 여섯 자리까지요" });
  expect(source.scene.inbox.questions).toEqual([]);
  expect(await source.retry("T5")).toMatchObject({ ok: true });
  expect(source.scene.itemDetails.T5.comments.at(-1)).toMatchObject({ by: "owner", text: "다시 시도해 주세요." });
  expect(source.scene.itemDetails.T5.state).toBe("stopped");
});

test("read marks post the chosen keys or all, and the synthetic copy answers the unread count", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ ok: true, unread: 3 }), { status: 200 }));
  const http = new HttpSource({ fetch: fetchImpl, token: "token-a" });
  expect(await http.readNotices({ keys: ["ask:T2:1"] })).toEqual({ ok: true, data: { ok: true, unread: 3 } });
  await http.readNotices({ all: true });
  expect(calls.map((call) => [call.url, call.body])).toEqual([
    ["/api/lina/notices/read", { keys: ["ask:T2:1"] }],
    ["/api/lina/notices/read", { all: true }],
  ]);
  const source = new SyntheticSource();
  const key = source.scene.board.notices.find((notice) => !notice.read)?.key ?? "";
  expect(await source.readNotices({ keys: [key] })).toEqual({ ok: true, data: { ok: true, unread: 4 } });
  expect(source.scene.board.counts.unread).toBe(4);
  expect(await source.readNotices({ all: true })).toEqual({ ok: true, data: { ok: true, unread: 0 } });
});

test("the synthetic talk turn streams the core's frames one TALK_FRAME_MS apart, the same on every run", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    const runs: string[][] = [];
    for (const _run of [1, 2]) {
      vi.setSystemTime(new Date("2026-03-02T09:00:00Z"));
      const source = new SyntheticSource();
      const comments = source.scene.itemDetails.T4.comments.length;
      const result = await source.talk("T4", { message: "  입력 폼 봐 주세요  " });
      if (!result.ok) throw new Error("refused");
      const seen: TalkEvent[] = [];
      const reading = (async () => {
        for await (const event of result.events) seen.push(event);
      })();
      await vi.advanceTimersByTimeAsync(TALK_FRAME_MS - 1);
      expect(seen).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen.map((event) => event.event)).toEqual(["talk.started"]);
      await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 20);
      await reading;
      expect(seen.map((event) => event.event)).toEqual(["talk.started", "run.started", "message.started", ...TALK_REPLY_DELTAS.map(() => "assistant.delta"), "assistant.completed", "talk.carried", "run.completed", "done"]);
      const started = seen[0];
      expect(started.event === "talk.started" && started.data).toMatchObject({ item: { id: "T4", title: "카드 입력 폼 다듬기" }, agent: source.scene.itemDetails.T4.agent });
      const run = seen[1];
      expect(run.event === "run.started" && run.data.user_message).toEqual({ role: "user", content: "입력 폼 봐 주세요" });
      const completed = seen.find((event) => event.event === "assistant.completed");
      expect(completed?.event === "assistant.completed" && completed.data.content).toBe(TALK_REPLY_DELTAS.join(""));
      expect(source.scene.itemDetails.T4.comments).toHaveLength(comments);
      runs.push(seen.map((event) => JSON.stringify(event)));
    }
    expect(runs[0]).toEqual(runs[1]);
  } finally {
    vi.useRealTimers();
  }
});

test("the synthetic talk turn refuses like the core: one status per case", async () => {
  const cases = [
    [new SyntheticSource({ talk: "busy" }), "T4", "안녕", 429, null],
    [new SyntheticSource({ talk: "down" }), "T4", "안녕", 503, "gateway_unreachable"],
    [new SyntheticSource({ talk: "none" }), "T4", "안녕", 409, "no_owning_agent"],
    [new SyntheticSource(), "T404", "안녕", 404, "unknown_item"],
    [new SyntheticSource(), "T4", "   ", 400, "empty_message"],
    [new SyntheticSource(), "T4", "가".repeat(4001), 413, "message_too_long"],
  ] as const;
  for (const [source, id, message, status, code] of cases) {
    expect(await source.talk(id, { message })).toEqual({ ok: false, status, code });
  }
  expect(chooseSource({ search: "?source=synthetic&talk=busy" }) instanceof SyntheticSource).toBe(true);
  const busy = chooseSource({ search: "?source=synthetic&talk=busy" });
  expect(await busy.talk("T4", { message: "안녕" })).toEqual({ ok: false, status: 429, code: null });
});

test("talk posts the message with the session token and reads the reply off the fetch body as server-sent events", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const stream = 'event: talk.started\r\ndata: {"item":{"id":"T1","title":"t"},"agent":"a","session_id":"s"}\r\n\r\n: keepalive\r\n\r\nevent: assistant.delta\r\ndata: {"session_id":"s","run_id":"r","seq":1,"ts":1,"message_id":"m","delta":"안녕"}\r\n\r\n';
  const bytes = new TextEncoder().encode(stream);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("busy")) return new Response("gateway busy", { status: 429 });
    if (url.includes("none")) return new Response(JSON.stringify({ error: { code: "no_owning_agent", message: "x" } }), { status: 409 });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const source = new HttpSource({ fetch: fetchImpl, token: "token-a" });
  const result = await source.talk("T1", { message: "안녕" });
  if (!result.ok) throw new Error("refused");
  const events: TalkEvent[] = [];
  for await (const event of result.events) events.push(event);
  expect(events.map((event) => event.event)).toEqual(["talk.started", "assistant.delta"]);
  expect(events[1].event === "assistant.delta" && events[1].data.delta).toBe("안녕");
  expect(calls[0].url).toBe("/api/lina/work/items/T1/talk");
  expect(calls[0].init.method).toBe("POST");
  expect(calls[0].init.body).toBe('{"message":"안녕"}');
  expect((calls[0].init.headers as Record<string, string>)["X-Hermes-Session-Token"]).toBe("token-a");
  expect((calls[0].init.headers as Record<string, string>).Accept).toBe("text/event-stream");
  expect(await source.talk("busy", { message: "안녕" })).toEqual({ ok: false, status: 429, code: null });
  expect(await source.talk("none", { message: "안녕" })).toEqual({ ok: false, status: 409, code: "no_owning_agent" });
});
