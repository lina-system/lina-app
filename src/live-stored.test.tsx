import { act, render } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { HttpSource } from "./data/http-source";
import { Live, LIVE_SETTLE_MS } from "./data/live";
import { Store } from "./data/store";
import { storedCopy, storedKey } from "./data/stored";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#194: a page opened from its kept copy draws it at once, and the freshness line says it may be old until the
// stream has caught up.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };
const ORIGIN = "https://hub.test";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function copyIn(items: Map<string, string>) {
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
  return storedCopy(new HttpSource({ fetch: (() => Promise.reject(new Error("no core"))) as typeof fetch, token: "token-a" }), { storage: () => storage, origin: ORIGIN, app: "test-1" });
}

test("a kept copy two minutes old draws its rows at once, reads 갱신 지연 while the stream is down, and nothing once it caught up", async () => {
  vi.useFakeTimers(TIMERS);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  const items = new Map<string, string>();
  const first = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const firstStore = new Store(first, { stored: copyIn(items) });
  const stop = new Live(firstStore).start();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  stop();
  const key = storedKey(ORIGIN, "");
  const kept = JSON.parse(items.get(key) ?? "null");
  kept.routes.board.receivedAt -= 120;
  items.set(key, JSON.stringify(kept));

  window.history.replaceState(null, "", "/app/#/inbox");
  const source = new SyntheticSource({ scene: first.scene, live: "down" });
  const read = vi.spyOn(source, "read");
  const view = render(<App store={new Store(source, { stored: copyIn(items) })} />);
  const line = () => view.queryByTestId("freshness-line")?.textContent ?? "";
  const words = [line()];
  new MutationObserver(() => {
    if (words.at(-1) !== line()) words.push(line());
  }).observe(view.container, { subtree: true, childList: true, characterData: true });
  expect(view.getByRole("list", { name: "결정 필요" }).children.length).toBeGreaterThan(0);
  expect(read).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS * 2);
  });
  expect(line()).toBe("갱신 지연");
  source.setStreamDown(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS * 10);
  });
  expect(line()).toBe("");
  expect(words).toEqual(["갱신 지연", ""]);
});
