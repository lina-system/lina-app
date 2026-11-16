import { expect, test } from "vitest";
import type { BoardSnapshot, ItemDetail, ItemList, RunCard, WorkCardList, WorkGoal } from "../api/client";
import { generateScene, SYNTHETIC_SEED } from "../fixtures/synthetic";
import { CRUMB, KIND_TITLE, STATE_WORD, W } from "../words";
import { agentView, buildModel, cardCount, cardTitle, doneFor, foldTitle, goalCards, goalState, itemContext, localDay, todoState, type CardRow, type CardSummary, type Section } from "./index";

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
  const groups: Section<CardRow>[] = [model.home.stopped, model.home.active, model.home.planned, model.home.waiting, model.home.finished];
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
  // The stopped rows of one goal name their own cards too, whatever their asks (lina-app#152); an own name keeps its tool
  // names, only its references cut (lina-app#156, #225).
  expect(model.home.stopped.rows.filter((each) => each.name === ORDER).map((each) => each.sub ?? null)).toEqual(["가짜 관문: 주문 여러 건 묶기", "가짜 관문: 장 밖 주문 채우기", "가짜 매매 관문(fake-gate·fake-board)을 허브로"]);
});

// lina-app#168: the hub's finished cards whose titles differ only by a hash the screen cuts.
// A finished title is drawn as written less a ref-only bracket (lina-app#231), so the hash sits in one.
const deploy = (id: string, hash: string, endedAt: number) => row(id, `가짜 코어와 앱 빌드를 올리기 (${hash})`, "done", { endedAt });
const DEPLOY = "가짜 코어와 앱 빌드를 올리기";

test("finished cards whose visible lines are equal collapse to one line with their count and the newest time; the head counts the cards (lina-app#168, #186, #225)", () => {
  const older = ["1a2b3c4d", "5e6f7a8b", "9c0d1e2f", "3a4b5c6d", "7e8f9a0b"].map((hash, index) => deploy(`h${index + 1}`, hash, NOW - 2 * DAY - index * 600));
  const recent = [deploy("r1", "aa11bb22", NOW - 1800), deploy("r2", "cc33dd44", NOW - 600), row("r3", "가짜 다른 정리", "done", { endedAt: NOW - 900 })];
  const model = realModel([...older, ...recent]);
  // 완료: the seven deploys, recent and older, are one line ×7 named as each of them reads, opening the newest.
  expect(model.home.finished.rows.map((each) => [each.id, each.repeat ?? 1])).toEqual([
    ["r2", 7],
    ["r3", 1],
  ]);
  expect(model.home.finished.rows[0]).toMatchObject({ name: DEPLOY, endedAt: NOW - 600, when: null });
  // The head, the sidebar's 완료 and the 완료 screen count the cards these lines stand for (lina-app#179, #225).
  expect(model.home.finished.count).toBe(8);
  expect(model.counts.done).toBe(8);
  expect(cardCount(doneFor(model))).toBe(8);
  expect(doneFor(model).map((each) => [each.id, each.repeat ?? 1])).toEqual([
    ["r2", 7],
    ["r3", 1],
  ]);
  expect(model.done).toHaveLength(8);
});

// lina-app#196: the hub's finished cards, more than the first page, some with no name the screen may draw (an English
// own title and no goal) and those only past the first page, as in the hub's reply.
test("the 완료 head is every finished card on the first page and once every one is read: what has no name is one line that counts them (lina-app#196, #225)", () => {
  const named = Array.from({ length: 8 }, (_, index) => row(`n${index + 1}`, `가짜 정리 ${index + 1}단계 마치기`, "done", { endedAt: NOW - (index + 1) * 600 }));
  const unnamed = Array.from({ length: 3 }, (_, index) => row(`u${index + 1}`, `fake cleanup pass ${index + 1}`, "done", { endedAt: NOW - 2 * DAY - index * 600 }));
  const every = [...named, ...unnamed];
  // The core's first page: the five newest finished cards and the total of every one it holds (lina#729).
  const firstPage = (rows: readonly RealRow[]) => buildModel({ board, items, cards: { cards: rows.slice(0, 5), finishedTotal: rows.length } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [], finished: { total: rows.length, all: false } }, NOW);
  const first = firstPage(every);
  const opened = buildModel({ board, items, cards: { cards: every, finishedTotal: every.length } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [], finished: { total: every.length, all: true } }, NOW);

  // The first page's five rows and the six cards not read yet.
  expect(first.home.finished.rows).toHaveLength(5);
  expect(first.finished.more).toBe(6);
  expect(first.home.finished.count).toBe(11);
  expect(first.counts.done).toBe(11);
  // Opened, the head, the sidebar and the cards the rows stand for are the same number: the three nothing names are one
  // grey line ×3 (lina-app#225), never 제목 없음.
  expect(opened.home.finished.rows).toHaveLength(9);
  expect(opened.home.finished.rows.at(-1)).toMatchObject({ title: null, name: W.untitledCount(3), repeat: 3 });
  expect(opened.finished.more).toBe(0);
  expect(opened.home.finished.count).toBe(11);
  expect(opened.counts.done).toBe(11);
  expect(cardCount(doneFor(opened))).toBe(11);
  expect(opened.home.finished.rows.some((each) => each.name === W.untitled)).toBe(false);
});

// lina-app#214: the hub's finished cards in no goal whose own titles the row rule refuses only for their English words
// or references. A finished one is never read by its Hangul words: the cut leaves a hole (lina-app#231), so each is
// counted in the one grey line; the same title in any other state still reads by its Hangul words.
test("a finished card the title rule refuses for its Latin words or refs is counted in one line; in any other state it reads by its Hangul words (lina-app#214, #225, #231)", () => {
  const named = "가짜 회차 점검 정리";
  const finished = [
    row("f1", "가짜 회차 점검 fake worker run 정리", "done", { endedAt: NOW - 600 }),
    row("f2", "가짜 회차 점검 (fake runner label) 정리", "done", { endedAt: NOW - 1200 }),
    row("f7", "가짜 회차 점검·fake-gate run label check 정리", "done", { endedAt: NOW - 1500 }),
    row("f8", "fake gate run → 가짜 회차 점검 정리", "done", { endedAt: NOW - 1700 }),
    row("f3", "lina#12 fake gate pass check를 다시 돌리기", "done", { endedAt: NOW - 1800 }),
    row("f4", "fake board gate check 손봄", "done", { endedAt: NOW - 2 * DAY }),
    row("f5", "fake cleanup pass", "done", { endedAt: NOW - 2 * DAY - 600 }),
    row("f6", "t93 #4 a1b2c3d4e5", "done", { endedAt: NOW - 2 * DAY - 1200 }),
  ];
  // The same title in every other state: a run of three Latin words hides it, and it reads by its Hangul words (lina-app#225).
  const others = [row("s1", "가짜 회차 점검 fake worker run 정리", "stopped", { lastHeartbeatAt: NOW - 100 }), row("a1", "가짜 회차 점검 fake worker run 정리", "in_progress"), row("p1", "가짜 회차 점검 fake worker run 정리", "planned")];
  const model = realModel([...finished, ...others]);

  for (const card of finished) expect(model.cards.get(card.id)?.title ?? null, card.id).toBeNull();
  // The cards nothing names are one line that says how many (lina-app#225), opening the newest.
  expect(doneFor(model).map((each) => [each.id, each.title, each.repeat ?? 1])).toEqual([["f1", null, 8]]);
  expect(model.home.finished.count).toBe(finished.length);
  expect(model.counts.done).toBe(cardCount(model.home.finished.rows));

  for (const id of ["s1", "a1", "p1"]) expect(model.cards.get(id)?.name, id).toBe(named);
  expect(model.home.stopped.rows.map((each) => each.id)).toEqual(["s1"]);
  expect([...model.home.active.rows, ...model.home.planned.rows].map((each) => each.id)).toEqual(["a1", "p1"]);
});

// lina-app#222, #225: the round 18 titles, words made up: a goal title, a checked title, an own title and an ask with a
// Latin word, a product name or a round label in it. A finished card's title keeps the sentence rule and is never cut
// (lina-app#231); a running or stopped card's keeps an abbreviation (workTitle), and one with a run of three Latin words
// gives way to the next name the row has, else its kind of work.
test("a finished card's title with a Latin word is not drawn; a running or stopped card's keeps an abbreviation (lina-app#222, #225, #231)", () => {
  const plain = (title: string) => ({ title, now: null, result: null });
  const model = realModel([
    row("g1", "가짜 배경 견적 회신", "in_progress", { goalTitle: "가짜 MV 네 곡 납품" }),
    row("c1", "가짜 허브 앱 반영", "in_progress", { plain: plain("가짜 허브 앱 반영 (QA 18회차 앞)") }),
    row("f1", "가짜 PR 검사 정리 마치기", "done", { endedAt: NOW - 600 }),
    row("k1", "fake gate S2 정리", "stopped", { ask: "가짜 PR 검사 대기", lastHeartbeatAt: NOW - 100 }),
  ]);
  expect(model.home.active.rows.find((each) => each.id === "g1")).toMatchObject({ title: "가짜 MV 네 곡 납품", sub: "가짜 배경 견적 회신" });
  expect(model.cards.get("c1")?.title).toBe("가짜 허브 앱 반영 (QA 18회차 앞)");
  expect(model.cards.get("f1")?.title).toBeNull();
  // Three Latin words in a row, an ask with a Latin word and too few Hangul letters: its kind of work.
  expect(model.cards.get("k1")).toMatchObject({ title: null, name: KIND_TITLE.code });
  // A record goal's title reads by its Hangul words instead (lina-app#214), never with its Latin word.
  expect(foldTitle("가짜 MV 네 곡 납품")).toBe("가짜 네 곡 납품");
  for (const card of model.cards.values()) expect(card.name, card.id).not.toBe(W.untitled);
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

test("a to-do reads the fold of the card its runs take it on in, the same rule as its goal (lina-app#170 item 1)", () => {
  const model = liveModel();
  const todo = model.items.get("T70");
  if (!todo) throw new Error("T70 missing");
  // The record still says planned; the open card its runs belong to runs, so the goal page, the conversation goal view
  // and the to-do's own head read 진행 중, since the card started.
  expect(todo.state).toBe("planned");
  expect(todoState(model, todo)).toEqual({ state: "in_progress", reason: null, stateSince: NOW - DAY });
  // A to-do no run takes on keeps the record's state; a done one stays done.
  expect(todoState(model, { id: "T-none", state: "planned", reason: null, stateSince: NOW - 3 * DAY })).toEqual({ state: "planned", reason: null, stateSince: NOW - 3 * DAY });
  expect(todoState(model, { ...todo, state: "done" }).state).toBe("done");
  // The goal's running to-dos count it too.
  expect(model.goals.find((each) => each.id === "G7")?.runningTodos.map((each) => each.id)).toEqual(["T70"]);
  // A to-do whose card is stopped reads the stop word.
  const template = generateScene(SYNTHETIC_SEED, { now: NOW }).board.cards[0];
  const stoppedCard = row("k-stop", "가상 점검 다시 하기", "stopped", { goalTitle: LIVE_GOAL, lastHeartbeatAt: NOW - 500 });
  const run: RunCard = { ...template, id: "r9", card: "k-stop", todo: "T70", state: "done", agent: "ag-a" };
  const stopped = buildModel({ board: { ...board, cards: [run] }, items: liveItems, cards: { cards: [stoppedCard] } as WorkCardList, goals: { goals: [] }, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
  expect(todoState(stopped, todo)).toEqual({ state: "stopped", reason: null, stateSince: NOW - 500 });
});

// lina-app#170 item 2: the hub links a waiting goal's stopped cards by nothing but their `goalTitle`, the goal's title; no
// run takes on its to-dos and its detail links no card.
const waitItems: ItemList = {
  ...items,
  items: [
    { ...item("G8", "goal", ORDER, null), state: "waiting", stateSince: NOW - 2 * DAY },
    { ...item("T81", "todo", "가상 묶음 주문서 추가", "G8"), state: "waiting", reason: "feedback" },
    { ...item("T82", "todo", "가상 주문 기능 채우기", "G8"), state: "waiting", reason: "feedback" },
  ],
};

test("a goal whose cards are all stopped reads 중단됨 and lists those cards in both tabs, the work tab's fold (lina-app#170 item 2)", () => {
  const orderCards = cards.filter((each) => each.goalTitle === ORDER);
  const model = buildModel({ board, items: waitItems, cards: { cards: orderCards } as WorkCardList, goals: { goals: [] }, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
  expect(model.home.stopped.rows.map((each) => each.id)).toEqual(["s1", "s2", "s3"]);
  const detail = { id: "G8", kind: "goal", title: ORDER, state: "waiting", reason: null, stateSince: NOW - 2 * DAY, workCards: [] } as unknown as ItemDetail;
  // Its page head (opened from 작업 or 대화) and its row in the goal lists read what the work tab shows.
  expect(goalState(model, detail, { goals: [] })).toEqual({ state: "stopped", reason: null, stateSince: NOW - 100 });
  expect(model.goals.find((each) => each.id === "G8")?.state).toBe("stopped");
  // Its page lists the same cards with the same names and words as the work tab's rows.
  const lines = (rows: readonly CardRow[]) => rows.map((each) => [each.id, each.name, each.sub, each.stop?.words]);
  expect(lines(goalCards(model, detail, { goals: [] }).cards.rows)).toEqual(lines(model.home.stopped.rows));
  // A goal of another title takes none of them.
  expect(goalState(model, { ...detail, title: "가상 다른 목표" }, { goals: [] }).state).toBe("waiting");
});

test("every stopped card is a row: a reference and a hash are cut from its title, and the head counts the rows (lina-app#148)", () => {
  const model = realModel();
  const stoppedCards = cards.filter((each) => each.state === "stopped");
  expect(model.home.stopped.rows).toHaveLength(stoppedCards.length);
  expect(model.home.stopped.stopped).toBe(model.home.stopped.rows.length);
  expect(model.counts.stopped).toBe(stoppedCards.length);
  // The title keeps its words once the reference and the hash are cut, and a bracket keeps its own words (lina-app#156).
  expect(model.cards.get("s4")?.name).toBe("가상 빌드에 새 판 고정: 빌드 기기가 돌아오면 (뒷일)");
  // Nothing is left, no goal and no ask: its kind of work, never 제목 없음 (lina-app#225) or whose stopped card it is.
  expect(model.cards.get("s5")?.name).toBe(KIND_TITLE.code);
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
  // An ask with a Latin word in it is no reason a row says (lina-app#222); a banned word is not said at all.
  expect(words("s6")).toBe("결정 대기 · 이유 기록 없음");
  expect(words("s7")).toBe("결정 대기 · 이유 기록 없음");
  expect(words("s8")).toBe("결정 대기 · 이유 기록 없음");
  // The ask is never a line of its own on a row.
  expect([...model.cards.values()].filter((each) => each.ask)).toEqual([]);

  const context = (target: string) => model.inbox.rows.find((each) => each.type === "decide" && each.key === `decide:${target}`);
  // A reference is cut from a name, as from a row's title.
  expect(context("T2")).toMatchObject({ context: "가상 회신 대기" });
  expect(context("T3")).toMatchObject({ context: `가상 견적 목표${CRUMB}가상 배경 견적 회신` });
});

test("a decision row names its goal and to-do by the title rule, a name with a Latin word in it by its Hangul words (lina-app#170 item 3, #222)", () => {
  const model = realModel();
  const decision = model.inbox.rows.find((each) => each.type === "decide" && each.key === "decide:T1");
  expect(decision).toMatchObject({ context: `가상 견적 목표${CRUMB}가상 회신 대기` });
  // A name in Latin alone is an internal one and stays out; its goal still says where the decision sits.
  expect(itemContext(model.items, { title: "fake reply wait list", parent: "G1" })).toBe("가상 견적 목표");
});

test("a to-do's detail head reads its goal and its own name whether its decision is open or answered (lina-app#170 item 4)", () => {
  const head = (model: ReturnType<typeof buildModel>, id: string) => {
    const todo = model.items.get(id);
    return todo ? itemContext(model.items, todo) : null;
  };
  // While open, the head is the row that was pressed.
  const open = realModel();
  const row = open.inbox.rows.find((each) => each.type === "decide" && each.key === "decide:T3");
  expect(head(open, "T3")).toBe(row?.type === "decide" ? row.context : "-");
  // Answered (after the undo window): the row is gone, the head still reads the goal and the to-do.
  const answeredBoard = { ...board, inbox: { ...board.inbox, decide: board.inbox.decide.map((each) => ({ ...each, answered: true })) } } as BoardSnapshot;
  const answered = buildModel({ board: answeredBoard, items, cards: { cards: [...cards] } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
  expect(answered.inbox.rows.some((each) => each.type === "decide")).toBe(false);
  expect(head(answered, "T3")).toBe(`가상 견적 목표${CRUMB}가상 배경 견적 회신`);
  // A to-do with no goal reads its own name.
  expect(head(answered, "T2")).toBe("가상 회신 대기");
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

test("no row or detail title shows a card or goal id (lina-app#152, #156, #225)", () => {
  const model = realModel(idCards);
  const ids = /(?<![0-9A-Za-z])(?:t\d+|[GT]\d+|OT-\d+|t_[0-9a-f]+)(?![0-9A-Za-z])|#\d+/;
  const rows = [...model.home.stopped.rows, ...model.home.planned.rows, ...model.done];
  expect(rows).toHaveLength(idCards.length);
  for (const each of rows) for (const text of [each.name, each.sub ?? "", each.title ?? "", each.own ?? ""]) expect(text, each.id).not.toMatch(ids);
  const card = (id: string) => rows.find((each) => each.id === id);
  // A finished card's goal title and own title with an id outside a bracket are not cut (lina-app#231): no name.
  expect(model.cards.get("i1")?.title).toBeNull();
  expect(model.cards.get("i2")?.title).toBeNull();
  expect(card("i3")?.name).toBe("가짜 키 배포");
  expect(card("i4")?.name).toBe("가짜 보고서");
  // A stopped card's own title keeps a short abbreviation (lina-app#156, #225): it is the second line.
  expect(card("i5")).toMatchObject({ name: "가상 배포 목표", sub: "CLI 배포 순서 정하기" });
  expect(model.cards.get("i6")?.title).toBeNull();
  // The detail head reads the same title rule (cardTitle).
  expect(cardTitle(null, "t93 가짜 목록 정리")).toBe("가짜 목록 정리");
  expect(cardTitle(null, "CLI 배포 순서 정하기", true)).toBeNull();
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

// lina-app#198: the hub lists the owner's to-dos dated first, then undated, then the waiting ones dated or not, so a
// to-do due today that waits sat under every undated one.
test("the owner's to-dos read overdue and today first, then later dates, then undated, ties newest first (lina-app#198)", () => {
  const mine = (id: string, due: string | null, waiting = false) => ({ id, title: `가상 할 일 ${id}`, waiting, due, agent: "ag-a" });
  const created = new Map([["T21", 5], ["T22", 1], ["T23", 3], ["T24", 4], ["T25", 2], ["T26", 6]]);
  const todoItems: ItemList = { ...items, items: [...created].map(([id, daysAgo]) => ({ ...item(id, "todo", `가상 할 일 ${id}`, null), createdAt: NOW - daysAgo * DAY })) };
  // In the hub's order: dated (later, then today), undated (older first), then the waiting ones (overdue, today).
  const rows = [mine("T21", localDay(NOW + 3 * DAY)), mine("T22", localDay(NOW)), mine("T23", null), mine("T24", null), mine("T25", localDay(NOW - 2 * DAY), true), mine("T26", localDay(NOW), true)];
  const mineBoard = { ...board, inbox: { decide: [], mine: rows } } as unknown as BoardSnapshot;
  const model = buildModel({ board: mineBoard, items: todoItems, cards: { cards: [] }, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);
  const order = (rows: readonly { readonly key: string }[]) => rows.map((each) => each.key.replace("mine:", ""));
  // Overdue, then today's two newest first, then the later date, then the undated newest first.
  expect(order(model.home.mine.rows)).toEqual(["T25", "T22", "T26", "T21", "T23", "T24"]);
  expect(order(model.inbox.sections[2].rows)).toEqual(["T25", "T22", "T26", "T21", "T23", "T24"]);
});
