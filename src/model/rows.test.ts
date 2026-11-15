import { expect, test } from "vitest";
import type { BoardSnapshot, ItemDetail, ItemList, RunCard, WorkCardList, WorkGoal } from "../api/client";
import { generateScene, SYNTHETIC_SEED } from "../fixtures/synthetic";
import { CRUMB, KIND_TITLE, STATE_WORD, W } from "../words";
import { agentView, buildModel, cardTitle, goalCards, goalState, type CardRow, type CardSummary, type Section } from "./index";

/**
 * A scene in the shape of the hub's real `/work/cards` rows (lina-app#148): every row carries `goalTitle`, `ask`,
 * `waitingOn`, `readOnly` and `plain` (its checked title never written), some have no detail, one goal holds many
 * cards, a stopped card's title holds an issue reference and a commit hash, and some cards are planned. All names
 * are made up.
 */
const NOW = 1_794_600_000;
const DAY = 86_400;

type RealRow = CardSummary & { readonly readOnly: boolean; readonly detail?: boolean };

function row(id: string, title: string, state: CardSummary["state"], extra: Partial<RealRow> = {}): RealRow {
  return {
    id,
    title,
    goalTitle: null,
    agent: "ag-a",
    state,
    reason: state === "stopped" ? "decision" : null,
    waitingOn: state === "stopped" ? "owner" : null,
    retry: null,
    ask: null,
    elapsedSeconds: 600,
    todoProgress: { done: 0, total: 0 },
    now: null,
    endedAt: state === "done" ? NOW - DAY : null,
    lastHeartbeatAt: null,
    plain: { title: null, now: null, result: null },
    readOnly: true,
    detail: false,
    ...extra,
  };
}

const MEMORY = "가상 기억 저장소 하나";
const ORDER = "가상 주문 관문";
const PUSH = "가상 웹 푸시 열기";

const cards: RealRow[] = [
  // One goal, many finished cards: their own titles carry references, English words or the same words twice.
  row("d1", "가짜 이행 1단계: 노드 계약 정리 (lina#227·#228)", "done", { goalTitle: MEMORY, endedAt: NOW - 3 * DAY }),
  row("d2", "가짜 이행 2단계: 허브 노드 전환 (lina#235)", "done", { goalTitle: MEMORY, endedAt: NOW - 2 * DAY }),
  row("d3", "fake worker run 받기 정리", "done", { goalTitle: MEMORY, endedAt: NOW - 4 * DAY }),
  row("d4", "fake runner label split", "done", { goalTitle: MEMORY, endedAt: NOW - 5 * DAY }),
  row("d5", "가짜 이행 1단계: 노드 계약 정리", "done", { goalTitle: MEMORY, endedAt: NOW - 6 * DAY }),
  row("d6", "가짜 혼자 끝난 정리", "done", { goalTitle: "가상 혼자인 목표", endedAt: NOW - 3600 }),
  // Stopped cards: three under one goal with their own asks, one whose title is a reference and a hash, one with
  // nothing left once those go, and asks with raw text in them.
  row("s1", "가짜 관문: 주문 여러 건 묶기", "stopped", { goalTitle: ORDER, ask: "가짜 묶음 주문서 폰 시험", lastHeartbeatAt: NOW - 100 }),
  row("s2", "가짜 관문: 장 밖 주문 채우기", "stopped", { goalTitle: ORDER, ask: "가짜 실주문 시험", lastHeartbeatAt: NOW - 200 }),
  row("s3", "가짜 매매 관문(fake-gate·fake-board)을 허브로", "stopped", { goalTitle: ORDER, ask: "가짜 QR 로그인 승인", lastHeartbeatAt: NOW - 300 }),
  row("s4", "가상 빌드에 새 판(dev ed0972f8ce) 고정: 빌드 기기가 돌아오면 (lina#456·#454 뒷일)", "stopped", { agent: "ag-b", reason: "feedback", lastHeartbeatAt: NOW - 400 }),
  row("s5", "(lina#9) a1b2c3d4e5", "stopped", { agent: "ag-b", lastHeartbeatAt: NOW - 500 }),
  row("s6", "가짜 웹 푸시 키 배포", "stopped", { goalTitle: PUSH, ask: "가짜 봇이 lina 235 실사에서 알릴 때까지 기다림", lastHeartbeatAt: NOW - 600 }),
  row("s7", "가짜 보고 페이지 조판", "stopped", { goalTitle: "가상 보고서 다듬기", ask: "가상 지시: 쿼터 아끼려고 개발은 멈춤.", lastHeartbeatAt: NOW - 700 }),
  row("s8", "가짜 캐시 다시 쓰기 원인 찾기", "stopped", { ask: "원인은 가짜 fakeproxy의 구독 경로(이력이 안 이어지면…", lastHeartbeatAt: NOW - 800 }),
  // Planned cards (예정): two under one goal, one alone.
  row("p1", "가짜 푸시 구독 저장", "planned", { goalTitle: PUSH }),
  row("p2", "가짜 푸시 알림 보내기", "planned", { goalTitle: PUSH }),
  row("p3", "가짜 혼자 예정된 일", "planned"),
];

const items: ItemList = {
  version: 1,
  at: NOW,
  errors: [],
  owner: { id: "owner", name: "가상주인" },
  agents: [
    { id: "ag-a", name: "가온" },
    { id: "ag-b", name: "나래" },
  ],
  items: [
    { ...item("G1", "goal", "가상 견적 목표", null), state: "waiting" },
    item("T1", "todo", "fakecorp·가상 회신 대기", "G1"),
    item("T2", "todo", "가상 회신 #3 대기", null),
    item("T3", "todo", "가상 배경 견적 회신", "G1"),
  ],
};

function item(id: string, kind: "goal" | "todo", title: string, parent: string | null): ItemList["items"][number] {
  return {
    id,
    kind,
    title,
    parent,
    agent: "ag-a",
    addedBy: "ag-a",
    area: null,
    closedAt: null,
    commentCount: 0,
    createdAt: NOW - 10 * DAY,
    doneCondition: null,
    due: null,
    lastActivityAt: null,
    mine: false,
    projects: [],
    reason: null,
    runCount: 0,
    state: "in_progress",
    stateSince: NOW - 3 * DAY,
    todos: kind === "goal" ? { done: 0, total: 2 } : null,
  };
}

const decide = (target: string, title: string, at: number) => ({ target, title, agent: "ag-a", kind: "ask" as const, text: "다시 보낼까?", at, answered: false });

const board = {
  version: 1,
  at: NOW,
  errors: [],
  cards: [],
  counts: { unread: 0 },
  due: { overdue: [], today: [], week: [], later: [] },
  inbox: { decide: [decide("T1", "fakecorp·가상 회신 대기", NOW - 300), decide("T2", "가상 회신 #3 대기", NOW - 200), decide("T3", "가상 배경 견적 회신", NOW - 100)], mine: [] },
  machines: [],
  notices: [],
  quota: [],
  writer: { state: "ok", lastSuccessAt: NOW },
} as unknown as BoardSnapshot;

function realModel(rows: readonly RealRow[] = cards, runs: BoardSnapshot["cards"] = []) {
  return buildModel({ board: { ...board, cards: runs }, items, cards: { cards: [...rows] } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
}

/** Rows of one group a person cannot tell apart: the same title, second line, ask and time slot. */
function duplicates(rows: readonly CardRow[]): number {
  const seen = new Map<string, number>();
  for (const card of rows) {
    const key = [card.name, card.sub ?? "", card.ask ?? "", card.when ?? ""].join("\n");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
}

test("no two rows of a group read the same: line 1 is the goal's title, line 2 the card's own name, then when it moved (lina-app#148, #152)", () => {
  const model = realModel();
  const groups: Section<CardRow>[] = [model.home.stopped, model.home.active, model.home.planned, model.home.waiting, model.home.recent, model.home.older];
  for (const group of groups) expect(duplicates(group.rows), group.id).toBe(0);
  expect(duplicates(model.done)).toBe(0);
  const agent = agentView(model, "ag-a");
  for (const group of [agent?.running, agent?.planned]) expect(duplicates(group?.rows ?? [])).toBe(0);

  const card = (id: string) => model.done.find((each) => each.id === id);
  // The goal's title stays the row's title; the card's own name, its reference cut, is the second line.
  expect(card("d2")).toMatchObject({ name: MEMORY, sub: "가짜 이행 2단계: 허브 노드 전환" });
  // An own name that would show raw text is never drawn, nor the kind word, nor a bare time (lina-app#152).
  expect(card("d3")?.sub ?? null).toBeNull();
  expect(model.done.some((each) => each.sub?.includes(KIND_TITLE.code))).toBe(false);
  // A row whose goal title does not repeat still names its own card under it (lina-app#152).
  expect(card("d6")).toMatchObject({ name: "가상 혼자인 목표", sub: "가짜 혼자 끝난 정리" });
  // The planned group's two rows of one goal read apart by their own names.
  expect(model.home.planned.rows.find((each) => each.id === "p1")).toMatchObject({ name: PUSH, sub: "가짜 푸시 구독 저장" });
  // The stopped rows of one goal name their own cards too, whatever their asks (lina-app#152); a bracket with no ref in
  // it keeps its words (lina-app#156).
  expect(model.home.stopped.rows.filter((each) => each.name === ORDER).map((each) => each.sub ?? null)).toEqual(["가짜 관문: 주문 여러 건 묶기", "가짜 관문: 장 밖 주문 채우기", "가짜 매매 관문(fake-gate·fake-board)을 허브로"]);
});

// lina-app#168: the hub's finished cards whose titles differ only by a hash the screen cuts.
const deploy = (id: string, hash: string, endedAt: number) => row(id, `가짜 코어를 dev ${hash}로, 앱 빌드를 올리기 (가짜 반영 · #12 · · FAKE_KEY 확인)`, "done", { endedAt });
const DEPLOY = "가짜 코어를, 앱 빌드를 올리기 (가짜 반영 · 확인)";

test("finished cards whose visible lines are equal collapse to one line with their count and the newest time; the head counts lines (lina-app#168)", () => {
  const older = ["1a2b3c4d", "5e6f7a8b", "9c0d1e2f", "3a4b5c6d", "7e8f9a0b"].map((hash, index) => deploy(`h${index + 1}`, hash, NOW - 2 * DAY - index * 600));
  const recent = [deploy("r1", "aa11bb22", NOW - 1800), deploy("r2", "cc33dd44", NOW - 600), row("r3", "가짜 다른 정리", "done", { endedAt: NOW - 900 })];
  const model = realModel([...older, ...recent]);
  // 완료: five cards, one line ×5, named as each of them reads, opening the newest.
  expect(model.home.older.rows).toHaveLength(1);
  expect(model.home.older.rows[0]).toMatchObject({ id: "h1", name: DEPLOY, repeat: 5, endedAt: NOW - 2 * DAY, when: null });
  expect(model.home.older.count).toBe(1);
  // 최근 완료: its own lines, the repeated two as one line with the newer end.
  expect(model.home.recent.rows.map((each) => [each.id, each.repeat ?? 1])).toEqual([
    ["r2", 2],
    ["r3", 1],
  ]);
  expect(model.home.recent.count).toBe(2);
  // The sidebar's 완료 and the 완료 screen still count and list every card.
  expect(model.counts.done).toBe(8);
  expect(model.done).toHaveLength(8);
});

test("running, stopped and planned cards never collapse, whatever their titles (lina-app#168)", () => {
  const same = (id: string, state: CardSummary["state"]) => row(id, "가짜 같은 제목 dev 1a2b3c4d로 올리기", state, { lastHeartbeatAt: NOW - 100 });
  const model = realModel([same("a1", "in_progress"), same("a2", "in_progress"), same("b1", "stopped"), same("b2", "stopped"), same("c1", "planned"), same("c2", "planned")]);
  for (const group of [model.home.active, model.home.stopped, model.home.planned]) {
    expect(group.rows, group.id).toHaveLength(2);
    expect(group.rows.every((each) => each.repeat === undefined)).toBe(true);
  }
});

// lina-app#168 item 2: the hub's running card names its goal by `goalTitle` only; the link is its runs' to-do, a to-do
// of the record goal, while the record still says both are planned.
const LIVE_GOAL = "가상 앱을 쓸 수 있게";
const liveItems: ItemList = {
  ...items,
  items: [{ ...item("G7", "goal", LIVE_GOAL, null), state: "planned", todos: { done: 0, total: 1 } }, { ...item("T70", "todo", "가상 세 탭 점검과 수정", "G7"), state: "planned" }],
};

function liveModel() {
  const template = generateScene(SYNTHETIC_SEED, { now: NOW }).board.cards[0];
  const run = (id: string, todo: string | null, state: RunCard["state"]): RunCard => ({ ...template, id, card: "k-live", todo, state, agent: "ag-a" });
  const live = row("k-live", "가상 앱을 쓸 수 있는 수준으로: 세 탭 점검", "in_progress", { goalTitle: LIVE_GOAL, elapsedSeconds: DAY });
  return buildModel({ board: { ...board, cards: [run("r1", "T70", "done"), run("r2", null, "done")] }, items: liveItems, cards: { cards: [live] } as WorkCardList, goals: { goals: [] }, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
}

test("a goal whose to-do one running card takes on reads 진행 중 wherever it shows, the work tab's fold (lina-app#168)", () => {
  const model = liveModel();
  expect(model.home.active.rows.map((each) => [each.id, each.state, each.name])).toEqual([["k-live", "in_progress", LIVE_GOAL]]);
  const detail = { id: "G7", kind: "goal", state: "planned", reason: null, stateSince: NOW - 3 * DAY, workCards: [] } as unknown as ItemDetail;
  // The goal's page head (both tabs open it), its row in the goal lists and on the agent's card read the same.
  expect(goalState(model, detail, { goals: [] })).toEqual({ state: "in_progress", reason: null, stateSince: NOW - DAY });
  expect(model.goals.find((each) => each.id === "G7")).toMatchObject({ state: "in_progress", stateSince: NOW - DAY, runningCount: 1 });
  expect(agentView(model, "ag-a")?.goals.rows.find((each) => each.id === "G7")).toMatchObject({ state: "in_progress", runningCount: 1 });
  // A stopped card still makes it 중단됨 first; a done goal stays done.
  expect(goalState(model, { ...detail, state: "done" }, { goals: [] }).state).toBe("done");
});

test("every stopped card is a row: a reference and a hash are cut from its title, and the head counts the rows (lina-app#148)", () => {
  const model = realModel();
  const stoppedCards = cards.filter((each) => each.state === "stopped");
  expect(model.home.stopped.rows).toHaveLength(stoppedCards.length);
  expect(model.home.stopped.stopped).toBe(model.home.stopped.rows.length);
  expect(model.counts.stopped).toBe(stoppedCards.length);
  // The title keeps its words once the reference and the hash are cut, and a bracket keeps its own words (lina-app#156).
  expect(model.cards.get("s4")?.name).toBe("가상 빌드에 새 판 고정: 빌드 기기가 돌아오면 (뒷일)");
  // Nothing is left, no goal and no ask: 제목 없음, never whose stopped card it is (lina-app#156).
  expect(model.cards.get("s5")?.name).toBe(W.untitled);
});

test("planned cards are their own 예정 group on the work tab, under 진행 중 (lina-app#148)", () => {
  const model = realModel();
  expect(model.home.planned.title).toBe(STATE_WORD.planned);
  expect(model.home.planned.rows.map((each) => each.id).sort()).toEqual(["p1", "p2", "p3"]);
  expect(model.home.planned.count).toBe(3);
  expect(model.home.active.rows).toHaveLength(0);
});

test("a stopped row says its ask after why it stopped, by the title rule; a decision's context shows only text the title rule lets through (lina-app#148, #156)", () => {
  const model = realModel();
  const words = (id: string) => model.cards.get(id)?.stop?.words ?? null;
  expect(words("s1")).toBe("결정 대기 · 가짜 묶음 주문서 폰 시험");
  // A number and a lone Latin word are words of the title rule; a banned word is not said at all.
  expect(words("s6")).toBe("결정 대기 · 가짜 봇이 lina 235 실사에서 알릴 때까지 기다림");
  expect(words("s7")).toBe("결정 대기");
  // A goal-less card whose title is kept says its ask after the reason too.
  expect(words("s8")).toBe("결정 대기 · 원인은 가짜 fakeproxy의 구독 경로(이력이 안 이어지면…");
  // The ask is never a line of its own on a row.
  expect([...model.cards.values()].filter((each) => each.ask)).toEqual([]);

  const context = (target: string) => model.inbox.rows.find((each) => each.type === "decide" && each.key === `decide:${target}`);
  // The to-do's title is raw text; its goal's title still says where the decision sits.
  expect(context("T1")).toMatchObject({ context: "가상 견적 목표" });
  // Nothing passes: the context line is empty and is not drawn.
  expect(context("T2")).toMatchObject({ context: "" });
  expect(context("T3")).toMatchObject({ context: `가상 견적 목표${CRUMB}가상 배경 견적 회신` });
});

test("a goal with a stopped card reads 중단됨, the same fold the work tab shows (lina-app#148)", () => {
  const model = realModel();
  const goals: WorkGoal[] = [{ id: "kg-order", title: ORDER, agent: "ag-a", state: "in_progress", reason: null, elapsedSeconds: 60, evidence: [], workCards: cards.filter((each) => each.goalTitle === ORDER) }];
  const detail = { id: "G9", kind: "goal", state: "waiting", reason: null, stateSince: NOW - 3 * DAY, workCards: ["kg-order"] } as unknown as ItemDetail;
  expect(goalState(model, detail, { goals })).toEqual({ state: "stopped", reason: null, stateSince: NOW - 100 });
  // A goal with no stopped card keeps its own state.
  const calm = { ...detail, workCards: [] } as unknown as ItemDetail;
  expect(goalState(model, calm, { goals })).toEqual({ state: "waiting", reason: null, stateSince: NOW - 3 * DAY });
  // The goal's own card list names each card apart too.
  const listed = goalCards(model, { ...detail, workCards: ["d1", "d2", "d3"] } as unknown as ItemDetail, { goals });
  expect(duplicates(listed.cards.rows)).toBe(0);
});

// lina-app#152: the hub's titles carry card and goal ids (`t93`, `G106`, `t_586c9120`, `OT-12`, `lina#49`), and a card's
// worker run may carry the card's own id with a state of its own.
const IDS = "G78 가상 이름표 목표";
const idCards: RealRow[] = [
  row("i1", "t93 가짜 목록 정리", "done", { goalTitle: IDS, endedAt: NOW - 2 * DAY }),
  row("i2", "G106 가짜 화면 고치기", "done", { goalTitle: IDS, endedAt: NOW - 2 * DAY - 60 }),
  row("i3", "가짜 키 배포 t_586c9120", "stopped", { agent: "ag-b", lastHeartbeatAt: NOW - 50 }),
  row("i4", "OT-12 가짜 보고서 (lina#49)", "planned"),
  row("i5", "CLI 배포 순서 정하기", "stopped", { goalTitle: "가상 배포 목표", lastHeartbeatAt: NOW - 60 }),
  row("i6", "가짜 묶음 lina#49 정리", "done", { endedAt: NOW - 3 * DAY }),
];

test("no row or detail title shows a card or goal id; Latin words alone do not hide a title (lina-app#152, #156)", () => {
  const model = realModel(idCards);
  const ids = /(?<![0-9A-Za-z])(?:t\d+|[GT]\d+|OT-\d+|t_[0-9a-f]+)(?![0-9A-Za-z])|#\d+/;
  const rows = [...model.home.stopped.rows, ...model.home.planned.rows, ...model.done];
  expect(rows).toHaveLength(idCards.length);
  for (const each of rows) for (const text of [each.name, each.sub ?? "", each.title ?? "", each.own ?? ""]) expect(text, each.id).not.toMatch(ids);
  const card = (id: string) => rows.find((each) => each.id === id);
  expect(card("i1")).toMatchObject({ name: "가상 이름표 목표", sub: "가짜 목록 정리" });
  expect(card("i2")).toMatchObject({ name: "가상 이름표 목표", sub: "가짜 화면 고치기" });
  expect(card("i3")?.name).toBe("가짜 키 배포");
  expect(card("i4")?.name).toBe("가짜 보고서");
  // An abbreviation keeps a title (lina-app#156): the card's own title is its second line.
  expect(card("i5")).toMatchObject({ name: "가상 배포 목표", sub: "CLI 배포 순서 정하기" });
  expect(card("i6")?.name).toBe("가짜 묶음 정리");
  // The detail head reads the same title rule (cardTitle).
  expect(cardTitle(null, "t93 가짜 목록 정리")).toBe("가짜 목록 정리");
  expect(cardTitle(null, "CLI 배포 순서 정하기", true)).toBe("CLI 배포 순서 정하기");
  expect(cardTitle(null, "fake deploy order")).toBeNull();
});

test("a row, its detail head's row and its goal read the card's kanban status, whatever its board runs say (lina-app#152)", () => {
  const template = generateScene(SYNTHETIC_SEED, { now: NOW }).board.cards[0];
  const run = (id: string, card: string, state: RunCard["state"]): RunCard => ({ ...template, id, card, state, todo: null });
  const kanban = [row("k1", "가짜 예정 카드", "planned", { goalTitle: ORDER }), row("k2", "가짜 진행 카드", "in_progress", { goalTitle: ORDER })];
  // The hub's run of k1 carries k1's own id and already goes; k2's run stopped while its card still runs.
  const model = realModel(kanban, [run("k1", "k1", "in_progress"), run("r-k2", "k2", "stopped")]);
  expect(model.home.planned.rows.map((each) => each.id)).toEqual(["k1"]);
  expect(model.home.active.rows.map((each) => each.id)).toEqual(["k2"]);
  expect(model.home.stopped.rows).toHaveLength(0);
  expect(model.cards.get("k1")).toMatchObject({ kind: "card", state: "planned" });
  expect(model.cards.get("k2")).toMatchObject({ kind: "card", state: "in_progress" });
  expect(model.unlisted.has("k1")).toBe(false);
  expect(agentView(model, "ag-a")?.planned.rows.map((each) => each.id)).toEqual(["k1"]);
  const goals: WorkGoal[] = [{ id: "kg-order", title: ORDER, agent: "ag-a", state: "in_progress", reason: null, elapsedSeconds: 60, evidence: [], workCards: kanban }];
  const detail = { id: "G9", kind: "goal", state: "in_progress", reason: null, stateSince: NOW - DAY, workCards: ["k1", "k2"] } as unknown as ItemDetail;
  expect(goalCards(model, detail, { goals }).cards.rows.map((each) => [each.id, each.state])).toEqual([
    ["k1", "planned"],
    ["k2", "in_progress"],
  ]);
  expect(goalState(model, { ...detail, workCards: ["kg-order"] }, { goals }).state).toBe("in_progress");
});
