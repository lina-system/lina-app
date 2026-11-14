import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { dayLabel } from "./time";

// lina-app#161: the detail frame on scenes shaped like the real hub response (UI QA round 7): a decision said once, a
// close control on the desktop pane, one row for rounds with nothing left to read and why the card stopped above them,
// the to-do's due date as its row reads it, and one row for comments that are only fold markers. Every title and
// sentence here is made up in the hub's shape; none is real.

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, source: SyntheticSource, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = (endedRuns = false) => new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns }).scene;

const count = (text: string, part: string) => text.split(part).length - 1;

for (const wide of [true, false]) {
  test(`item 1: a decision's detail says its question once and 결정 필요 once (${wide ? "1280" : "390"})`, async () => {
    const view = await open("#/inbox", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }), wide);
    const link = view.getByRole("link", { name: /배포를 금요일 오후에 할지 결정 필요/ });
    const question = link.querySelector(".title")?.textContent ?? "";
    fireEvent.click(link);
    const item = await frame(view);
    await waitFor(() => expect(item.querySelector("[data-testid=head-line]")?.textContent).toBe(question));
    const article = item.querySelector("article.detail") as HTMLElement;
    // The question once: the head's second line. The place to answer it is still there.
    expect(count(article.textContent ?? "", question)).toBe(1);
    within(item).getByTestId("decision-answer");
    // The status word once: the state line, never again as a box head.
    expect(item.querySelector(".detail-head .sub")?.textContent).toMatch(/^대기 · 결정 필요 · \d+일 전$/);
    expect([...article.querySelectorAll(".box-head")].map((head) => head.textContent)).not.toContain("결정 필요");
    // Its age is the state line's: the box under it names the agent and the kind word only.
    expect(within(item).getByTestId("decision").textContent).not.toMatch(/\d+일 전/);
    expect(within(item).getByTestId("decision").textContent).toContain("질문");
  });
}

test("item 1: a goal's open decision is not said again in its 기록", async () => {
  const view = await open("#/inbox", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  const link = view.container.querySelector<HTMLAnchorElement>(".list-pane .decision-row a[href^='#/goals/']")!;
  const question = link.querySelector(".title")?.textContent ?? "";
  fireEvent.click(link);
  const goal = await frame(view);
  await waitFor(() => expect(goal.querySelector("[data-testid=head-line]")?.textContent).toBe(question));
  expect(count(goal.querySelector("article.detail")?.textContent ?? "", question)).toBe(1);
});

test("item 3: the desktop pane has a close control in its head; it and Esc close the pane and focus goes back to the row", async () => {
  const view = await open("#/running", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  const row = () => view.container.querySelector<HTMLAnchorElement>(".list-pane a[href='#/cards/k-101']")!;
  for (const close of ["button", "escape"] as const) {
    fireEvent.click(row());
    const pane = await frame(view);
    const button = within(pane.querySelector(".detail-head") as HTMLElement).getByRole("button", { name: "닫기" });
    if (close === "button") fireEvent.click(button);
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(view.queryByTestId("detail-pane")).toBeNull());
    expect(window.location.hash).toBe("#/running");
    await waitFor(() => expect(document.activeElement).toBe(row()));
  }
});

test("item 3: Esc while typing Korean (composing) does not close the pane", async () => {
  const view = await open("#/running", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  fireEvent.click(view.container.querySelector<HTMLAnchorElement>(".list-pane a[href='#/cards/k-101']")!);
  await frame(view);
  fireEvent.keyDown(document, { key: "Escape", isComposing: true });
  expect(view.queryByTestId("detail-pane")).not.toBeNull();
});

test("item 3: the phone sheet keeps its own 닫기 and gets no second one in the head", async () => {
  const view = await open("#/running", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }), false);
  fireEvent.click(view.container.querySelector<HTMLAnchorElement>(".phone-main a[href='#/cards/k-101']")!);
  const sheet = await frame(view);
  expect(within(sheet).getAllByRole("button", { name: "닫기" })).toHaveLength(1);
  expect(sheet.querySelector(".detail-head [data-testid=frame-close]")).toBeNull();
});

/**
 * The hub's stopped card: read-only, waiting on the owner's decision, seven ended rounds whose only line is a path the
 * screen may not show, each with one worker run the board does not list.
 */
function sevenRoundsScene() {
  const scene = base(true);
  const id = "k-108";
  const ask = "보고서 받는 사람 확인 필요";
  const cards = { cards: scene.cards.cards.map((card) => (card.id === id ? { ...card, reason: "decision", ask, readOnly: true } : card)) };
  const runs = Array.from({ length: 7 }, (_, index) => {
    const startedAt = scene.now - (8 - index) * DAY;
    return { id: index + 1, startedAt, endedAt: startedAt + HOUR, lastHeartbeatAt: null, live: false, outcome: null, profile: null, status: "done", summary: `src/report-${index}.ts 경로 정리` };
  });
  const workerRuns = runs.map((run, index) => ({ id: `w${index + 1}x`, kind: "lina-worker" as const, firstSeenAt: run.startedAt + MIN, lastSeenAt: run.endedAt }));
  const cardDetails = { ...scene.cardDetails, [id]: { ...scene.cardDetails[id], reason: "decision", readOnly: true, runs, workerRuns } };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cards, cardDetails } });
}

test("item 4: rounds with nothing left to read are one 이전 기록 N건 row, and why the card stopped stands above the run box", async () => {
  const view = await open("#/cards/k-108", sevenRoundsScene());
  const card = await frame(view);
  const box = await waitFor(() => within(card).getByTestId("worker-runs"));
  const text = box.textContent ?? "";
  expect(count(text, "이전 기록")).toBe(1);
  expect(text).toContain("이전 기록 7건");
  // Every worker run still has its link (inside the folded row).
  expect(box.querySelectorAll("[data-testid=row] a")).toHaveLength(7);
  const why = within(card).getByTestId("runs-stop-why");
  expect(why.textContent).toBe("중단됨 · 결정 대기");
  // It stands above the run box.
  expect(why.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("item 4: a stopped card the core gives no reason for says the stop words its row reads above the run box, never 이유 없음", async () => {
  const view = await open("#/cards/k-108", new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true }));
  const card = await frame(view);
  const why = await waitFor(() => within(card).getByTestId("runs-stop-why"));
  expect(why.textContent).toMatch(/^중단됨 · .*확인 필요/);
  expect(why.textContent).not.toContain("이유 없음");
});

/** A local day `days` from today as the hub serves `due` (YYYY-MM-DD). */
function dayFrom(now: number, days: number): string {
  const date = new Date((now + days * DAY) * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("item 5: a to-do's detail shows the due date its row shows, red once it has passed", async () => {
  const scene = base();
  const due = dayFrom(scene.now, -2);
  const T3 = scene.itemDetails.T3;
  const items = { ...scene.items, items: scene.items.items.map((item) => (item.id === "T3" ? { ...item, due } : item)) };
  const board = { ...scene.board, inbox: { ...scene.board.inbox, mine: scene.board.inbox.mine.map((row) => (row.id === "T3" ? { ...row, due } : row)) } };
  const view = await open("#/inbox", new SyntheticSource({ now: scene.now, scene: { ...scene, board, items, itemDetails: { ...scene.itemDetails, T3: { ...T3, due } } } }));
  const row = view.container.querySelector<HTMLAnchorElement>(".list-pane a[href='#/items/T3']")!;
  const rowDate = row.querySelector(".due-date")!;
  expect(rowDate.textContent).toBe(dayLabel(due));
  fireEvent.click(row);
  const item = await frame(view);
  const line = within(item.querySelector(".detail-head") as HTMLElement).getByTestId("item-due");
  expect(line.textContent).toBe(`마감일 · ${dayLabel(due)}`);
  expect(line.querySelector(".due-date")?.classList.contains("is-overdue")).toBe(true);
});

test("item 6: comments with nothing left once folded are one 접힌 기록 N건 row, not one row each", async () => {
  const scene = base();
  const T4 = scene.itemDetails.T4;
  const at = scene.now - 30 * MIN;
  // The hub's real comment shapes, each left as debris by withoutRefs (lina-app#161 item 6); the host is an example name.
  const markers = ["백업 대체는 t_e6e0f90a 가 맡는다.", "주소: (lina-system/lina#12), (hermes-ops#277)", "주소: http://hub.example.com:8080/ 되돌릴 커밋: e37e43f"].map((text, index) => ({ cid: `m${index}`, by: "ag-2", at: at + index * MIN, text, status: "open" as const, kind: "comment" as const, replies: [] }));
  const view = await open("#/items/T4", new SyntheticSource({ now: scene.now, scene: { ...scene, itemDetails: { ...scene.itemDetails, T4: { ...T4, comments: [...T4.comments, ...markers] } } } }));
  const item = await frame(view);
  const thread = within(item).getByTestId("comments");
  expect(within(thread).getAllByTestId("folded-records").map((row) => row.textContent)).toEqual(["접힌 기록 3건"]);
  const texts = [...thread.querySelectorAll(".comment-text")].map((node) => node.textContent);
  expect(texts.some((text) => /가 맡는다|^주소$|되돌릴 커밋/.test(text ?? ""))).toBe(false);
  // The comments with words are still there, each once.
  expect(texts.length).toBe(T4.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0));
});
