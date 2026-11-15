import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import type { Store } from "./data/store";
import { Store as RealStore } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import type { CardRow } from "./model";
import { Actions, TOAST_MS } from "./ui/actions";

// lina-app#157: the detail frame on scenes shaped like the real hub response (UI QA round 6): the head is the pressed
// row, one history order, why a stopped card stopped, a retry request that stays, an answer shown once and no ids in
// history sentences. Every title and sentence here is made up in the hub's shape; none is real.

const MIN = 60;
const HOUR = 60 * MIN;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, source: SyntheticSource, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new RealStore(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const base = (endedRuns = false) => new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns }).scene;

test("item 1: a decision row opens a detail whose head is the row's line 1 and whose second line is the row's line 2, the decision below", async () => {
  const view = await open("#/inbox", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  const link = view.getByRole("link", { name: /배포를 금요일 오후에 할지 결정 필요/ });
  const line1 = link.querySelector(".context")?.textContent ?? "";
  const line2 = link.querySelector(".title")?.textContent ?? "";
  // The scene's row leads with its goal and its to-do, not the to-do's own title alone.
  expect(line1).toContain("›");
  fireEvent.click(link);
  const item = await frame(view);
  await waitFor(() => expect(item.querySelector("h1.detail-title")?.textContent).toBe(line1));
  expect(item.querySelector("[data-testid=head-line]")?.textContent).toBe(line2);
  // The question is said once, on that line: the decision box below holds the place to answer it (lina-app#161).
  expect(within(item).getByTestId("decision").textContent).not.toContain(line2);
  // The state line is still the head's first grey line (the drivers read it there).
  expect(item.querySelector(".detail-head .sub")?.querySelector("[data-testid=state]")?.textContent).toBe("결정 대기");
});

test("item 2: a card's worker runs and rounds read newest first, and a folded round line is 이전 기록, never 댓글", async () => {
  const scene = base(true);
  const k108 = scene.cardDetails["k-108"];
  const folded = { id: 1, startedAt: 0, endedAt: scene.now - 5 * HOUR, lastHeartbeatAt: null, live: false, outcome: null, profile: null, status: "done", summary: "src/report.ts 경로 정리" };
  const cardDetails = { ...scene.cardDetails, "k-108": { ...k108, runs: [folded] } };
  const view = await open("#/cards/k-108", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails } }));
  const card = await frame(view);
  const box = await waitFor(() => within(card).getByTestId("worker-runs"));
  const order = [...box.querySelectorAll("[data-testid=row] a")].map((link) => /r1[5-7]/.exec(link.getAttribute("href") ?? "")?.[0]).filter(Boolean);
  expect(order).toEqual(["r17", "r16", "r15"]);
  expect(within(box).getByTestId("round-fold").querySelector("summary")?.textContent).toBe("이전 기록 1건");
  expect(box.textContent).not.toContain("댓글");
});

/** A stopped card of the scene with the reason and ask the hub serves, the same on its list row and its detail. */
function stoppedScene(id: string, reason: string | null, ask: string | null, comments: { author: string; body: string; createdAt: number }[] = [], readOnly = true) {
  const scene = base(true);
  const cards = { cards: scene.cards.cards.map((card) => (card.id === id ? { ...card, reason, ask, readOnly } : card)) };
  const detail = scene.cardDetails[id];
  const cardDetails = { ...scene.cardDetails, [id]: { ...detail, reason, readOnly, comments: [...detail.comments, ...comments.map((comment, index) => ({ id: 900 + index, ...comment }))] } };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cards, cardDetails } });
}

async function stopWhy(id: string, source: SyntheticSource) {
  const view = await open(`#/cards/${id}`, source);
  const card = await frame(view);
  const head = card.querySelector(".detail-head") as HTMLElement;
  const state = head.querySelector(".sub [data-testid=state]")?.textContent;
  await waitFor(() => within(head).getByTestId("state"));
  return { view, card, head, state, why: within(head).queryByTestId("stop-why")?.textContent ?? null };
}

test("item 3: a stopped card waiting on a decision says 결정 대기 and its ask under the head", async () => {
  const { state, why, view } = await stopWhy("k-112", stoppedScene("k-112", "decision", "배포 순서를 정해 달라는 요청"));
  expect(state).toBe("중단됨");
  expect(why).toBe("결정 대기 · 배포 순서를 정해 달라는 요청");
  view.unmount();
});

test("item 3: a stopped card waiting on feedback says 피드백 대기 and its ask", async () => {
  const { why, view } = await stopWhy("k-112", stoppedScene("k-112", "feedback", "시안 두 개 중 하나 고르기"));
  expect(why).toBe("피드백 대기 · 시안 두 개 중 하나 고르기");
  view.unmount();
});

test("item 3: a stopped card the state line already explains has no second line saying the same (lina-app#156 + #157)", async () => {
  // The list row's stop words (결정 대기 and its ask) follow 중단됨 in the state line; the line under it would repeat them.
  const { head, why, view } = await stopWhy("k-112", stoppedScene("k-112", "decision", "배포 순서를 정해 달라는 요청", [], false));
  expect(why).toBeNull();
  expect(head.querySelector(".sub")?.textContent).toContain("중단됨 · 결정 대기 · 배포 순서를 정해 달라는 요청");
  view.unmount();
  // A card with neither a reason nor an ask reads the state line's own words, once.
  const none = await stopWhy("k-109", stoppedScene("k-109", null, null, [], false));
  expect(none.why).toBeNull();
  expect(within(none.head).queryByTestId("decided-since-stop")).toBeNull();
  none.view.unmount();
});

test("item 3: an owner decision newer than the stop is said in one line while the state is still 중단됨", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { head, view } = await stopWhy("k-112", stoppedScene("k-112", "decision", "배포 순서를 정해 달라는 요청", [{ author: "owner", body: "금요일 오후로 함.", createdAt: now - 5 * MIN }]));
  expect(within(head).getByTestId("decided-since-stop").textContent).toBe("결정 기록 있음 · 상태는 아직 중단됨");
  view.unmount();
  // An owner comment older than the stop is no such line.
  const old = await stopWhy("k-112", stoppedScene("k-112", "decision", "배포 순서를 정해 달라는 요청", [{ author: "owner", body: "금요일 오후로 함.", createdAt: now - 10 * HOUR }]));
  expect(within(old.head).queryByTestId("decided-since-stop")).toBeNull();
});

/**
 * k-103 as the core serves a work card its failure breaker gave up on (lina-app#211, a disposable core): failed, waiting
 * on the owner, not tried again, no beat on the row, stopped ten minutes ago; `comments` are the owner's, oldest first,
 * each `ago` seconds before now. The owner's comment on a card is by `owner`, as the core's answer route writes it.
 */
function gaveUp(comments: { body: string; ago: number }[]) {
  const scene = base(true);
  const stop = { state: "stopped", reason: "failed", waitingOn: "owner", retry: "none", ask: null, lastHeartbeatAt: null, endedAt: null, readOnly: false } as const;
  const cards = { cards: scene.cards.cards.map((card) => (card.id === "k-103" ? { ...card, ...stop, elapsedSeconds: 600 } : card)) };
  const run = { id: 1, profile: scene.cardDetails["k-103"].agent, status: "gave_up", outcome: "gave_up", startedAt: scene.now - 600, endedAt: scene.now - 599, lastHeartbeatAt: null, summary: null, live: false };
  const owned = comments.map((comment, index) => ({ id: 950 + index, author: "owner", body: comment.body, createdAt: scene.now - comment.ago }));
  const cardDetails = { ...scene.cardDetails, "k-103": { ...scene.cardDetails["k-103"], ...stop, elapsedSeconds: 600, runs: [run], comments: owned } };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cards, cardDetails } });
}

const RETRY = "다시 시도해 주세요.";
const DECISION = "오류 문구는 그대로 둠.";

/** The 중단됨 row of k-103 on 진행 중인 작업, then its detail opened from that row: what each says of the owner's last word. */
async function rowThenDetail(source: SyntheticSource, wide: boolean) {
  const view = await open("#/running", source, wide);
  const list = within(view.getByTestId("screen-running"));
  const link = await waitFor(() => list.getAllByRole("link").find((each) => each.getAttribute("href")?.endsWith("/cards/k-103"))!);
  const row = link.closest("li") as HTMLElement;
  // The row has read the card's comments once it reads 요청함 or offers a 다시 시도 that can be pressed.
  await waitFor(() => expect(within(row).queryByTestId("retry-requested") !== null || (within(row).queryByTestId("retry") as HTMLButtonElement | null)?.disabled === false).toBe(true), { timeout: 5000 });
  const rowSays = within(row).queryByTestId("retry-requested")?.textContent ?? null;
  fireEvent.click(link);
  const head = (await frame(view)).querySelector(".detail-head") as HTMLElement;
  await waitFor(() => within(head).getByTestId("state"));
  return { view, row, head, rowSays, requested: within(head).queryByTestId("requested-since-stop")?.textContent ?? null, decided: within(head).queryByTestId("decided-since-stop")?.textContent ?? null };
}

test("lina-app#211: a retry request newer than the stop reads as the row does, <agent>에게 요청함, never as a decision", async () => {
  for (const wide of [true, false]) {
    const { view, rowSays, requested, decided } = await rowThenDetail(gaveUp([{ body: RETRY, ago: 120 }]), wide);
    expect(rowSays).toMatch(/^\S+에게 요청함$/);
    expect(requested).toBe(rowSays);
    expect(decided).toBeNull();
    view.unmount();
  }
});

test("lina-app#211: a retry request older than the stop is neither a request nor a decision", async () => {
  const { view, row, rowSays, requested, decided } = await rowThenDetail(gaveUp([{ body: RETRY, ago: 20 * MIN }]), true);
  expect(rowSays).toBeNull();
  expect(within(row).getByTestId("retry")).toBeTruthy();
  expect(requested).toBeNull();
  expect(decided).toBeNull();
  view.unmount();
});

test("lina-app#211: a card with a decision and a retry request after the stop says both, whichever came last", async () => {
  for (const comments of [
    [{ body: DECISION, ago: 240 }, { body: RETRY, ago: 120 }],
    [{ body: RETRY, ago: 240 }, { body: DECISION, ago: 120 }],
  ]) {
    const { view, rowSays, requested, decided } = await rowThenDetail(gaveUp(comments), true);
    expect(rowSays).toMatch(/^\S+에게 요청함$/);
    expect(requested).toBe(rowSays);
    expect(decided).toBe("결정 기록 있음 · 상태는 아직 중단됨");
    view.unmount();
  }
});

test("lina-app#211: 다시 시도 pressed on the row reads 요청함 in the open detail at once, not 결정 기록 있음", async () => {
  const { view, row, head, requested } = await rowThenDetail(gaveUp([]), true);
  expect(requested).toBeNull();
  fireEvent.click(within(row).getByTestId("retry"));
  const rowSays = await waitFor(() => within(row).getByTestId("retry-requested").textContent);
  expect(rowSays).toMatch(/^\S+에게 요청함$/);
  await waitFor(() => expect(within(head).getByTestId("requested-since-stop").textContent).toBe(rowSays));
  expect(within(head).queryByTestId("decided-since-stop")).toBeNull();
  view.unmount();
});

test("item 4: the head reads the state of the row that was pressed when the detail was fetched later and moved on", async () => {
  const scene = base();
  const running = scene.cards.cards.find((card) => card.state === "in_progress")!;
  // The list said 진행 중; the detail, read ten minutes later, says 예정.
  const cardDetails = { ...scene.cardDetails, [running.id]: { ...scene.cardDetails[running.id], state: "planned" as const, reason: null } };
  const view = await open(`#/cards/${running.id}`, new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails } }));
  const card = await frame(view);
  expect(card.querySelector(".detail-head .sub [data-testid=state]")?.textContent).toBe("진행 중");
  expect(card.querySelector(".detail-head")?.textContent).not.toContain("예정");
});

/** A store with one stopped work card whose state, reason and last beat the test changes as the core would. */
function retryStore() {
  const card = { id: "k-1", state: "stopped", reason: "failed", lastHeartbeatAt: 1000, endedAt: null as number | null };
  const writes: string[] = [];
  const store = {
    get: (name: string) => (name === "cards" ? { cards: [card] } : undefined),
    write: async (send: (source: unknown) => Promise<unknown>) => {
      await send({ answerCard: async (id: string) => writes.push(`answerCard ${id}`), retry: async (id: string) => writes.push(`retry ${id}`) });
      return { ok: true, data: {} };
    },
  } as unknown as Store;
  const row = { key: "card:k-1", kind: "card", id: "k-1", todo: null, agent: "ag-1", state: "stopped" } as unknown as CardRow;
  return { card, writes, store, row };
}

test("item 5: 다시 시도 stays requested past the toast until the card's state or last event changes; a second press sends nothing", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const { card, writes, store, row } = retryStore();
  const actions = new Actions(store, () => {});
  await actions.retry(row);
  expect(writes).toEqual(["answerCard k-1"]);
  expect(actions.requested(row.key)).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(TOAST_MS * 3);
  });
  expect(actions.requested(row.key)).toBe(true);
  await actions.retry(row);
  expect(writes).toEqual(["answerCard k-1"]);
  // The card's last event moves: the request is answered, and 다시 시도 may stand again.
  card.lastHeartbeatAt = 2000;
  expect(actions.requested(row.key)).toBe(false);
});

test("item 5: a request ends when the card's state changes", async () => {
  const { card, store, row } = retryStore();
  const actions = new Actions(store, () => {});
  await actions.retry(row);
  card.state = "in_progress";
  expect(actions.requested(row.key)).toBe(false);
});

/** T2 after the owner answered: the decision answered, the answer a comment of kind answer. */
function answeredScene() {
  const scene = base();
  const T2 = scene.itemDetails.T2;
  const at = scene.now - 20 * MIN;
  const itemDetails = {
    ...scene.itemDetails,
    T2: { ...T2, state: "waiting" as const, reason: "decision", decision: T2.decision ? { ...T2.decision, answered: true, cid: "n9" } : null, comments: [...T2.comments, { cid: "n9", by: "owner", at, text: "금요일 오후", status: "open" as const, kind: "answer" as const, replies: [] }] },
  };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, itemDetails } });
}

test("item 6: an answered decision shows the answer once, in 질문 · 답, not again in 댓글", async () => {
  const view = await open("#/items/T2", answeredScene());
  const item = await frame(view);
  expect(within(item).getByTestId("decision-answered").textContent).toContain("금요일 오후");
  const comments = [...within(item).getByTestId("comments").querySelectorAll(".comment-text")].map((node) => node.textContent);
  expect(comments.length).toBeGreaterThan(0);
  expect(comments).not.toContain("금요일 오후");
});

/** Ids, a goal number and an agent-and-time bracket as the hub writes them into comments (made-up names). */
const LEAKY = ["[에이전트 · t 1a2b3c4d] 장부 목표 G901(가짜 목표 이름)에 붙였다. 목표 없이 열려 있던 카드라서 옮김.", "화면 문구를 다시 맞춤 (에이전트 16:5x).", "t_9f8e7d6c 카드에서 이어서 확인함."];
const ID = /\b[GT]\d+|t_[0-9a-f]+|\bt [0-9a-f]{6,}|\d{1,2}:\d[\dx]\b|장부|\(\s*\)/;

test("item 7: a card's history sentences show no ledger, goal, card id or agent-and-time bracket", async () => {
  const scene = base();
  const k103 = scene.cardDetails["k-103"];
  const comments = LEAKY.map((body, index) => ({ id: 700 + index, author: "ag-2", body, createdAt: scene.now - (index + 1) * 10 * MIN }));
  const view = await open("#/cards/k-103", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails: { ...scene.cardDetails, "k-103": { ...k103, comments } } } }));
  await frame(view);
  const texts = within(view.getByTestId("card-comments"))
    .getAllByTestId("history-row")
    .map((row) => (row.textContent ?? "").replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, ""));
  for (const text of texts) expect(text).not.toMatch(ID);
  expect(texts).toEqual(["목표 없이 열려 있던 카드라서 옮김.", "화면 문구를 다시 맞춤.", "카드에서 이어서 확인함."]);
});

test("item 7: a goal's history sentences show no ids either", async () => {
  const scene = base();
  const G1 = scene.itemDetails.G1;
  const comments = LEAKY.map((text, index) => ({ cid: `x${index}`, by: "ag-1", at: scene.now - (index + 1) * 10 * MIN, text, status: "open" as const, kind: "comment" as const, replies: [] }));
  const view = await open("#/goals/G1", new SyntheticSource({ now: scene.now, scene: { ...scene, itemDetails: { ...scene.itemDetails, G1: { ...G1, comments } } } }));
  const goal = await frame(view);
  const texts = [...within(goal).getByTestId("goal-history").querySelectorAll("[data-testid=history-row]")].map((row) => row.textContent ?? "");
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) expect(text.replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, "")).not.toMatch(ID);
});
