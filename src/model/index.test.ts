import { expect, test } from "vitest";
import type { RunCard, WorkCardDetail, WorkCardList, WorkCardSummary } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type Scene } from "../fixtures/synthetic";
import { KIND_TITLE } from "../words";
import { agentView, buildModel } from "./index";

const NOW = 1_793_700_000;

function summary(id: string, title: string, plainTitle: string | null, state: WorkCardSummary["state"]): WorkCardSummary {
  return {
    id,
    title,
    agent: null,
    state,
    reason: null,
    elapsedSeconds: 60,
    todoProgress: { done: 0, total: 0 },
    now: null,
    plain: { title: plainTitle, now: null, result: null },
  };
}

function detail(card: WorkCardSummary): WorkCardDetail {
  return {
    id: card.id,
    title: card.title,
    agent: card.agent,
    state: card.state,
    reason: card.reason,
    elapsedSeconds: card.elapsedSeconds,
    todoProgress: card.todoProgress,
    now: card.now,
    plain: card.plain,
    todos: [],
    runs: [],
    workerRuns: [],
    gates: [],
    comments: [],
  };
}

test("a work card's own title names it until its checked title exists, and its kind is read from the same text", () => {
  const running = summary("k-running", "위키: 배포 문서 정리", null, "in_progress");
  const done = summary("k-done", "결제: 안내 문서 다듬기", null, "done");
  const checked = summary("k-checked", "위키: 결제 문서 정리", "결제: 카드 입력 폼 다듬기", "done");
  // An own title that would show raw text (a file name, English words) is never drawn: the kind word stands in.
  const raw = summary("k-raw", "LINA-41 release notes / CHANGES.md", null, "done");
  const cards: WorkCardList = { cards: [running, done, checked, raw] };
  const model = buildModel(
    {
      cards,
      cardDetails: Object.fromEntries([running, done, checked, raw].map((card) => [card.id, detail(card)])),
      failed: [],
    },
    NOW,
  );

  // No checked title: the card's own title stands in, in both the running and finished lists, and its kind comes
  // from that title (문서, not the code fallback the empty checked title would give).
  expect(model.cards.get("k-running")).toMatchObject({ name: "위키: 배포 문서 정리", title: "위키: 배포 문서 정리", work: "docs" });
  expect(model.cards.get("k-done")).toMatchObject({ name: "결제: 안내 문서 다듬기", title: "결제: 안내 문서 다듬기", work: "docs" });
  expect(model.home.active.rows.map((card) => card.name)).toContain("위키: 배포 문서 정리");
  expect(model.done.map((card) => card.name)).toContain("결제: 안내 문서 다듬기");

  // A checked title wins over the card's own title, and the kind is read from the checked one.
  expect(model.cards.get("k-checked")).toMatchObject({ name: "결제: 카드 입력 폼 다듬기", title: "결제: 카드 입력 폼 다듬기", work: "code" });

  // The own title fails the raw-text rule and the card is in no goal: nothing names it, and the row says so (제목
  // 없음), never its kind word; its kind is read from the checked title alone, which does not exist.
  expect(model.cards.get("k-raw")).toMatchObject({ name: "제목 없음", title: null, work: "code" });
  expect(model.done.map((card) => card.name)).not.toContain("코드 작업");
});

/** The synthetic scene with lina-app#116's ended runs (`&runs=ended`), every card's detail read. */
function endedModel(scene: Scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true })) {
  return buildModel({ board: scene.board, items: scene.items, goals: scene.goals, cards: scene.cards, cardsAt: scene.now, inbox: scene.inbox, cardDetails: scene.cardDetails, failed: [] }, scene.now);
}

/** The same scene as the home sees it (lina-app#119): no card's detail is opened. */
function homeModel(scene: Scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true })) {
  return buildModel({ board: scene.board, items: scene.items, goals: scene.goals, cards: scene.cards, cardsAt: scene.now, inbox: scene.inbox, cardDetails: {}, failed: [] }, scene.now);
}

test("a row is named by what the work is for, never by its kind: a run with nothing to name it says 제목 없음", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const raw = scene.cards.cards.find((card) => card.id === "k-102");
  const model = endedModel({ ...scene, cards: { cards: scene.cards.cards.map((card) => (card.id === "k-102" ? { ...card, title: "LINA-41 release notes / CHANGES.md" } : card)) } });
  const kindWords: string[] = Object.values(KIND_TITLE);
  for (const row of model.cards.values()) expect(kindWords).not.toContain(row.name);
  // k-102 has no checked title and its own would show raw text: its goal names it.
  expect(raw?.plain.title).toBeNull();
  expect(model.cards.get("k-102")).toMatchObject({ title: "결제 화면 개편", name: "결제 화면 개편" });
  // r14 has no checked title, no goal or card, and its own title is a file name: no title, and its page says 제목 없음.
  expect(model.cards.get("r14")).toMatchObject({ title: null, name: "제목 없음" });
  // A run with no checked title but a plain own name is named by it.
  const named = endedModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.map((run) => (run.id === "r14" ? { ...run, title: "밤마다 미러 맞추기" } : run)) } });
  expect(named.cards.get("r14")).toMatchObject({ title: "밤마다 미러 맞추기", name: "밤마다 미러 맞추기" });
});

test("a worker run of a card or of a goal's to-do is not a row of its own; a run with no parent is", () => {
  const model = endedModel();
  const listed = new Set([...model.cards.keys()].filter((id) => !model.unlisted.has(id)));
  // r1-r5, r9, r10 belong to cards; r11 to G4's to-do T10.
  for (const id of ["r1", "r2", "r3", "r4", "r5", "r9", "r10", "r11"]) expect(listed.has(id), id).toBe(false);
  // r13 is on T13, a to-do with no goal. r8 is the earlier run of r7's finished task and r14 has nothing to name it
  // (lina-app#124): neither is a row, both stay in the lookup.
  for (const id of ["r6", "r7", "r13"]) expect(listed.has(id), id).toBe(true);
  for (const id of ["r8", "r14"]) expect(model.cards.has(id) && !listed.has(id), id).toBe(true);
  // The board does list r11 (it is outside any card): only its goal keeps it out.
  expect(generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true }).board.cards.some((run) => run.id === "r11")).toBe(true);
});

test("the stopped group holds only work that still needs someone: replaced runs and stopped work under a done goal leave it", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = endedModel(scene);
  const stopped = () => model.running.sections[0].rows.map((row) => row.id);
  // r12 was cancelled and r13, a later run of the same to-do, replaced it; r11 sits under the finished goal G4.
  // r14 has nothing to name it: it is counted on the home, not a row (lina-app#124).
  expect(new Set(stopped())).toEqual(new Set(["k-103", "k-107", "k-108", "k-109", "k-110", "k-111", "k-112", "r20"]));
  expect(model.counts.stopped).toBe(8);
  // Without the later run, r12 still needs someone.
  const alone = endedModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.filter((run) => run.id !== "r13") } });
  expect(alone.running.sections[0].rows.map((row) => row.id)).toContain("r12");
  // A stopped card whose goal is done leaves too.
  const goalDone = endedModel({ ...scene, goals: { goals: scene.goals.goals.map((goal) => (goal.id === "kg-2" ? { ...goal, state: "done" } : goal)) } });
  expect(new Set(goalDone.running.sections[0].rows.map((row) => row.id))).toEqual(new Set(["k-108", "k-109", "k-110", "k-112", "r20"]));
});

test("ended work leaves the lists but stays in the lookup that a goal page and a run page link through", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const goalDone = endedModel({ ...scene, goals: { goals: scene.goals.goals.map((goal) => (goal.id === "kg-2" ? { ...goal, state: "done" } : goal)) } });
  expect(goalDone.cards.has("k-107")).toBe(true);
  expect(goalDone.unlisted.has("k-107")).toBe(true);
  expect(goalDone.running.sections[0].rows.map((row) => row.id)).not.toContain("k-107");
  // r11 (under the finished goal G4) and r12 (replaced by r13) are not listed but still resolve.
  const model = endedModel(scene);
  for (const id of ["r11", "r12"]) expect(model.cards.has(id) && model.unlisted.has(id), id).toBe(true);
  expect(model.unlisted.has("r13")).toBe(false);
});

test("a goal's title that would show raw text does not name a row: 제목 없음 stands in", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const raw = endedModel({
    ...scene,
    goals: { goals: scene.goals.goals.map((goal) => (goal.id === "kg-2" ? { ...goal, title: "LINA-41 release notes / CHANGES.md" } : goal)) },
    cards: { cards: scene.cards.cards.map((card) => (card.id === "k-107" ? { ...card, plain: { ...card.plain, title: null }, title: "payment-receipt.md copy" } : card)) },
  });
  expect(raw.cards.get("k-107")?.name).toBe("제목 없음");
});

test("a stopped row says why and who it waits on from what the core serves, and is plain when the core does not say", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = endedModel(scene);
  expect(model.cards.get("k-107")?.stop).toEqual({ words: `${SYNTHETIC_OWNER.name} 확인 필요`, known: true, owner: true });
  expect(model.cards.get("k-103")?.stop).toEqual({ words: "응답 없음", known: false, owner: false });
  expect(model.cards.get("r14")?.stop).toEqual({ words: "응답 없음", known: false, owner: false });
  expect(model.cards.get("k-101")?.stop).toBeNull();
  const agent = scene.items.agents[0];
  const edited = endedModel({
    ...scene,
    board: {
      ...scene.board,
      cards: scene.board.cards.map((run) =>
        run.id === "r14" ? { ...run, reason: "failed" } : run.id === "r12" ? { ...run, todo: null, reason: "result_missing", waitingOn: `agent:${agent.id}` } : run,
      ),
    },
    cards: { cards: scene.cards.cards.map((card) => (card.id === "k-107" ? { ...card, reason: "review" } : card)) },
  });
  expect(edited.cards.get("r14")?.stop).toEqual({ words: "실패 · 다시 시도 안 함", known: true, owner: false });
  expect(edited.cards.get("r12")?.stop).toEqual({ words: `${agent.name} 검토 대기`, known: true, owner: false });
  expect(edited.cards.get("k-107")?.stop).toEqual({ words: "검토 대기", known: true, owner: false });
  // An agent that is to start another run is not a reviewer: the failure and the retry are what the row says.
  const retried = endedModel({
    ...scene,
    board: { ...scene.board, cards: scene.board.cards.map((run) => (run.id === "r12" ? { ...run, todo: null, reason: "failed", waitingOn: `agent:${agent.id}`, retry: "scheduled" } : run)) },
  });
  expect(retried.cards.get("r12")?.stop).toEqual({ words: "실패 · 다시 시도 예정", known: true, owner: false });
});

// lina-app#119: the live shape, as the home sees it (no card's detail opened).

test("a run with a card is never a row of its own, whether or not the cards list holds its card or its detail was opened", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = homeModel(scene);
  const carded = scene.board.cards.filter((run) => run.card).map((run) => run.id);
  // r18 and r19 point at k-190, which the cards list does not hold; r15-r17 are k-108's, whose detail is not open.
  expect(carded).toEqual(expect.arrayContaining(["r1", "r3", "r15", "r16", "r17", "r18", "r19", "r21"]));
  expect(scene.cards.cards.some((card) => card.id === "k-190")).toBe(false);
  const shown = [
    ...model.running.rows,
    ...model.home.waiting.rows,
    ...model.home.recent.rows,
    ...model.home.older.rows,
    ...model.done,
    ...model.inbox.rows.flatMap((row) => (row.type === "review" ? [row.card] : [])),
    ...model.agents.flatMap((agent) => Object.values(agentView(model, agent.id) ?? {}).flatMap((section) => (section && typeof section === "object" && "rows" in section ? (section.rows as { id: string }[]) : []))),
  ].map((row) => row.id);
  for (const id of carded) expect(shown, id).not.toContain(id);
  // The run still knows its card, for its own page.
  expect(model.runOwner.get("r18")).toBe("k-190");
  expect(model.runOwner.get("r15")).toBe("k-108");
});

test("the stopped group is the stopped cards plus the runs with no card nothing replaced; the header, the sidebar and the agent pages agree", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = homeModel(scene);
  const stoppedCards = scene.cards.cards.filter((card) => card.state === "stopped").map((card) => card.id);
  // r12 was replaced by r13 and r11 sits under the finished goal G4; every other stopped run has a card.
  const lone = scene.board.cards.filter((run) => run.state === "stopped" && !run.card).map((run) => run.id);
  expect(lone.sort()).toEqual(["r11", "r12", "r14", "r20"]);
  // r14 has nothing to name it: counted on the home, not a row (lina-app#124).
  const expected = [...stoppedCards, "r20"];
  expect(new Set(model.running.sections[0].rows.map((row) => row.id))).toEqual(new Set(expected));
  expect(model.counts.stopped).toBe(expected.length);
  expect(model.home.active.stopped).toBe(expected.length);
  expect(model.agents.reduce((sum, agent) => sum + (agentView(model, agent.id)?.running.stopped ?? 0), 0)).toBe(expected.length);
  for (const agent of model.agents) expect(agentView(model, agent.id)?.running.stopped).toBe(model.counts.agents[agent.id].stopped);
  // A stopped card whose goal is done leaves, with the runs found through its id.
  const goalDone = homeModel({ ...scene, goals: { goals: scene.goals.goals.map((goal) => (goal.id === "kg-2" ? { ...goal, state: "done" } : goal)) } });
  expect(goalDone.counts.stopped).toBe(expected.length - 3);
});

test("a row is named by its goal's title first, then its own checked title, its own title, its to-do's title and its card's title", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = homeModel(scene);
  const name = (id: string) => model.cards.get(id)?.name;
  expect(name("k-102")).toBe("결제 화면 개편"); // its goal, before its own title
  expect(name("k-111")).toBe("결제 화면 개편"); // its goal
  // With no goal: its checked title, its own title, the to-do of its runs.
  expect(name("k-110")).toBe("백업: 복구 스크립트 점검"); // its checked title
  expect(name("k-109")).toBe("배포 안내 메일 다듬기"); // its own title
  expect(name("k-108")).toBe("야간 보고서 정리하기"); // the to-do of its runs, found through run.card
  expect(name("r20")).toBe("알림 문구 고르기"); // a run's to-do
  const noGoal = { ...scene, goals: { goals: scene.goals.goals.map((goal) => ({ ...goal, workCards: goal.workCards.filter((card) => card.id !== "k-102") })) } };
  expect(homeModel(noGoal).cards.get("k-102")?.name).toBe("위키: 결제 화면 문서 정리"); // its own title before its run's to-do
  const rawOwn = homeModel({ ...noGoal, cards: { cards: scene.cards.cards.map((card) => (card.id === "k-102" ? { ...card, title: "card-form.tsx polish" } : card)) } });
  expect(rawOwn.cards.get("k-102")?.name).toBe("카드 입력 폼 다듬기"); // then its run's to-do
  expect(name("r14")).toBe("제목 없음");
  expect(model.cards.get("r14")?.title).toBeNull();
  // A run of a card with no to-do is named by its card's title.
  const noTodo = homeModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.map((run) => (run.id === "r3" ? { ...run, todo: null, plain: { ...run.plain, title: null } } : run)) } });
  expect(noTodo.cards.get("r3")?.name).toBe("결제: 오류 문구 바꾸기");
  // A to-do title that would show raw text does not name a row.
  const rawTodo = homeModel({ ...scene, items: { ...scene.items, items: scene.items.items.map((item) => (item.id === "T15" ? { ...item, title: "notification-copy.json picks" } : item)) } });
  expect(rawTodo.cards.get("r20")?.name).toBe("제목 없음");
});

test("a stopped row says who waits from waitingOn and retry, and the rows waiting on the owner come first", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = homeModel(scene);
  const stop = (id: string) => model.cards.get(id)?.stop;
  const agent = scene.items.agents[0];
  expect(stop("k-108")).toEqual({ words: `${SYNTHETIC_OWNER.name} 확인 필요`, known: true, owner: true });
  expect(stop("k-109")).toEqual({ words: `${agent.name} 검토 대기`, known: true, owner: false });
  expect(stop("k-110")).toEqual({ words: "응답 없음 · 다시 시도 안 함", known: true, owner: false });
  expect(stop("k-111")).toEqual({ words: "다시 시도 예정", known: true, owner: false });
  expect(stop("r20")).toEqual({ words: "실패 · 다시 시도 안 함", known: true, owner: false });
  expect(stop("k-112")).toEqual({ words: `${SYNTHETIC_OWNER.name} 확인 필요`, known: true, owner: true });
  // Neither waitingOn nor retry: the core does not say, one grey line.
  expect(stop("k-103")).toEqual({ words: "응답 없음", known: false, owner: false });
  const rows = model.running.sections[0].rows;
  expect(rows.slice(0, 3).map((row) => row.id)).toEqual(["k-108", "k-107", "k-112"]);
  expect(rows.slice(3).every((row) => !row.stop?.owner)).toBe(true);
  for (const each of model.agents) {
    const own = agentView(model, each.id)?.running.rows.filter((row) => row.state === "stopped") ?? [];
    const first = own.findIndex((row) => !row.stop?.owner);
    expect(own.slice(first < 0 ? own.length : first).some((row) => row.stop?.owner), each.id).toBe(false);
  }
});

// lina-app#124: the work tab's first screen reads at a glance.

test("no row is untitled: work nothing names is counted on the home, not drawn, and stays in the lookup", () => {
  const model = homeModel();
  const rows = [...model.running.rows, ...model.home.waiting.rows, ...model.home.recent.rows, ...model.home.older.rows, ...model.done, ...model.home.review.rows.flatMap((row) => (row.type === "review" ? [row.card] : []))];
  expect(rows.filter((row) => row.title === null).map((row) => row.id)).toEqual([]);
  // r14 has no goal, to-do, card or checked title, and its own title is a file name.
  expect(model.home.untitled).toBe(1);
  expect(model.cards.get("r14")?.name).toBe("제목 없음");
  expect(model.unlisted.has("r14")).toBe(true);
  expect(model.counts.stopped).toBe(model.running.sections[0].rows.length);
  expect(homeModel(generateScene(SYNTHETIC_SEED, { now: NOW })).home.untitled).toBe(0);
});

// A stopped card waits on someone: an own title whose only raw text is a Latin word (a product's name) is drawn, so
// the owner sees it. Any other raw text, and every card that is not stopped, stay folded into the grey line.
test("a stopped card whose own title fails only the Latin-word rule is drawn by it; nothing else changes", () => {
  const stopped = { ...summary("k-push", "푸시 키 배포와 HTTPS 주소 열기", null, "stopped"), reason: "decision", waitingOn: "owner" };
  const stoppedPath = summary("k-path", "AAS 회차 점검 notes/aas.md", null, "stopped");
  const done = summary("k-done", "AAS 회차 점검 마무리", null, "done");
  const running = summary("k-running", "qveris 일시 오류 정리", null, "in_progress");
  const all = [stopped, stoppedPath, done, running];
  const model = buildModel({ cards: { cards: all }, cardDetails: Object.fromEntries(all.map((card) => [card.id, detail(card)])), failed: [] }, NOW);

  expect(model.cards.get("k-push")).toMatchObject({ title: "푸시 키 배포와 HTTPS 주소 열기", name: "푸시 키 배포와 HTTPS 주소 열기" });
  expect(model.running.sections[0].rows.map((row) => row.id)).toEqual(["k-push"]);
  expect(model.counts.stopped).toBe(1);
  // A path is still raw text on a stopped card; a done or running card keeps the Latin-word rule.
  for (const id of ["k-path", "k-done", "k-running"]) expect(model.cards.get(id)?.title, id).toBeNull();
  expect(model.done).toEqual([]);
  expect(model.home.untitled).toBe(3);
});

test("a stopped run with no card or goal is drawn by its own or its to-do's title with a Latin word; a running one is not", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const withR20 = (patch: Partial<RunCard>) => homeModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.map((run) => (run.id === "r20" ? { ...run, ...patch } : run)) } });
  expect(withR20({ title: "AAS 회차 점검" }).cards.get("r20")?.name).toBe("AAS 회차 점검");
  const latinTodo = homeModel({ ...scene, items: { ...scene.items, items: scene.items.items.map((item) => (item.id === "T15" ? { ...item, title: "qveris 알림 문구 고르기" } : item)) } });
  expect(latinTodo.cards.get("r20")?.name).toBe("qveris 알림 문구 고르기");
  expect(latinTodo.running.sections[0].rows.map((row) => row.id)).toContain("r20");
  const running = withR20({ state: "in_progress", title: "AAS 회차 점검", todo: null });
  expect(running.cards.get("r20")?.title).toBeNull();
  expect(running.home.untitled).toBe(homeModel(scene).home.untitled + 1);
});

test("a finished task that ran twice is one row in the finished groups, the newest run; the other stays in the lookup", () => {
  const model = homeModel(generateScene(SYNTHETIC_SEED, { now: NOW }));
  const names = model.done.map((row) => row.name);
  expect(new Set(names).size).toBe(names.length);
  expect(model.done.filter((row) => row.name === "가이드 초안 다듬기").map((row) => row.id)).toEqual(["r7"]);
  expect(model.cards.has("r8") && model.unlisted.has("r8")).toBe(true);
  expect(model.counts.done).toBe(model.home.recent.rows.length + model.home.older.rows.length);
  expect(model.home.older.rows.map((row) => row.id)).not.toContain("r8");
});

test("a row is titled by its goal first; with no goal by its card's title (lina-app#122)", () => {
  const model = homeModel(generateScene(SYNTHETIC_SEED, { now: NOW }));
  // k-101's checked title (릴리스 변경 목록 정리) differs from its goal's: the goal names the row.
  expect(model.cards.get("k-101")?.name).toBe("릴리스 노트 정리");
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW });
  const noGoal = homeModel({ ...scene, goals: { goals: scene.goals.goals.map((goal) => ({ ...goal, workCards: goal.workCards.filter((card) => card.id !== "k-101") })) } });
  expect(noGoal.cards.get("k-101")?.name).toBe("릴리스 변경 목록 정리");
});

test("the home holds the owner's to-dos and the review items as their own groups, and the waiting group does not repeat them", () => {
  const model = homeModel(generateScene(SYNTHETIC_SEED, { now: NOW }));
  expect(model.home.review.rows.map((row) => row.key)).toEqual(model.inbox.sections[1].rows.map((row) => row.key));
  expect(model.home.review.rows).toHaveLength(2);
  expect(model.home.mine.rows).toHaveLength(2);
  const reviewed = new Set(model.home.review.rows.flatMap((row) => (row.type === "review" ? [row.card.id] : [])));
  expect(model.home.waiting.rows.filter((row) => reviewed.has(row.id))).toEqual([]);
});
