import { act, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { routePath, USAGE_RANGES, type RouteName } from "./api/client";
import { App } from "./app";
import { HttpSource } from "./data/http-source";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

/** As many work cards as the hub listed when the first screen took a minute (lina-app#100). */
const CARDS = 229;
const DETAIL_DELAY_MS = 30_000;
const CARD_DETAIL = /\/api\/plugins\/kanban\/work\/cards\/([^/?]+)$/;
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

/** The synthetic scene with finished copies of one card added until it lists CARDS work cards. */
function manyCards(): SyntheticSource {
  const { scene } = new SyntheticSource();
  const template = scene.cards.cards.find((card) => card.state === "done");
  if (!template) throw new Error("the synthetic scene has no finished card");
  const extra = Array.from({ length: CARDS - scene.cards.cards.length }, (_, index) => ({ ...template, id: `k-${1000 + index}` }));
  const details = Object.fromEntries(extra.map((card) => [card.id, { ...scene.cardDetails[template.id], id: card.id, workerRuns: [] }]));
  return new SyntheticSource({ scene: { ...scene, cards: { cards: [...scene.cards.cards, ...extra] }, cardDetails: { ...scene.cardDetails, ...details } } });
}

type Scene = SyntheticSource["scene"];
type Times = { endedAt?: number | null; lastHeartbeatAt?: number | null };

/** The synthetic scene with every work card's list row and detail passed through `edit`. */
function editedCards(edit: <C extends Times & { id: string }>(card: C) => C): SyntheticSource {
  const { scene } = new SyntheticSource();
  const cardDetails: Scene["cardDetails"] = Object.fromEntries(Object.entries(scene.cardDetails).map(([id, detail]) => [id, edit(detail)]));
  return new SyntheticSource({ scene: { ...scene, cards: { cards: scene.cards.cards.map(edit) }, cardDetails } });
}

/** Routes the fake core serves, by their path on the core. */
const SERVED: readonly (readonly [RouteName, string?])[] = [["board"], ["items"], ["goals"], ["cards"], ["inbox"], ["devices"], ["quota"], ...USAGE_RANGES.map((range) => ["usage", range] as const), ["modelsState"], ["checks"], ["settingsModels"]];

/** A core on fetch: the scene's answers by path, every request kept, a card's detail answered `delayMs` late. */
function fakeCore(scene: SyntheticSource, delayMs = 0) {
  const requests: string[] = [];
  const byPath = new Map(SERVED.map(([name, id]) => [routePath(name, id), [name, id] as const]));
  const fetchImpl = (async (input: string) => {
    requests.push(input);
    const card = CARD_DETAIL.exec(input);
    const route = card ? (["card", decodeURIComponent(card[1])] as const) : (byPath.get(input) ?? (input.includes("/record") ? (["record", decodeURIComponent(input.split("/").at(-2) ?? "")] as const) : undefined));
    if (!route) return new Response("{}", { status: 404 });
    if (card && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const result = await scene.read(route[0], route[1]);
    // A route read again with nothing new: the core answers 304, never 404.
    if (result.kind === "unchanged") return new Response(null, { status: 304 });
    if (result.kind !== "data") return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(result.data), { status: 200 });
  }) as typeof fetch;
  return { requests, fetchImpl, details: () => requests.flatMap((url) => CARD_DETAIL.exec(url)?.[1] ?? []) };
}

/** The change stream stays connecting: these tests are about the reads. */
class QuietSocket {
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  close() {}
}

function mount(hash: string, core: ReturnType<typeof fakeCore>) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const store = new Store(new HttpSource({ fetch: core.fetchImpl, token: "token-a", webSocket: QuietSocket as unknown as new (url: string) => WebSocket, location: { href: "http://localhost/app/" } }));
  return { store, view: render(<App store={store} />) };
}

function homeCards(view: ReturnType<typeof render>): number {
  return view.container.querySelectorAll('[data-testid=screen-running] a[href^="#/cards/"]').length;
}

function rowSub(view: ReturnType<typeof render>, id: string): string | null | undefined {
  return view.container.querySelector(`[data-testid=screen-running] li:has(> a[href="#/cards/${id}"]) .sub`)?.textContent;
}

function sectionTimes(view: ReturnType<typeof render>, id: string): (string | null)[] {
  return [...view.getByTestId(`section-${id}`).querySelectorAll(".sub")].map((line) => line.textContent);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test(`the first load of ${CARDS} work cards reads the lists once and no card's detail; opening a card reads that card alone`, async () => {
  const core = fakeCore(manyCards());
  const { store, view } = mount("#/running", core);
  await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
  await waitFor(() => expect(homeCards(view)).toBeGreaterThan(CARDS - 10));
  expect(core.requests.filter((url) => url.endsWith("/api/plugins/kanban/work/cards"))).toHaveLength(1);
  expect(core.details()).toEqual([]);

  window.location.hash = "#/cards/k-1100";
  await waitFor(() => expect(view.getByTestId("screen-card").querySelector("[data-testid=detail-loading]")).toBeNull());
  expect(core.details()).toEqual(["k-1100"]);
});

test("unopened cards take their times from the list row: a finished card's end, a stopped card's last beat", async () => {
  // k-103 stopped 52 minutes into its work; its last beat is moved to 20 minutes ago, apart from that elapsed time.
  const core = fakeCore(editedCards((card) => (card.id === "k-103" && card.lastHeartbeatAt ? { ...card, lastHeartbeatAt: card.lastHeartbeatAt + 32 * 60 } : card)));
  const { store, view } = mount("#/running", core);
  await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
  await waitFor(() => expect(rowSub(view, "k-105")).toBeTruthy());
  expect.soft(rowSub(view, "k-105")).toBe("완료 · 2시간 전");
  expect.soft(sectionTimes(view, "recent")).toEqual(["완료 · 30분 전", "완료 · 2시간 전"]);
  expect.soft(sectionTimes(view, "older")).toEqual(["완료 · 2일 전"]);
  expect.soft(rowSub(view, "k-103")).toBe("중단됨 · 응답 없음 · 20분 전");
  expect(core.details()).toEqual([]);
});

test("a core whose rows carry neither time: an unopened finished card has no time and stands with the older ones", async () => {
  const core = fakeCore(
    editedCards((card) => {
      const bare = { ...card };
      delete bare.endedAt;
      delete bare.lastHeartbeatAt;
      return bare;
    }),
  );
  const { store, view } = mount("#/running", core);
  await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
  await waitFor(() => expect(rowSub(view, "k-105")).toBe("완료"));
  expect(sectionTimes(view, "recent")).toEqual(["완료 · 30분 전"]);
  expect(sectionTimes(view, "older")).toEqual(["완료 · 2일 전", "완료"]);
  expect(rowSub(view, "k-103")).toBe("중단됨 · 응답 없음 · 52분 전");
  expect(core.details()).toEqual([]);
});

/** The run page's boxes by their head, in order. */
function runBoxes(view: ReturnType<typeof render>): (string | null)[] {
  return [...view.getByTestId("screen-run").querySelectorAll(":scope > .box > .box-head")].map((head) => head.textContent);
}

test("a card's worker run opened on its own reads its card: r1 goes on inside its card's box, and never reads 완료 기록 없음 meanwhile", async () => {
  vi.useFakeTimers(TIMERS);
  const core = fakeCore(new SyntheticSource(), DETAIL_DELAY_MS);
  const { view } = mount("#/runs/r1", core);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  // The record is in, the card is still being read: nothing on the page says whether the run goes on.
  const waiting = view.getByTestId("screen-run");
  expect(waiting.textContent).not.toContain("완료 기록 없음");
  expect(waiting.querySelector("[data-testid=detail-loading]")?.textContent).toBe("불러오는 중");
  expect(core.details()).toEqual(["k-101"]);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
  });
  const run = view.getByTestId("screen-run");
  expect(run.querySelector("[data-testid=detail-loading]")).toBeNull();
  expect(run.querySelector(".timeline-head")?.textContent).toMatch(/^라운드 3 · (어제 )?\d\d:\d\d · 진행 중$/);
  expect(runBoxes(view)).toEqual(["작업", "기록"]);
  expect(run.querySelector('a[href="#/cards/k-101"]')).not.toBeNull();
  expect(core.details()).toEqual(["k-101"]);
});

test.each([
  ["r9", "k-101"],
  ["r10", "k-101"],
  ["r2", "k-102"],
])("a card's worker run %s opened on its own stands as a run page inside its card %s, not 찾을 수 없음", async (runId, cardId) => {
  const core = fakeCore(new SyntheticSource());
  const { view } = mount(`#/runs/${runId}`, core);
  await waitFor(() => expect(view.getByTestId("screen-run").querySelector(`a[href="#/cards/${cardId}"]`)).not.toBeNull());
  expect(view.container.textContent).not.toContain("찾을 수 없음");
  expect(runBoxes(view)[0]).toBe("작업");
  expect(core.details()).toEqual([cardId]);
});

test.each(["r4", "r5"])("a card's worker run %s with no record, opened on its own, stands as a run page with one read-failed line, never 찾을 수 없음", async (runId) => {
  const core = fakeCore(new SyntheticSource());
  const { store, view } = mount(`#/runs/${runId}`, core);
  // Every text the page ever shows, so a passing 찾을 수 없음 is caught too.
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(view.container.textContent ?? ""));
  observer.observe(view.container, { childList: true, subtree: true, characterData: true });
  await waitFor(() => expect(store.status("record", runId)).toBe("missing"));
  await waitFor(() => expect(view.getByTestId("screen-run").textContent).toContain("읽기 실패: 기록"));
  observer.disconnect();
  expect(view.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("코드 작업");
  expect(seen.filter((text) => text.includes("찾을 수 없음"))).toEqual([]);
  expect(view.container.textContent).not.toContain("찾을 수 없음");
  expect(core.details()).toEqual([]);
});

test("the first load reads no card's detail on any screen but a card's run page, which reads its one card", async () => {
  for (const hash of ["#/", "#/running", "#/inbox", "#/done", "#/goals/G2", "#/items/T4", "#/runs/r6"]) {
    const core = fakeCore(new SyntheticSource());
    const { store, view } = mount(hash, core);
    await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
    if (hash === "#/runs/r6") await waitFor(() => expect(store.status("record", "r6")).toBe("ok"));
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
    expect(core.details(), hash).toEqual([]);
    view.unmount();
  }
  const core = fakeCore(new SyntheticSource());
  const { view } = mount("#/runs/r1", core);
  await waitFor(() => expect(view.getByTestId("screen-run").querySelector('a[href="#/cards/k-101"]')).not.toBeNull());
  expect(core.details()).toEqual(["k-101"]);
});

test("the lists draw while a card's detail takes 30 seconds; the open card shows its row, then fills in", async () => {
  vi.useFakeTimers(TIMERS);
  const core = fakeCore(manyCards(), DETAIL_DELAY_MS);
  const { view } = mount("#/cards/k-1100", core);
  const waitingLines = () => [...view.container.querySelectorAll("p.empty")].map((line) => line.textContent);
  expect(waitingLines().length).toBeGreaterThan(0);
  expect(waitingLines().every((line) => line === "불러오는 중")).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(homeCards(view)).toBeGreaterThan(CARDS - 10);
  const card = view.getByTestId("screen-card");
  expect(card.querySelector(".detail-title")?.textContent).toBe("백업: 지난 기록 살펴보기");
  expect(card.querySelector(".detail-head .sub")?.textContent).toMatch(/^완료/);
  expect(card.querySelector("[data-testid=detail-loading]")?.textContent).toBe("불러오는 중");
  expect(core.details()).toEqual(["k-1100"]);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
  });
  expect(view.getByTestId("screen-card").querySelector("[data-testid=detail-loading]")).toBeNull();
  expect(view.getByTestId("screen-card").textContent).toContain("지난 한 달 백업이 모두 끝까지 돌았음");
});
