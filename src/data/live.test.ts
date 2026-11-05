import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eventsUrl, HttpSource } from "./http-source";
import { BACKOFF_MAX_MS, backoffMs, Live, routesFor, type LiveHost } from "./live";
import { Store } from "./store";
import { STREAM_TICK_MS, SyntheticSource } from "./synthetic-source";

/** A tab whose visibility, `online` and `pageshow` the test sets; timers are vitest's fake ones. */
function tab(random = () => 0) {
  let visibility: DocumentVisibilityState = "visible";
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, listener: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)?.add(listener);
  };
  const off = (type: string, listener: () => void) => listeners.get(type)?.delete(listener);
  const fire = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  const host: LiveHost = {
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: on,
      removeEventListener: off,
    } as unknown as LiveHost["document"],
    addEventListener: on,
    removeEventListener: off,
    setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle),
    random,
  };
  return {
    host,
    fire,
    show(state: DocumentVisibilityState) {
      visibility = state;
      fire("visibilitychange");
    },
  };
}

/** Lets the stream's microtasks and the store's reads (all promise-based on the synthetic source) finish. */
async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

async function step(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

describe("the change stream", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("one socket for the app: the first message is the tail, and the screens read once more after it", async () => {
    const source = new SyntheticSource();
    const store = new Store(source);
    const refresh = vi.spyOn(store, "refresh");
    const live = new Live(store, tab().host);
    const stop = live.start();
    await settle();
    expect(source.stream).toEqual([{ since: null, first: "tail", missed: 0, open: true }]);
    expect(store.live).toBe("open");
    expect(live.cursor).toMatch(/^s\.\d+\.0$/);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    expect(source.stream[0].open).toBe(false);
  });

  test("a reconnect with the cursor replays what was missed, and reads only what it touched", async () => {
    const source = new SyntheticSource();
    const store = new Store(source);
    const live = new Live(store, tab(() => 0).host);
    const stop = live.start();
    await settle();
    await store.refresh();
    store.ensure([["item", "T4"]]);
    await settle();
    const kept = live.cursor;

    source.dropStreams();
    expect(store.live).toBe("down");
    const otherDevice = new SyntheticSource({ scene: source.scene });
    await otherDevice.comment("T4", { text: "폭도 봐 주세요" });
    const refresh = vi.spyOn(store, "refresh");
    const invalidate = vi.spyOn(store, "invalidate");

    await step(backoffMs(0, () => 0));
    expect(source.stream[1]).toEqual({ since: kept, first: "missed", missed: 1, open: true });
    expect(store.live).toBe("open");
    expect(refresh).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith([["board"], ["items"], ["item", "T4"]]);
    await settle();
    expect(store.get("item", "T4")?.comments.at(-1)?.text).toBe("폭도 봐 주세요");
    expect(live.cursor).not.toBe(kept);
    stop();
  });

  test("a resync reads every snapshot once", async () => {
    const source = new SyntheticSource();
    const store = new Store(source);
    const stop = new Live(store, tab().host).start();
    await settle();
    const refresh = vi.spyOn(store, "refresh");
    source.resyncStreams();
    await step(STREAM_TICK_MS * 10);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a since the stream no longer keeps gets one resync, which reads every snapshot once", async () => {
    const source = new SyntheticSource();
    const store = new Store(source);
    const live = new Live(store, tab().host);
    const stop = live.start();
    await settle();
    live.cursor = "s.999.4";
    source.dropStreams();
    const refresh = vi.spyOn(store, "refresh");
    await step(BACKOFF_MAX_MS);
    expect(source.stream[1]).toMatchObject({ since: "s.999.4", first: "resync" });
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a failed connection waits longer each time, with jitter, and nothing polls meanwhile", async () => {
    const source = new SyntheticSource({ live: "down" });
    const store = new Store(source);
    const stop = new Live(store, tab(() => 0).host).start();
    await settle();
    const reads = source.reads;
    // random 0 waits half of each doubled wait: 0.5 s, 1 s, 2 s, 4 s.
    await step(499);
    expect(source.stream).toHaveLength(1);
    await step(1);
    expect(source.stream).toHaveLength(2);
    await step(1_000);
    expect(source.stream).toHaveLength(3);
    await step(2_000);
    expect(source.stream).toHaveLength(4);
    await step(60_000);
    expect(source.stream.length).toBeLessThan(10);
    expect(source.reads).toBe(reads);
    expect(store.live).toBe("down");
    source.setStreamDown(false);
    await step(BACKOFF_MAX_MS);
    expect(store.live).toBe("open");
    stop();
  });

  test("the wait doubles up to the cap and jitters between half and all of it", () => {
    expect([0, 1, 2, 3].map((attempt) => backoffMs(attempt, () => 1))).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(backoffMs(20, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(20, () => 0)).toBe(BACKOFF_MAX_MS / 2);
  });

  test("a hidden tab closes the socket; shown again or back online, it resumes from the cursor at once", async () => {
    const source = new SyntheticSource();
    const store = new Store(source);
    const page = tab();
    const live = new Live(store, page.host);
    const stop = live.start();
    await settle();
    page.show("hidden");
    expect(source.stream[0].open).toBe(false);
    await step(BACKOFF_MAX_MS * 2);
    expect(source.stream).toHaveLength(1);
    const kept = live.cursor;
    page.show("visible");
    await settle();
    expect(source.stream[1]).toMatchObject({ since: kept, first: "missed", open: true });
    source.dropStreams();
    page.fire("online");
    await settle();
    expect(source.stream).toHaveLength(3);
    expect(source.stream[2]).toMatchObject({ since: kept, open: true });
    stop();
  });
});

describe("what a change touches", () => {
  test("work, worker and kanban events name only their routes", () => {
    const store = { cardsWithRun: (id: string) => (id === "job-1" ? ["k-101"] : []) };
    expect(routesFor([{ source: "work", kind: "commented", id: "T4", at: 1 }], store)).toEqual([["board"], ["items"], ["item", "T4"]]);
    expect(routesFor([{ source: "worker", kind: "exec_end", id: "job-1", at: 1 }], store)).toEqual([["board"], ["record", "job-1"], ["card", "k-101"]]);
    expect(routesFor([{ source: "kanban", kind: "moved", id: "k-102", at: null }], store)).toEqual([["cards"], ["goals"], ["inbox"], ["card", "k-102"], ["goal", "k-102"]]);
  });
});

describe("the core's socket", () => {
  test("goes to /api/lina/events on the page's origin with the token and the cursor", () => {
    expect(eventsUrl("https://core.example/app/#/inbox", "/base", "tok en", "c2.abc")).toBe("wss://core.example/base/api/lina/events?token=tok+en&since=c2.abc");
    expect(eventsUrl("http://127.0.0.1:9119/app/?source=x", "", null, null)).toBe("ws://127.0.0.1:9119/api/lina/events");
  });

  test("passes each message on, and an error or close ends it once; closing it ourselves says nothing", () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      closed = 0;
      constructor(readonly url: string) {
        sockets.push(this);
      }
      close() {
        this.closed += 1;
      }
    }
    const source = new HttpSource({ token: "t", webSocket: FakeSocket as unknown as new (url: string) => WebSocket, location: { href: "http://h/app/" } });
    const messages: unknown[] = [];
    let closed = 0;
    source.changes("c2.x", { message: (message) => messages.push(message), closed: () => (closed += 1) });
    expect(sockets[0].url).toBe("ws://h/api/lina/events?token=t&since=c2.x");
    sockets[0].onmessage?.({ data: JSON.stringify({ cursor: "c2.y", events: [] }) } as MessageEvent);
    sockets[0].onerror?.();
    sockets[0].onclose?.({ code: 1006 } as CloseEvent);
    expect(messages).toEqual([{ cursor: "c2.y", events: [] }]);
    expect(closed).toBe(1);

    const mine = source.changes(null, { message: () => {}, closed: () => (closed += 1) });
    mine.close();
    sockets[1].onclose?.({ code: 1000 } as CloseEvent);
    expect(sockets[1].closed).toBe(1);
    expect(closed).toBe(1);

    source.changes(null, { message: () => {}, closed: () => (closed += 1) });
    sockets[2].onmessage?.({ data: "not json" } as MessageEvent);
    expect(closed).toBe(2);
  });
});
