import { expect, test } from "vitest";
import type { WorkCardDetail, WorkCardList, WorkCardSummary } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type Scene } from "../fixtures/synthetic";
import { KIND_TITLE } from "../words";
import { buildModel } from "./index";

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

test("a row is named by what the work is for, never by its kind: a run with nothing to name it says 제목 없음", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const raw = scene.cards.cards.find((card) => card.id === "k-102");
  const model = endedModel({ ...scene, cards: { cards: scene.cards.cards.map((card) => (card.id === "k-102" ? { ...card, title: "LINA-41 release notes / CHANGES.md" } : card)) } });
  const kindWords: string[] = Object.values(KIND_TITLE);
  for (const row of model.cards.values()) expect(kindWords).not.toContain(row.name);
  // k-102 has no checked title and its own would show raw text: the goal it sits in names it.
  expect(raw?.plain.title).toBeNull();
  expect(model.cards.get("k-102")).toMatchObject({ title: "결제 화면 개편", name: "결제 화면 개편" });
  // r14 has no checked title, no goal or card, and its own title is a file name: one grey 제목 없음.
  expect(model.cards.get("r14")).toMatchObject({ title: null, name: "제목 없음" });
  // A run with no checked title but a plain own name is named by it.
  const named = endedModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.map((run) => (run.id === "r14" ? { ...run, title: "밤마다 미러 맞추기" } : run)) } });
  expect(named.cards.get("r14")).toMatchObject({ title: "밤마다 미러 맞추기", name: "밤마다 미러 맞추기" });
});

test("a worker run of a card or of a goal's to-do is not a row of its own; a run with no parent is", () => {
  const model = endedModel();
  const listed = new Set(model.cards.keys());
  // r1-r5, r9, r10 belong to cards; r11 to G4's to-do T10.
  for (const id of ["r1", "r2", "r3", "r4", "r5", "r9", "r10", "r11"]) expect(listed.has(id), id).toBe(false);
  // r13 is on T13, a to-do with no goal; r14 has no to-do at all.
  for (const id of ["r6", "r7", "r8", "r13", "r14"]) expect(listed.has(id), id).toBe(true);
  // The board does list r11 (it is outside any card): only its goal keeps it out.
  expect(generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true }).board.cards.some((run) => run.id === "r11")).toBe(true);
});

test("the stopped group holds only work that still needs someone: replaced runs and stopped work under a done goal leave it", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = endedModel(scene);
  const stopped = () => model.running.sections[0].rows.map((row) => row.id);
  // r12 was cancelled and r13, a later run of the same to-do, replaced it; r11 sits under the finished goal G4.
  expect(stopped()).toEqual(expect.arrayContaining(["k-103", "k-107", "r14"]));
  expect(stopped()).toHaveLength(3);
  expect(model.counts.stopped).toBe(3);
  // Without the later run, r12 still needs someone.
  const alone = endedModel({ ...scene, board: { ...scene.board, cards: scene.board.cards.filter((run) => run.id !== "r13") } });
  expect(alone.running.sections[0].rows.map((row) => row.id)).toContain("r12");
  // A stopped card whose goal is done leaves too.
  const goalDone = endedModel({ ...scene, goals: { goals: scene.goals.goals.map((goal) => (goal.id === "kg-2" ? { ...goal, state: "done" } : goal)) } });
  expect(goalDone.running.sections[0].rows.map((row) => row.id)).toEqual(["r14"]);
});

test("a stopped row says why and who it waits on from what the core serves, and is plain when the core does not say", () => {
  const scene = generateScene(SYNTHETIC_SEED, { now: NOW, endedRuns: true });
  const model = endedModel(scene);
  expect(model.cards.get("k-107")?.stop).toEqual({ words: `${SYNTHETIC_OWNER.name} 확인 필요`, known: true });
  expect(model.cards.get("k-103")?.stop).toEqual({ words: "응답 없음", known: false });
  expect(model.cards.get("r14")?.stop).toEqual({ words: "응답 없음", known: false });
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
  expect(edited.cards.get("r14")?.stop).toEqual({ words: "실패 · 다시 시도 안 함", known: true });
  expect(edited.cards.get("r12")?.stop).toEqual({ words: `${agent.name} 검토 대기`, known: true });
  expect(edited.cards.get("k-107")?.stop).toEqual({ words: "검토 대기", known: true });
});
