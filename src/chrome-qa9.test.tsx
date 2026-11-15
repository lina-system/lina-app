import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { LIVE_SETTLE_MS } from "./data/live";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#172: UI QA round 9, the chrome of the three tabs.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

/** Every word the freshness line shows from now on, however briefly. */
function wordsOf(view: ReturnType<typeof render>): string[] {
  const line = () => view.queryByTestId("freshness-line")?.textContent ?? "";
  const words = [line()];
  new MutationObserver(() => {
    if (words.at(-1) !== line()) words.push(line());
  }).observe(view.container, { subtree: true, childList: true, characterData: true });
  return words;
}

// Item 1: at 390 상태 had no 메뉴, and 설정 was only the screen's last line.
test("at 390 the 상태 tab opens the same 메뉴 from its header, with 설정 in it", async () => {
  setWide(false);
  window.history.replaceState(null, "", "/app/#/status");
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  fireEvent.click(view.getByRole("button", { name: "메뉴" }));
  const menu = view.getByRole("dialog", { name: "메뉴" });
  for (const id of ["nav-today", "nav-inbox", "nav-goals", "nav-settings"]) expect(menu.querySelector(`[data-testid=${id}]`), id).toBeTruthy();
  fireEvent.click(menu.querySelector("[data-testid=nav-settings] a")!);
  await waitFor(() => expect(window.location.hash).toBe("#/settings"));
  expect(view.queryByRole("dialog", { name: "메뉴" })).toBeNull();
});

// Item 2: the live hub's stream opened a few seconds after the first read (the 대화 rows held the browser's connections),
// and the head read 갱신 지연 for a stream that had never been open.
test("a stream that connects 3 s after the first read reads 연결 중 until then, never 갱신 지연", async () => {
  vi.useFakeTimers(TIMERS);
  setWide(true);
  window.history.replaceState(null, "", "/app/#/inbox");
  const source = new SyntheticSource({ live: "down" });
  const view = render(<App store={new Store(source)} />);
  const words = wordsOf(view);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(view.getByTestId("freshness-line").textContent).toBe("연결 중");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000 - 500);
  });
  source.setStreamDown(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS * 4);
  });
  expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
  expect(words.filter((word) => word !== "불러오는 중")).toEqual(["연결 중", "실시간"]);
});

test("a connected stream that goes silent reads 갱신 지연 only after the settle time", async () => {
  vi.useFakeTimers(TIMERS);
  setWide(true);
  window.history.replaceState(null, "", "/app/#/inbox");
  const source = new SyntheticSource();
  const view = render(<App store={new Store(source)} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
  source.setStreamDown(true);
  await act(async () => source.dropStreams());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_SETTLE_MS - 1);
  });
  expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
});
