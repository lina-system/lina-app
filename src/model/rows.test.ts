import { expect, test } from "vitest";
import type { BoardSnapshot, ItemDetail, ItemList, WorkCardList, WorkGoal } from "../api/client";
import { CRUMB, KIND_TITLE, STATE_WORD, W } from "../words";
import { agentView, buildModel, goalCards, goalState, type CardRow, type CardSummary, type Section } from "./index";

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

function realModel(rows: readonly RealRow[] = cards) {
  return buildModel({ board, items, cards: { cards: [...rows] } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
}

/** Rows of one group a person cannot tell apart: the same title, second line and ask. */
function duplicates(rows: readonly CardRow[]): number {
  const seen = new Map<string, number>();
  for (const card of rows) {
    const key = [card.name, card.sub ?? "", card.ask ?? ""].join("\n");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
}

test("no two rows of a group read the same: a goal title that repeats takes the card's own name as the second line (lina-app#148)", () => {
  const model = realModel();
  const groups: Section<CardRow>[] = [model.home.stopped, model.home.active, model.home.planned, model.home.waiting, model.home.recent, model.home.older];
  for (const group of groups) expect(duplicates(group.rows), group.id).toBe(0);
  expect(duplicates(model.done)).toBe(0);
  const agent = agentView(model, "ag-a");
  for (const group of [agent?.running, agent?.planned]) expect(duplicates(group?.rows ?? [])).toBe(0);

  const card = (id: string) => model.done.find((each) => each.id === id);
  // The goal's title stays the row's title; the card's own name, its reference cut, is the second line.
  expect(card("d2")).toMatchObject({ name: MEMORY, sub: "가짜 이행 2단계: 허브 노드 전환" });
  // An own name that would show raw text is never drawn, nor the kind word: when it ended tells the row apart.
  expect(card("d3")?.sub).toMatch(/^\d+월 \d+일 \d{2}:\d{2}$/);
  expect(model.done.some((each) => each.sub?.includes(KIND_TITLE.code))).toBe(false);
  // A goal title that does not repeat in the group needs no second line.
  expect(card("d6")?.sub ?? null).toBeNull();
  // The planned group's two rows of one goal read apart by their own names.
  expect(model.home.planned.rows.find((each) => each.id === "p1")).toMatchObject({ name: PUSH, sub: "가짜 푸시 구독 저장" });
  // The stopped rows of one goal already read apart by their asks: no second name is added.
  expect(model.home.stopped.rows.filter((each) => each.name === ORDER).map((each) => each.sub ?? null)).toEqual([null, null, null]);
});

test("every stopped card is a row: a reference and a hash are cut from its title, and the head counts the rows (lina-app#148)", () => {
  const model = realModel();
  const stoppedCards = cards.filter((each) => each.state === "stopped");
  expect(model.home.stopped.rows).toHaveLength(stoppedCards.length);
  expect(model.home.stopped.stopped).toBe(model.home.stopped.rows.length);
  expect(model.counts.stopped).toBe(stoppedCards.length);
  // The title keeps its words once the reference and the hash are cut.
  expect(model.cards.get("s4")?.name).toBe("가상 빌드에 새 판 고정: 빌드 기기가 돌아오면");
  // Nothing is left and there is no goal: the agent's name says whose stopped card it is.
  expect(model.cards.get("s5")?.name).toBe(W.stoppedCardOf("나래"));
});

test("planned cards are their own 예정 group on the work tab, under 진행 중 (lina-app#148)", () => {
  const model = realModel();
  expect(model.home.planned.title).toBe(STATE_WORD.planned);
  expect(model.home.planned.rows.map((each) => each.id).sort()).toEqual(["p1", "p2", "p3"]);
  expect(model.home.planned.count).toBe(3);
  expect(model.home.active.rows).toHaveLength(0);
});

test("a stopped row's ask and a decision's context show only text the title rule lets through (lina-app#148)", () => {
  const model = realModel();
  const ask = (id: string) => model.cards.get(id)?.ask ?? null;
  expect(ask("s1")).toBe("가짜 묶음 주문서 폰 시험");
  // A card number in English letters, a banned word, an English word and a cut-off sentence: no line at all.
  expect(ask("s6")).toBeNull();
  expect(ask("s7")).toBeNull();
  expect(ask("s8")).toBeNull();

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
