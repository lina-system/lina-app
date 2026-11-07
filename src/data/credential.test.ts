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
  const state = { ...options, ticketStatus: 200 };
  const appReads: RequestInit[] = [];
  const ticketRequests: RequestInit[] = [];
  const tickets = new Set<string>();
  const reads: { url: string; token: string | undefined }[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    if (input === "/base/api/auth/ws-ticket") {
      ticketRequests.push(init);
      if (state.ticketStatus !== 200) return new Response("{}", { status: state.ticketStatus });
      if (init.method !== "POST" || init.credentials !== "same-origin") return new Response("{}", { status: 401 });
      const ticket = `ticket-${ticketRequests.length}`;
      tickets.add(ticket);
      return Response.json({ ticket, ttl_seconds: 30 });
    }
    if (input === "/base/app/") {
      appReads.push(init);
      const script = state.serves === null ? "" : `window.__HERMES_SESSION_TOKEN__="${state.serves}";`;
      return new Response(`<!doctype html><script>${script}window.__HERMES_BASE_PATH__="/base";</script>`, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    const token = (init.headers as Record<string, string> | undefined)?.["X-Hermes-Session-Token"];
    reads.push({ url: input, token });
    if (state.serves !== null && token !== state.accepts) return new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 });
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
        const query = new URL(url).searchParams;
        const accepted = state.serves === null ? tickets.delete(query.get("ticket") ?? "") : query.get("token") === state.accepts;
        if (!accepted) {
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
  return { state, appReads, reads, ticketRequests, sockets, fetchImpl, WebSocket: FakeSocket as unknown as new (url: string) => WebSocket };
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

  test("a gated socket obtains a cookie-authenticated ticket with the base path and cursor", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    const received = vi.fn();
    const socket = source(fake, null).changes("c2.kept", { message: received, closed: vi.fn() });
    await step();
    expect(fake.sockets[0].url).toBe("ws://core.test/base/api/lina/events?ticket=ticket-1&since=c2.kept");
    expect(fake.ticketRequests).toHaveLength(1);
    expect(fake.ticketRequests[0]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(received).toHaveBeenCalledWith({ cursor: "c2.1", events: [] });
    socket.close();
  });

  test("a gated reconnect consumes a fresh ticket and keeps the last cursor", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    const store = new Store(source(fake, null));
    const stop = new Live(store, host()).start();
    await step();
    fake.sockets[0].drop();
    await step(500);
    expect(fake.ticketRequests).toHaveLength(2);
    expect(fake.sockets.map((socket) => socket.url)).toEqual([
      "ws://core.test/base/api/lina/events?ticket=ticket-1",
      "ws://core.test/base/api/lina/events?ticket=ticket-2&since=c2.1",
    ]);
    expect(store.live).toBe("open");
    stop();
  });

  test("a token socket opens immediately without asking for a ticket", async () => {
    const fake = core({ accepts: "token", serves: "token" });
    const socket = source(fake, "token").changes("c2.kept", { message: vi.fn(), closed: vi.fn() });
    expect(fake.sockets[0].url).toBe("ws://core.test/base/api/lina/events?token=token&since=c2.kept");
    await step();
    expect(fake.sockets[0].open).toBe(true);
    expect(fake.ticketRequests).toHaveLength(0);
    socket.close();
  });

  test("a ticket 401 marks the gated page denied without renewal or retries", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    fake.state.ticketStatus = 401;
    const store = new Store(source(fake, null));
    const stop = new Live(store, host()).start();
    await step();
    expect(store.denied).toBe(true);
    await step(120_000);
    expect(fake.ticketRequests).toHaveLength(1);
    expect(fake.sockets).toHaveLength(0);
    expect(fake.appReads).toHaveLength(0);
    stop();
  });

  test("a temporary ticket failure retries with a new request instead of signing out", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    fake.state.ticketStatus = 503;
    const store = new Store(source(fake, null));
    const stop = new Live(store, host()).start();
    await step();
    expect(fake.sockets).toHaveLength(0);
    expect(store.denied).toBe(false);
    fake.state.ticketStatus = 200;
    await step(500);
    expect(fake.ticketRequests).toHaveLength(2);
    expect(store.live).toBe("open");
    stop();
  });

  test("closing while a ticket is pending never opens a socket or reports a close", async () => {
    const fake = core({ accepts: "cookie", serves: null });
    let finish: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const closed = vi.fn();
    const http = new HttpSource({ fetch: () => pending, webSocket: fake.WebSocket, location: { href: "http://core.test/app/" } });
    const socket = http.changes(null, { message: vi.fn(), closed });
    socket.close();
    finish?.(Response.json({ ticket: "late", ttl_seconds: 30 }));
    await step();
    expect(fake.sockets).toHaveLength(0);
    expect(closed).not.toHaveBeenCalled();
  });
});
