import { act, render } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { LIVE_SETTLE_MS } from "./data/live";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { navigate } from "./router";

// lina-app#176: UI QA round 10, the head word flipped to 갱신 지연 while the owner moved between screens at 1280.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

let visibility: DocumentVisibilityState = "visible";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
  visibility = "visible";
  document.body.innerHTML = "";
});

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
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

async function step(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function go(hash: string) {
  await act(async () => navigate(hash));
}

function open(source: SyntheticSource) {
  vi.useFakeTimers(TIMERS);
  setWide(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  window.history.replaceState(null, "", "/app/#/inbox");
  const store = new Store(source);
  return { store, view: render(<App store={store} />) };
}

// 작업 and 대화 are two shells on a wide window: moving between them drew a new head, which forgot when the screens
// were last known current and counted from the last read instead, minutes old on a quiet stream.
test("one failed read on a quiet open stream counts from the same moment on every screen, whichever shell draws the head", async () => {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const { store, view } = open(source);
  await step(60_000);
  expect(view.getByTestId("freshness-line").textContent).toBe("");
  const read = source.read.bind(source);
  vi.spyOn(source, "read").mockImplementation(((name: Parameters<typeof read>[0], id?: string) =>
    name === "board" ? Promise.resolve({ kind: "failed", offline: false, at: Date.now() / 1000 }) : read(name, id)) as typeof source.read);
  await act(async () => store.refresh());
  const words = wordsOf(view);
  await step(5_000);
  for (const hash of ["#/talk", "#/goals/G2", "#/talk/ag-1", "#/inbox"]) {
    await go(hash);
    await step(5_000);
  }
  expect(view.getByTestId("freshness-line").textContent).toBe("갱신 25초 전");
  expect(words).not.toContain("갱신 지연");
  await step(6_000);
  expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
});

// A hidden tab closes its socket; shown again it said 갱신 지연 at once, until its reconnect answered.
test("a tab hidden for a moment shows no word throughout when its reconnect lands within the settle time", async () => {
  const { view } = open(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  await step(5_000);
  const words = wordsOf(view);
  show("hidden");
  await step(200);
  await go("#/talk");
  show("visible");
  await step(LIVE_SETTLE_MS * 2);
  expect(words).toEqual([""]);
});

test("a tab shown again whose reconnect does not land reads 갱신 지연 exactly after the settle time", async () => {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const { view } = open(source);
  await step(5_000);
  show("hidden");
  await step(60_000);
  source.setStreamDown(true);
  show("visible");
  await step(LIVE_SETTLE_MS - 1);
  expect(view.getByTestId("freshness-line").textContent).toBe("");
  await step(1);
  expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
});
