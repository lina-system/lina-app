import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#149: the detail frame on a scene shaped like the real hub response. Every work card and goal the hub serves
// from its board is read-only (lina#481), old done cards keep no history (`detail: false`), comments carry machine
// notices and ids, and a decision's row and its record's head read one time.

const DAY = 86_400;
const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const LINE = new RegExp(`^${TIME} · `);

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

type Scene = SyntheticSource["scene"];
type CardComment = Scene["cardDetails"][string]["comments"][number];

/**
 * The comments the real hub served on one card, in the order it served them (not by time), with ids in their shape
 * (none real): machine notices by the dispatcher and the worker, receipts, ids and fragments, between two sentences
 * a person wrote.
 */
function realComments(now: number): CardComment[] {
  const rows: [number, string, string][] = [
    [5 * 3600, "kanban-dispatcher", "[받음] 1744 대화에 들어감: 21:44 · OT-QAX1113…"],
    [4 * 3600, "worker-a", "vs 20 14 my in '—' 24, 14 점검"],
    [3.9 * 3600, "worker-a", '.5초 무렵 "불러오는 중"이었고…'],
    [3.8 * 3600, "worker-a", "장부 G73 / T264."],
    [3 * 3600, "lina-worker", "[대기 충족] of — 돌렸다."],
    [2.5 * 3600, "worker-a", "t_27363156 레스큐 봇 확인함. 나머지는 내일"],
    [2 * 3600, "worker-a", "rc=1(없음)"],
    [1.5 * 3600, "worker-a", "[현황]"],
    [1.2 * 3600, "worker-a", "배포 순서를 정해 주시면 이어서 진행합니다."],
    [1.6 * 3600, "worker-a", "첫 화면 문구를 짧게 고쳤어요."],
  ];
  return rows.map(([ago, author, body], index) => ({ id: 100 + index, author, body, createdAt: Math.floor(now - ago) }));
}

/**
 * The synthetic scene as the real hub serves its board: every work card read-only; k-105, a done card, with no history
 * kept (`detail: false`, nothing in its detail); a question on k-112, the stopped card that waits on the owner; and
 * k-103 with the real comments.
 */
function realShaped(): SyntheticSource {
  const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true });
  const cards = scene.cards.cards.map((card) => ({ ...card, readOnly: true, ...(card.id === "k-105" ? { detail: false } : {}) }));
  const cardDetails = Object.fromEntries(
    Object.entries(scene.cardDetails).map(([id, detail]) => [
      id,
      id === "k-105"
        ? { ...detail, readOnly: true, todos: [], workerRuns: [], gates: [], comments: [], runs: [] }
        : { ...detail, readOnly: true, comments: id === "k-103" ? realComments(scene.now) : detail.comments },
    ]),
  );
  const inbox = { ...scene.inbox, questions: [...scene.inbox.questions, { ...scene.inbox.questions[0], cardId: "k-112", commentId: 9 }] };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cards: { cards }, cardDetails, inbox } });
}

test("a read-only card with a question shows the question and no place to answer; one line says it is changed on its board", async () => {
  const view = await open("#/cards/k-112", realShaped());
  const card = within(await frame(view));
  expect(card.getByTestId("decision").textContent).toContain("카드 번호를 앞 여섯 자리까지 표시할지 결정 필요");
  expect(card.queryByTestId("decision-answer")).toBeNull();
  expect(card.queryByTestId("card-answer")).toBeNull();
  expect(card.queryByRole("textbox")).toBeNull();
  expect(card.queryByRole("button", { name: "보내기" })).toBeNull();
  expect(card.getByTestId("read-only").textContent).toBe("읽기 전용 · 칸반에서 변경");
});

test("a writable card keeps its answer place and has no read-only line", async () => {
  const view = await open("#/cards/k-112", new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true }));
  const card = within(await frame(view));
  expect(card.getByTestId("card-answer")).toBeTruthy();
  expect(card.queryByTestId("read-only")).toBeNull();
});

test("a read-only stopped card's row offers no 다시 시도; a writable one still does", async () => {
  const shaped = await open("#/running", realShaped());
  expect(within(shaped.getByTestId("screen-running")).getAllByTestId("row").length).toBeGreaterThan(3);
  expect(within(shaped.getByTestId("screen-running")).queryAllByTestId("retry")).toHaveLength(0);
  shaped.unmount();
  const writable = await open("#/running", new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true }));
  expect(within(writable.getByTestId("screen-running")).queryAllByTestId("retry").length).toBeGreaterThan(0);
});

test("a to-do from the owner's own record stays writable on the read-only scene", async () => {
  const view = await open("#/items/T12", realShaped());
  const item = within(await frame(view));
  expect(item.getByTestId("decision-answer")).toBeTruthy();
  expect(item.getByRole("textbox", { name: "댓글 달기" })).toBeTruthy();
  expect(item.queryByTestId("read-only")).toBeNull();
});

test("an old done card the hub keeps no history for says so in one line instead of an empty frame", async () => {
  const view = await open("#/cards/k-105", realShaped());
  const card = await frame(view);
  expect(within(card).getByTestId("no-history").textContent).toBe("기록 보관 안 됨");
  expect(within(card).queryByTestId("timeline")).toBeNull();
  expect(within(card).queryByTestId("card-comments")).toBeNull();
});

test("a card's comments read newest first, one whole sentence each; machine notices are no line and dropped ones fold into one", async () => {
  const view = await open("#/cards/k-103", realShaped());
  await frame(view);
  const rows = within(view.getByTestId("card-comments")).getAllByTestId("history-row");
  const texts = rows.map((row) => (row.textContent ?? "").replace(LINE, ""));
  expect(texts).toEqual(["배포 순서를 정해 주시면 이어서 진행합니다.", "첫 화면 문구를 짧게 고쳤어요.", "접힌 댓글", "레스큐 봇 확인함.", "접힌 댓글 3건"]);
  for (const row of rows) expect(row.textContent).toMatch(LINE);
  const text = view.getByTestId("card-comments").textContent ?? "";
  expect(text).not.toMatch(/\[|\]|G73|T264|t_\d|rc=|OT-|vs 20|\.5초/);
});

test("comments made between rounds one after another are one 댓글 block, newest first", async () => {
  const base = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const { scene } = base;
  const now = scene.now;
  const r1 = scene.records.r1;
  // Three comments after round 2 ended and before round 3 started, and a machine receipt among them.
  const between = [
    { at: now - 30 * 60, kind: "comment" as const, text: "변경 목록은 표로 보여 주세요", count: 1 },
    { at: now - 28 * 60, kind: "comment" as const, text: "[받음] 표로 바꾸는 일 받음", count: 1 },
    { at: now - 20 * 60, kind: "comment" as const, text: "표 머리는 짧게 해 주세요.", count: 1 },
    { at: now - 15 * 60, kind: "comment" as const, text: "요약은 한 줄로 해 주세요.", count: 1 },
  ];
  const records = { ...scene.records, r1: { ...r1, comments: [r1.comments[0], ...between] } };
  const view = await open("#/cards/k-101", new SyntheticSource({ now, scene: { ...scene, records } }));
  await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
  const heads = view.getAllByTestId("timeline-block").map((block) => block.querySelector(".timeline-head")?.textContent ?? "");
  for (let index = 1; index < heads.length; index += 1) expect(heads[index] === "댓글" && heads[index - 1] === "댓글", heads.join(" | ")).toBe(false);
  const block = view.getAllByTestId("timeline-block")[1];
  const lines = [...block.querySelectorAll(".timeline-row")].map((row) => (row.textContent ?? "").replace(LINE, ""));
  expect(lines).toEqual(["요약은 한 줄로 해 주세요.", "표 머리는 짧게 해 주세요.", "변경 목록은 표로 보여 주세요"]);
});

test("a decision's row in 수신함 and its record's head read the same time", async () => {
  const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const now = scene.now;
  // As on the hub: the question was asked 18 days ago; the to-do's state moved yesterday.
  const asked = now - 18 * DAY;
  const board = { ...scene.board, inbox: { ...scene.board.inbox, decide: scene.board.inbox.decide.map((row) => (row.target === "T12" ? { ...row, at: asked } : row)) } };
  const T12 = scene.itemDetails.T12;
  const itemDetails = { ...scene.itemDetails, T12: { ...T12, stateSince: now - DAY, decision: T12.decision ? { ...T12.decision, at: asked } : null } };
  const items = { ...scene.items, items: scene.items.items.map((item) => (item.id === "T12" ? { ...item, stateSince: now - DAY } : item)) };
  const source = () => new SyntheticSource({ now, scene: { ...scene, board, itemDetails, items } });
  const inbox = await open("#/inbox", source());
  const row = inbox.getByTestId("screen-inbox").querySelector('li:has(> a[href="#/items/T12"]) .time')?.textContent;
  expect(row).toBe("18일 전");
  inbox.unmount();
  const view = await open("#/items/T12", source());
  const head = (await frame(view)).querySelector(".detail-head .time")?.textContent ?? "";
  expect(head.replace(/^ · /, "")).toBe(row);
});
