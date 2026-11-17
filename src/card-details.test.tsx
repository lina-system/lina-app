import { act, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { routePath, USAGE_RANGES, type RouteName } from "./api/client";
import { App } from "./app";
import { HttpSource } from "./data/http-source";
import { FINISHED_SHOWN, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { buildModel } from "./model";
import { workerTitle } from "./screens/details";
import { KIND_TITLE } from "./words";

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
  // The copies sit in no goal: the core names none on their rows. Each has its own title, so none collapses into
  // another's line (lina-app#168).
  const extra = Array.from({ length: CARDS - scene.cards.cards.length }, (_, index) => ({ ...template, id: `k-${1000 + index}`, goalTitle: null, plain: { ...template.plain, title: `${template.plain.title} ${index + 1}` } }));
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

/**
 * A core on fetch: the scene's answers by path, every request kept, a card's detail answered `delayMs` late. The cards
 * list takes `finished_limit` (lina#729).
 */
function fakeCore(scene: SyntheticSource, delayMs = 0) {
  const requests: string[] = [];
  const byPath = new Map(SERVED.map(([name, id]) => [routePath(name, id), [name, id] as const]));
  const fetchImpl = (async (input: string) => {
    requests.push(input);
    const card = CARD_DETAIL.exec(input);
    const limit = new URL(input, "http://core").searchParams.get("finished_limit");
    const route = limit !== null ? (["cards", limit] as const) : card ? (["card", decodeURIComponent(card[1])] as const) : (byPath.get(input) ?? (input.includes("/record") ? (["record", decodeURIComponent(input.split("/").at(-2) ?? "")] as const) : undefined));
    if (!route) return new Response("{}", { status: 404 });
    if (card && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const result = await scene.read(route[0], route[1]);
    // A route read again with nothing new: the core answers 304, never 404.
    if (result.kind === "unchanged") return new Response(null, { status: 304 });
    if (result.kind !== "data") return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(result.data), { status: 200 });
  }) as typeof fetch;
  const reads = () => requests.flatMap((url) => CARD_DETAIL.exec(url)?.[1] ?? []);
  // The one card the scene offers 다시 시도 on is read for its comments, wherever its row is drawn (lina-app#208).
  return { requests, fetchImpl, details: () => reads().filter((id) => id !== RETRY_ROW), retryReads: () => reads().filter((id) => id === RETRY_ROW) };
}

const RETRY_ROW = "k-103";

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
  return view.container.querySelector(`[data-testid=screen-running] li:has(> a[href="#/cards/${id}"]) .sub:not(.row-sub)`)?.textContent;
}

function sectionTimes(view: ReturnType<typeof render>, id: string): (string | null)[] {
  return [...view.getByTestId(`section-${id}`).querySelectorAll(".sub:not(.row-sub)")].map((line) => line.textContent);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test(`the first load of ${CARDS} work cards reads the lists once and no card's detail but the 다시 시도 row's; opening a card reads that card alone`, async () => {
  const core = fakeCore(manyCards());
  const { store, view } = mount("#/running", core);
  await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
  // The unfinished cards and the newest finished ones (lina-app#186), from one read of the list.
  await waitFor(() => expect(view.getByTestId("section-finished").querySelectorAll("[data-testid=row]")).toHaveLength(FINISHED_SHOWN));
  expect(core.requests.filter((url) => url.includes("/api/plugins/kanban/work/cards?"))).toEqual([`/api/plugins/kanban/work/cards?finished_limit=${FINISHED_SHOWN}`]);
  expect(core.details()).toEqual([]);
  await waitFor(() => expect(core.retryReads()).toEqual([RETRY_ROW]));

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
  // r7 and r8 are worker runs with no card: no row (lina-app#141).
  expect.soft(sectionTimes(view, "finished")).toEqual(["완료 · 2시간 전"]);
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
  expect(sectionTimes(view, "finished")).toEqual(["완료"]);
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
  // The going round reads what its card does now (G138).
  expect(run.querySelector(".timeline-head")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 진행 중 · 변경마다 한 줄 요약을 붙이는 중$/);
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
  expect(view.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("제목 없음");
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

/** The words the hub served as worker run ids for one real card (lina-app#128): the commands its text names, not runs. */
const NOT_RUN_IDS = ["status", "wait", "accept", "send", "cancel", "submit", "receipts"] as const;

/**
 * k-101 as the real hub served such a card: its worker runs listed again and again, and the words of the commands in
 * its text (`lina worker status ...`) listed as worker runs of their own.
 */
function wordyCard(): SyntheticSource {
  const { scene } = new SyntheticSource();
  const detail = scene.cardDetails["k-101"];
  const seen = detail.workerRuns[0];
  const words = NOT_RUN_IDS.map((id) => ({ ...seen, id, kind: "lina-worker" as const }));
  const workerRuns = [...detail.workerRuns, ...detail.workerRuns, ...words, ...detail.workerRuns, ...words];
  const comments = [...detail.comments, { ...detail.comments[0], id: 9_128, body: "lina worker status 다음에 lina worker wait, 끝나면 lina worker accept" }];
  return new SyntheticSource({ scene: { ...scene, cardDetails: { ...scene.cardDetails, "k-101": { ...detail, workerRuns, comments } } } });
}

test("opening one card reads each worker run's record once and never reads a word that is not a run id", async () => {
  const core = fakeCore(wordyCard());
  const { store, view } = mount("#/cards/k-101", core);
  await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
  await waitFor(() => expect(store.refreshes).toBeGreaterThan(0));
  const reads = core.requests.filter((url) => url.endsWith("/record")).map((url) => decodeURIComponent(url.split("/").at(-2) ?? ""));
  expect([...reads].sort()).toEqual(["r1", "r10", "r9"]);
  // Nothing on the card links to a word as if it were a run: k-101 lists r9, r10 and r1 first, so a link names one of
  // the first three places, never a word's (lina-app#238: the address names the place, not the run).
  const places = [...view.container.querySelectorAll(`a[href^="#/cards/k-101/runs/"]`)].map((link) => Number(link.getAttribute("href")?.split("/").at(-1)));
  expect(places.length).toBeGreaterThan(0);
  expect(places.filter((place) => place > 3)).toEqual([]);
  expect(view.container.querySelectorAll(`a[href^="#/runs/"]`)).toHaveLength(0);
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
  // A finished card the first page of the list does not hold: the rest of the finished cards are read (lina-app#186).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  // The home's 완료 draws its first rows and folds the rest in its `외 n개`, one row each (lina-app#221).
  const fold = Number(/외 (\d+)개/.exec(view.getByTestId("section-finished").querySelector(".more-row")?.textContent ?? "")?.[1] ?? 0);
  expect(homeCards(view) + fold).toBeGreaterThan(CARDS - 10);
  const card = view.getByTestId("screen-card");
  expect(card.querySelector(".detail-title")?.textContent).toBe("백업: 지난 기록 살펴보기 101");
  expect(card.querySelector(".detail-head .sub")?.textContent).toMatch(/^완료/);
  expect(card.querySelector("[data-testid=detail-loading]")?.textContent).toBe("불러오는 중");
  expect(core.details()).toEqual(["k-1100"]);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
  });
  expect(view.getByTestId("screen-card").querySelector("[data-testid=detail-loading]")).toBeNull();
  expect(view.getByTestId("screen-card").textContent).toContain("지난 한 달 백업이 모두 끝까지 돌았음");
});

/** A made-up own title with Latin words in it: no row rule draws it, so the card has no own name (lina-app#248). */
const LATIN_OWN = "가상 fake sync tool 옮기기";

/** The synthetic scene with k-101's own title made LATIN_OWN, nothing checked, and the goal title `goal` on its row. */
function latinOwnCard(goal: string): SyntheticSource {
  const { scene } = new SyntheticSource();
  const retitle = <C extends { id: string; title: string; plain: { title: string | null } }>(card: C): C => (card.id === "k-101" ? { ...card, title: LATIN_OWN, plain: { ...card.plain, title: null } } : card);
  const cards = scene.cards.cards.map((card) => (card.id === "k-101" ? { ...retitle(card), goalTitle: goal } : card));
  return new SyntheticSource({ scene: { ...scene, cards: { cards }, cardDetails: { ...scene.cardDetails, "k-101": retitle(scene.cardDetails["k-101"]) } } });
}

test("a worker run of a card whose own title has Latin words reads its card's row name, its goal's title, on its page (lina-app#248)", async () => {
  const goal = "가상 목록 다시 묶기";
  const core = fakeCore(latinOwnCard(goal));
  const { view } = mount("#/runs/r1", core);
  await waitFor(() => expect(view.getByTestId("screen-run").querySelector('a[href="#/cards/k-101"]')).not.toBeNull());
  const head = view.getByTestId("screen-run").querySelector(".detail-title");
  expect(head?.textContent).toBe(goal);
  expect(head?.classList.contains("is-kind")).toBe(false);
});

test("a worker run's name is its card's row name: the goal's title, else the card's own, else its kind word; 제목 없음 only when the board does not know the card (lina-app#248)", () => {
  const card = (id: string, title: string, plainTitle: string | null, goalTitle: string | null, state: "in_progress" | "done" = "in_progress") => ({
    id,
    title,
    agent: null,
    state,
    reason: null,
    elapsedSeconds: 60,
    todoProgress: { done: 0, total: 0 },
    now: null,
    plain: { title: plainTitle, now: null, result: null },
    goalTitle,
  });
  const cards = [card("k-1", LATIN_OWN, null, "가상 화면 다시 묶기"), card("k-2", "fake sync tool 정리", null, null), card("k-3", "가상 목록 칸 고치기", "가상 목록 칸 고치기", null), card("k-4", LATIN_OWN, null, "가상 화면 다시 묶기", "done")];
  const model = buildModel({ cards: { cards }, cardDetails: {}, failed: [] }, 1_793_700_000);
  expect(workerTitle(model, "k-1")).toBe("가상 화면 다시 묶기");
  expect(workerTitle(model, "k-2")).toBe(KIND_TITLE.code);
  expect(workerTitle(model, "k-3")).toBe("가상 목록 칸 고치기");
  expect(workerTitle(model, "k-4")).toBe("가상 화면 다시 묶기");
  expect(workerTitle(model, "k-9")).toBe("제목 없음");
  expect(workerTitle(model, null)).toBe("제목 없음");
});

test("a worker run the board lists, with no title of its own, reads its card's row name on its page, as one it does not list does (lina-app#248; the hub lists a card's recent runs)", async () => {
  const goal = "가상 목록 다시 묶기";
  const { scene } = latinOwnCard(goal);
  const run = { ...scene.board.cards[0], id: "w-9001", title: "qa-topic-9", state: "done" as const, reason: null, agent: "ag-1", todo: null, card: "k-101", board: "work", plain: { title: null, now: null, result: null } };
  const detail = scene.cardDetails["k-101"];
  const core = fakeCore(
    new SyntheticSource({
      scene: {
        ...scene,
        board: { ...scene.board, cards: [...scene.board.cards, run] },
        cardDetails: { ...scene.cardDetails, "k-101": { ...detail, workerRuns: [...detail.workerRuns, { id: "w-9001", kind: "omo", firstSeenAt: run.startedAt ?? 0, lastSeenAt: run.endedAt ?? 0 }] } },
        records: { ...scene.records, "w-9001": { ...scene.records.r9, id: "w-9001", cardId: "k-101" } },
      },
    }),
  );
  const { view } = mount("#/runs/w-9001", core);
  await waitFor(() => expect(view.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe(goal));
  expect(view.getByTestId("screen-run").querySelector(".detail-title")?.classList.contains("is-kind")).toBe(false);
});
