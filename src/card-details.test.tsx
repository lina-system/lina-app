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
