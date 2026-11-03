import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HttpSource } from "./http-source";
import { Live, type LiveHost } from "./live";
import { Store } from "./store";

/**
 * A core behind the page's origin that restarts with a new session token: reads answer 401 and sockets are refused
 * at the upgrade unless they carry `accepts`, and `/app/` serves a bootstrap script with `serves` (null: gated, no
 * token in the page).
 */
function core(options: { accepts: string; serves: string | null }) {
  const state = { ...options };
  const appReads: RequestInit[] = [];
  const reads: { url: string; token: string | undefined }[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    if (input === "/base/app/") {
      appReads.push(init);
      const script = state.serves === null ? "" : `window.__HERMES_SESSION_TOKEN__="${state.serves}";`;
      return new Response(`<!doctype html><script>${script}window.__HERMES_BASE_PATH__="/base";</script>`, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    const token = (init.headers as Record<string, string> | undefined)?.["X-Hermes-Session-Token"];
    reads.push({ url: input, token });
    if (token !== state.accepts) return new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const sockets: FakeSocket[] = [];
  class FakeSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    open = false;
    constructor(readonly url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        if (new URL(url).searchParams.get("token") !== state.accepts) {
          // A refused upgrade: the browser reports an error, then a close that never opened.
          this.onerror?.();
          this.onclose?.({ code: 1006 } as CloseEvent);
          return;
        }
        this.open = true;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ cursor: `c2.${sockets.length}`, events: [] }) } as MessageEvent);
      });
    }
    close() {}
    /** The core stops: an open socket closes as a plain drop. */
    drop() {
      this.open = false;
      this.onclose?.({ code: 1006 } as CloseEvent);
    }
  }
  return { state, appReads, reads, sockets, fetchImpl, WebSocket: FakeSocket as unknown as new (url: string) => WebSocket };
}

function host(): LiveHost {
  return {
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } as unknown as LiveHost["document"],
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle),
    random: () => 0,
  };
}

function source(fake: ReturnType<typeof core>, token: string | null) {
  return new HttpSource({ fetch: fake.fetchImpl, token, basePath: "/base", webSocket: fake.WebSocket, location: { href: "http://core.test/base/app/#/items/T1" } });
}

async function step(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("a core that restarted with a new session token", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a 401 on a read reads the page's token once more, uncached, and the next read uses it", async () => {
    const fake = core({ accepts: "new", serves: "new" });
    const store = new Store(source(fake, "old"));
    await store.refresh();
    await step();
    expect(fake.appReads).toHaveLength(1);
    expect(fake.appReads[0].cache).toBe("no-store");
    const board = fake.reads.filter((read) => read.url === "/base/api/lina/board");
    expect(board.map((read) => read.token)).toEqual(["old", "new"]);
    expect(store.get("board")).toEqual({});
    expect(store.denied).toBe(false);
  });

  test("a refused upgrade reads the token once more and reconnects at once with the kept cursor", async () => {
    const fake = core({ accepts: "old", serves: "new" });
    const store = new Store(source(fake, "old"));
    const stop = new Live(store, host()).start();
    await step();
    expect(fake.sockets).toHaveLength(1);
    expect(store.live).toBe("open");

    fake.state.accepts = "new";
    fake.sockets[0].drop();
    await step(500);
    // The retry after the drop is refused with the old token; the renewal brings the third socket at once.
    expect(new URL(fake.sockets[1].url).searchParams.get("token")).toBe("old");
    expect(fake.sockets[1].open).toBe(false);
    expect(fake.appReads).toHaveLength(1);
    expect(fake.sockets).toHaveLength(3);
    const third = new URL(fake.sockets[2].url).searchParams;
    expect(third.get("token")).toBe("new");
    expect(third.get("since")).toBe("c2.1");
    expect(store.live).toBe("open");
    stop();
  });

  test("refused again after the renewal: 연결 끊김, and nothing more is asked", async () => {
    const fake = core({ accepts: "old", serves: "new" });
    const store = new Store(source(fake, "old"));
    const stop = new Live(store, host()).start();
    await step();
    fake.state.accepts = "newer";
    fake.sockets[0].drop();
    await step(500);
    expect(fake.appReads).toHaveLength(1);
    expect(store.denied).toBe(true);
    const sockets = fake.sockets.length;
    const reads = fake.reads.length;
    await step(120_000);
    expect(fake.sockets).toHaveLength(sockets);
    expect(fake.reads).toHaveLength(reads);
    expect(fake.appReads).toHaveLength(1);
    expect(store.denied).toBe(true);
    stop();
  });

  test("a page signed in by cookie (no token in it) does not read /app/ on a 401 or a refused socket", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    const store = new Store(source(fake, null));
    const stop = new Live(store, host()).start();
    await step(10_000);
    expect(fake.reads.length).toBeGreaterThan(0);
    expect(fake.sockets.length).toBeGreaterThan(1);
    expect(fake.appReads).toHaveLength(0);
    expect(store.denied).toBe(false);
    stop();
  });
});
