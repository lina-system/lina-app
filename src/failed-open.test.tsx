import { act, render } from "@testing-library/preact";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Live, type LiveHost } from "./data/live";
import { nowSeconds, type Source } from "./data/source";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#199: an open whose reads all failed heals by itself once the core answers.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

beforeEach(() => {
  vi.useFakeTimers(TIMERS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** A core whose reads answer 500 while `failing` holds (the stream still opens), counting every read it is asked. */
function flakyCore(options: { denied?: boolean } = {}) {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const core = { source, failing: true, reads: 0 };
  const read = source.read.bind(source);
  source.read = ((name, id) => {
    core.reads += 1;
    if (core.failing) return Promise.resolve({ kind: "failed", offline: false, at: nowSeconds(), denied: options.denied });
    return read(name, id);
  }) as Source["read"];
  if (options.denied) source.renewCredential = () => Promise.resolve("none");
  return core;
}

/** A tab whose visibility the test sets; timers are vitest's fake ones. */
function tab() {
  let visibility: DocumentVisibilityState = "visible";
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, listener: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)?.add(listener);
  };
  const off = (type: string, listener: () => void) => listeners.get(type)?.delete(listener);
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
    random: () => 1,
  };
  return {
    host,
    show(state: DocumentVisibilityState) {
      visibility = state;
      for (const listener of listeners.get("visibilitychange") ?? []) listener();
    },
  };
}

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

test("an open whose reads all failed fills by itself once the core answers, then reads nothing on the healthy screen", async () => {
  const core = flakyCore();
  const store = new Store(core.source);
  const stop = new Live(store, tab().host).start();
  await vi.advanceTimersByTimeAsync(100);
  expect(store.status("items")).toBe("failed");
  expect(store.live).toBe("open");

  // The core answers 500 for the first 15 s, then answers again; nobody touches the page.
  await vi.advanceTimersByTimeAsync(15_000);
  core.failing = false;
  await vi.advanceTimersByTimeAsync(60_000);
  for (const list of ["board", "items", "goals", "cards", "inbox"] as const) expect(store.status(list), list).toBe("ok");
  expect(store.get("items")?.items.length).toBeGreaterThan(0);

  // Healthy now: a still page reads nothing.
  const reads = core.reads;
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(core.reads).toBe(reads);
  stop();
});

test("a core that keeps failing is asked again on a bounded backoff, not forever, and never while the tab is hidden", async () => {
  const core = flakyCore();
  const store = new Store(core.source);
  const page = tab();
  const stop = new Live(store, page.host).start();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const tried = core.reads;
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(core.reads).toBe(tried);

  // Shown again, the page tries once more at once, then backs off as before; hidden, it asks nothing.
  page.show("hidden");
  page.show("visible");
  await vi.advanceTimersByTimeAsync(100);
  expect(core.reads).toBeGreaterThan(tried);
  page.show("hidden");
  const hidden = core.reads;
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(core.reads).toBe(hidden);
  stop();
});

test("after the core refused the credential for good nothing is read again", async () => {
  const core = flakyCore({ denied: true });
  const store = new Store(core.source);
  const stop = new Live(store, tab().host).start();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(store.denied).toBe(true);
  const reads = core.reads;
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(core.reads).toBe(reads);
  stop();
});

for (const wide of [false, true]) {
  test(`at ${wide ? 1280 : 390} a failed open fills the home without input once the core answers`, async () => {
    setWide(wide);
    window.history.replaceState(null, "", "/app/#/");
    const core = flakyCore();
    const view = render(<App store={new Store(core.source)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    core.failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(view.getAllByTestId("row").length).toBeGreaterThan(0);
    expect(view.queryByTestId("read-failed")).toBeNull();
  });

}
