import { SETTINGS_HISTORY, type ActionResult, type AddItemRequest, type AgentTalkEvent, type AgentTalkHistory, type AnswerRequest, type AnswerResult, type BoardSnapshot, type ChangeEvent, type ChangeMessage, type CommentRequest, type DeviceAction, type DoneRequest, type ItemDetail, type ItemSummary, type NoticesReadRequest, type NoticesReadResult, type PushKey, type PushRemoveRequest, type PushRemoveResult, type PushSubscriptionRequest, type PushSubscriptionResult, type RouteName, type Routes, type RunRecord, type Settings, type SettingsAuditLine, type SettingsModel, type SettingsPatch, type SettingsWritten, type TalkEvent, type TalkRequest, type WorkState } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type PowerVariant, type Scene, type SettingsVariant } from "../fixtures/synthetic";
import { localDay, type CardSummary } from "../model";
import { mergePatch } from "../model/settings";
import { currentSettings, historyView, invalidDetail, modelsView, revisionOf, settingsView, validate, writeRevision } from "./synthetic-settings";
import { base64UrlBytes, type PushManagerLike, type PushSubscriptionLike } from "../push";
import { nowSeconds, type AgentTalkResult, type ChangeHandlers, type ChangeSocket, type ReadResult, type Renewal, type Source, type TalkResult, type WriteResult } from "./source";

/** The cards as the core pages them (lina#729): every unfinished card, the newest `limit` finished ones, and their total. */
function finishedPage(list: Scene["cards"], limit: number): Routes["cards"] {
  const finished = list.cards.filter((card) => card.state === "done").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { ...list, cards: [...list.cards.filter((card) => card.state !== "done"), ...finished.slice(0, limit)], finishedTotal: finished.length };
}

const ROUND18_FIRST = ["가상", "임시", "연습", "예시", "모의", "시험", "가짜", "보기", "샘플"];
const ROUND18_SECOND = ["화면", "문서", "목록", "설정", "기록", "알림", "검색", "계정"];
const ROUND18_THIRD = ["정리하기", "고치기", "살피기", "옮기기", "맞추기", "줄이기", "늘리기", "묶기"];
/** A made-up title of three Hangul words, a different one for every index under 576. */
const round18Title = (index: number) => `${ROUND18_FIRST[index % 9]} ${ROUND18_SECOND[Math.floor(index / 9) % 8]} ${ROUND18_THIRD[Math.floor(index / 72) % 8]}`;

/**
 * The hub's shapes UI QA round 18 met (`&hub=round18`, lina-app#221), in made-up words: 524 finished cards in its finished
 * row shape (no checked title, result or now line, no goal title, read-only), 509 titled apart, then 4, 5, 2 and 2 titled
 * alike (one `×n` line each) and 2 whose titles keep no Hangul, in no goal and with no history kept (`detail: false`):
 * 514 lines as the hub folds them, 513 with the line nothing names gone. And the owner's planned to-do T3 due three days
 * before the clock.
 */
export function round18Scene(scene: Scene): Scene {
  const template = scene.cards.cards.find((card) => card.state === "done");
  if (!template) return scene;
  const shape = (index: number, title: string, extra: { detail?: boolean } = {}): Scene["cards"]["cards"][number] => {
    const ended = scene.now - (2 + index) * 3600;
    return { ...template, id: `k-${1000 + index}`, title, goalTitle: null, ask: null, now: null, reason: null, plain: { title: null, now: null, result: null }, todoProgress: { done: 0, total: 0 }, readOnly: true, endedAt: ended, lastHeartbeatAt: ended, ...extra } as Scene["cards"]["cards"][number];
  };
  const titles = [...Array.from({ length: 509 }, (_, index) => round18Title(index)), ...[4, 5, 2, 2].flatMap((count, group) => Array.from({ length: count }, () => round18Title(509 + group)))];
  const finished = [...titles.map((title, index) => shape(index, title)), shape(titles.length, "fix a9c2 (#12)", { detail: false }), shape(titles.length + 1, "fix b7e1 (#12)", { detail: false })];
  const due = localDay(scene.now - 3 * 86_400);
  const dated = <T extends { id: string; due: string | null }>(row: T): T => (row.id === "T3" ? { ...row, due } : row);
  const goal = scene.itemDetails.G1;
  return {
    ...scene,
    cards: { ...scene.cards, cards: [...scene.cards.cards.filter((card) => card.state !== "done"), ...finished] },
    items: { ...scene.items, items: scene.items.items.map(dated) },
    itemDetails: { ...scene.itemDetails, T3: dated(scene.itemDetails.T3), G1: { ...goal, children: goal.children.map(dated) } },
    board: { ...scene.board, inbox: { ...scene.board.inbox, mine: scene.board.inbox.mine.map(dated) } },
  };
}

/** A cards-list row as the hub serves it, with its goal's title and its ask (CardSummary). */
type SceneCard = CardSummary;

/** Made-up titles of three Hangul words for round 20's finished cards, apart for every index under 40. */
const round20Title = (index: number) => `${ROUND18_FIRST[index % 9]} ${ROUND18_SECOND[(index + Math.floor(index / 9)) % 8]} ${ROUND18_THIRD[Math.floor(index / 9) % 8]}`;

/**
 * The hub's shapes UI QA round 20 met (`&hub=round20`, lina-app#225), field by field as its cards list serves them, in
 * made-up words. 13 stopped cards (the scene's one and 12 of the hub's: read-only, no checked lines, waiting on the
 * owner's decision or feedback, never retried), two of which have no goal and only an own title with Latin words in it:
 * one with a product name, a hash and issue references and no ask, one with two tool names and an ask holding a Latin
 * word. Two planned cards of the hub's, one whose goal title and own title both hold a Latin word. 45 finished cards of
 * the hub's (no checked lines, no goal, read-only): 32 titled apart, 4, 3 and 2 titled alike but for a hash or an issue
 * reference, and 4 whose titles nothing names (Latin only, or too few Hangul letters), old ones with no history kept.
 * And the owner's to-do T9, waiting on the owner's feedback since its due date, the day before the clock.
 */
export function round20Scene(scene: Scene): Scene {
  const template = scene.cards.cards.find((card) => card.state === "stopped");
  const agents = scene.items.agents.map((agent) => agent.id);
  if (!template || agents.length < 3) return scene;
  const now = scene.now;
  const hub = (id: string, fields: Partial<SceneCard>): SceneCard =>
    ({ ...template, id, goalTitle: null, reason: null, waitingOn: null, retry: null, ask: null, now: null, endedAt: null, lastHeartbeatAt: null, plain: { title: null, now: null, result: null }, todoProgress: { done: 0, total: 0 }, readOnly: true, ...fields }) as SceneCard;
  const stop = (index: number, title: string, goalTitle: string | null, ask: string | null, extra: Partial<SceneCard> = {}) =>
    hub(`k-${400 + index}`, { title, goalTitle, agent: agents[index % 3], state: "stopped", reason: index % 4 === 1 ? "feedback" : "decision", waitingOn: "owner", retry: "none", ask, elapsedSeconds: (index + 2) * 3600, now: "정리 중", lastHeartbeatAt: now - (index + 2) * 3600, ...extra });
  const stopped = [
    ...["주간 회의록 묶기", "사진 폴더 나누기", "가계부 항목 고르기", "이사 체크리스트 만들기", "여행 숙소 비교하기", "독서 목록 다듬기", "정원 물주기 일정 잡기", "보험 서류 모으기", "요리 순서 적기", "운동 기록 옮기기"].map((title, index) =>
      stop(index, title, index % 2 ? null : "생활 정리", `${title.split(" ")[0]} 기준을 정해 주세요.`),
    ),
    // No goal, no ask; its own title holds a product name, a hash and issue references, cut to what a person reads.
    stop(10, "Grafana 대시보드 패널 순서 맞추기 a1b2c3d (#41, lina#12)", null, null, { reason: "feedback", lastHeartbeatAt: null }),
    // No goal; its own title holds two tool names, its ask a Latin word the row never draws.
    stop(11, "Figma 시안의 버튼 간격을 Tailwind 기준으로 다시 맞추기", null, "버튼 간격을 preview 화면 기준으로 맞출지 정해 주세요"),
  ];
  const planned = [
    hub("k-420", { title: "알림 문구 모으기", agent: agents[0], state: "planned", reason: "triage", elapsedSeconds: 600, now: "대기 중", lastHeartbeatAt: now - 600 }),
    // Its goal's title and its own both hold a Latin word.
    hub("k-421", { title: "Notion 페이지 목록을 새 폴더로 정리", goalTitle: "Notion 문서 옮기기", agent: agents[1], state: "planned", reason: "scheduled", retry: "scheduled", elapsedSeconds: 1200, now: "대기 중", lastHeartbeatAt: now - 1200 }),
  ];
  const done = (index: number, title: string, extra: Partial<SceneCard> = {}) =>
    hub(`k-${500 + index}`, { title, agent: agents[index % 3], state: "done", elapsedSeconds: 900, endedAt: now - (2 + index) * 3600, detail: true, ...extra } as Partial<SceneCard>);
  const alike = [
    ...["a1b2c3d", "b2c3d4e", "c3d4e5f", "d4e5f6a"].map((hash) => `허브 화면 빌드 올리기 ${hash}`),
    ...["#21", "#22", "#23"].map((ref) => `설정 화면 문구 다듬기 (${ref})`),
    ...["e5f6a7b", "f6a7b8c"].map((hash) => `백업 기록 확인하기 ${hash}`),
  ];
  const unnamed = ["fix a9c2 (#12)", "chore bump deps (#31)", "deploy 핫픽스 b7e1f2a", "release v2 메모"];
  const finished = [
    ...Array.from({ length: 32 }, (_, index) => round20Title(index)),
    ...alike,
  ].map((title, index) => done(index, title));
  finished.push(...unnamed.map((title, index) => done(41 + index, title, { detail: false } as Partial<SceneCard>)));
  const due = localDay(now - 86_400);
  const waiting = <T extends { id: string; due: string | null }>(row: T, fields: object): T => (row.id === "T9" ? { ...row, due, ...fields } : row);
  const item = { state: "waiting" as const, reason: "feedback" };
  const goal = scene.itemDetails.G3;
  const t9 = scene.board.due.later.find((row) => row.id === "T9");
  return {
    ...scene,
    cards: { ...scene.cards, cards: [...scene.cards.cards, ...stopped, ...planned, ...finished] },
    inbox: { ...scene.inbox, blocked: [...scene.inbox.blocked, ...stopped.map((card) => ({ cardId: card.id, title: card.title, agent: card.agent, state: "stopped" as const, reason: card.reason, blockKind: null, blockReason: card.ask ?? "initial_status" }))] },
    items: { ...scene.items, items: scene.items.items.map((row) => waiting(row, item)) },
    itemDetails: { ...scene.itemDetails, T9: waiting(scene.itemDetails.T9, item), G3: { ...goal, children: goal.children.map((row) => waiting(row, item)) } },
    board: {
      ...scene.board,
      inbox: { ...scene.board.inbox, mine: scene.board.inbox.mine.map((row) => waiting(row, { waiting: true })) },
      due: { ...scene.board.due, later: scene.board.due.later.filter((row) => row.id !== "T9"), overdue: t9 ? [...scene.board.due.overdue, { ...t9, due }] : scene.board.due.overdue },
    },
  };
}

/** Made-up finished titles drawn as written, or less a bracket of refs only, for round 22 (lina-app#231). */
export const ROUND22_WHOLE: readonly (readonly [string, string])[] = [
  ["가상 목록 다듬기", "가상 목록 다듬기"],
  ["가상 회차 정리 (lina#12·#13)", "가상 회차 정리"],
  ["가상 앱 반영 (가상 22회차 앞)", "가상 앱 반영 (가상 22회차 앞)"],
  ["가상 보관함 정리 (a1b2c3d)", "가상 보관함 정리"],
];

/** Made-up finished titles whose only drawable form is a cut, each leaving a hole shape the hub showed (lina-app#231). */
export const ROUND22_HOLES: readonly string[] = [
  "가상 허브를 FakeBoard (추가)",
  "가상 허브 앱을 v2.4 (포함)로 올리기",
  "fakeproxy 용 호출자 키 발급·배포",
  "가상 서버 끊김에도 fakegate·보조 살아 있게",
  "가상 서버 fakeuser@1000 재시작 정리",
  "가상 검사 대기 결함 고치기 (PR 667)",
  "가상 앱 반영: 묶음을 a1b2c3d4e5로 (가상 22회차 앞)",
];

/**
 * The hub's shapes UI QA round 22 met (`&hub=round22`, lina-app#231), field by field as its cards list serves them, in
 * made-up words: finished cards with no checked lines, read-only, the old ones with no history kept (`detail: false`,
 * no beat) and the newest with no `detail` field and a last beat, some under a goal title. Listed in the hub's order: a
 * few old ones first, then oldest to newest, then one old one last, so the list's first finished cards are not its
 * newest. Their titles: some drawn as written or less a bracket of refs (ROUND22_WHOLE, each under round 20's made-up
 * names too), one whose goal title holds a Latin word over a whole own title, and the hole shapes (ROUND22_HOLES).
 * And the first agent's goal G6 in the record's shape: waiting for 16 days with 14 of 16 to-dos closed, its two open
 * to-dos waiting (its agent's own on a hold, another agent's on feedback), two finished cards under its title, and a
 * done condition that opens on an issue reference and holds a Latin word and a `#3` (ROUND22_CONDITION).
 */
export function round22Scene(scene: Scene): Scene {
  const template = scene.cards.cards.find((card) => card.state === "done");
  const agents = scene.items.agents.map((agent) => agent.id);
  if (!template || agents.length < 3) return scene;
  const now = scene.now;
  const finished = (index: number, title: string, hoursAgo: number, fields: Partial<SceneCard> = {}): SceneCard => {
    const recent = hoursAgo < 24;
    const card = { ...template, id: `k-${600 + index}`, title, goalTitle: null, agent: agents[index % 3], state: "done", reason: null, waitingOn: null, retry: null, ask: null, elapsedSeconds: 600 + index * 60, todoProgress: { done: 0, total: 0 }, now: null, endedAt: now - Math.round(hoursAgo * 3600), lastHeartbeatAt: recent ? now - Math.round(hoursAgo * 3600) : null, plain: { title: null, now: null, result: null }, readOnly: true, detail: false, ...fields } as SceneCard & { detail?: boolean };
    if (recent) delete card.detail;
    return card;
  };
  const titles = [...ROUND22_WHOLE.map(([title]) => title), ...Array.from({ length: 12 }, (_, index) => round20Title(index)), ...ROUND22_HOLES];
  // Oldest to newest: 9 days ago to 8 minutes ago.
  const ages = titles.map((_, index) => 9 * 24 - (index * (9 * 24 - 0.14)) / (titles.length - 1));
  const listed = titles.map((title, index) => finished(index, title, ages[index]));
  const goalLatin = finished(titles.length, "가상 묶음 정리 마치기", 5 * 24, { goalTitle: "가상 FakeHub 옮기기" });
  // The hub lists a few old cards first and one last.
  const old = [6 * 24, 4 * 24 + 5, 7 * 24].map((hours, index) => finished(titles.length + 1 + index, round20Title(12 + index), hours));
  const goalCards = [finished(titles.length + 4, "가상 말투 예시 모으기", 3 * 24, { goalTitle: ROUND22_GOAL }), finished(titles.length + 5, "가상 말투 예시 고르기", 2 * 24, { goalTitle: ROUND22_GOAL })];
  const cards = [...old.slice(0, 2), goalLatin, ...goalCards, ...listed, old[2]];
  const base = scene.itemDetails.G1;
  const since = now - 16 * 86_400;
  const goal = { ...scene.items.items.find((item) => item.id === "G1"), id: "G6", parent: "A1", title: ROUND22_GOAL, agent: agents[0], addedBy: agents[0], mine: false, state: "waiting" as const, reason: null, stateSince: since, lastActivityAt: now - 7 * 86_400, createdAt: now - 20 * 86_400, closedAt: null, due: null, doneCondition: ROUND22_CONDITION, area: "가상 영역", projects: [], todos: { done: 14, total: 16 }, runCount: 6, commentCount: 0 } as Scene["items"]["items"][number];
  const todo = (id: string, agent: string, title: string, reason: string) => ({ ...goal, id, kind: "todo" as const, parent: "G6", title, agent, addedBy: agent, reason, doneCondition: null, area: null, todos: null, runCount: 1 });
  const todos = [todo("T13", agents[0], "가상 말투 기준 정하기", "hold"), todo("T14", agents[1], "가상 말투 예시 검토", "feedback")];
  return {
    ...scene,
    cards: { ...scene.cards, cards: [...scene.cards.cards.filter((card) => card.state !== "done"), ...cards] },
    items: { ...scene.items, items: [...scene.items.items, goal, ...todos] },
    itemDetails: { ...scene.itemDetails, G6: { ...base, ...goal, why: null, basis: [], children: todos, comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null } },
  };
}

/**
 * The hub's long card's record shape UI QA round 23 met (`&hub=round23`, lina-app#236), field by field as a worker run's
 * record serves it, in made-up words: k-105's worker run r5 holds ten rounds, newest first, most accepted with an English
 * report line (so their heads hold the outcome alone), a stopped one between them, and one whose report line is a whole
 * Korean sentence. The rounds of one outcome with nothing else, one after another, are one head with `×n`.
 */
export function round23RecordScene(scene: Scene): Scene {
  const done = scene.cardDetails["k-105"];
  const end = scene.now - 2 * 3600;
  const round = (run: number, fields: Partial<RunRecord["rounds"][number]>): RunRecord["rounds"][number] => {
    const endedAt = end - (10 - run) * 40 * 60;
    return { run, startedAt: endedAt - 9 * 60, endedAt, endKnown: true, startUnknown: false, result: "Merged the fake PR after both widths passed.", verdict: "accepted", stopped: false, rows: [], ...fields };
  };
  const rounds = [
    round(10, {}),
    round(9, { result: "Fake review read, no change asked." }),
    round(8, {}),
    round(7, { result: null, verdict: null, stopped: true }),
    round(6, { result: "백업 기록 마지막 달을 다시 살폈다." }),
    round(5, { result: null, verdict: null, stopped: true }),
    round(4, {}),
    round(3, { result: "Fake audit merged via fake#12." }),
    round(2, {}),
    round(1, {}),
  ];
  const record: RunRecord = { ...scene.records.r1, id: "r5", at: scene.now, cardId: "k-105", rounds, comments: [], errors: [] };
  return { ...scene, cardDetails: { ...scene.cardDetails, "k-105": { ...done, workerRuns: done.workerRuns.map((worker) => ({ ...worker, firstSeenAt: end - 9 * 40 * 60 - 9 * 60 })) } }, records: { ...scene.records, r5: record } };
}

/** k-101's worker runs under ids of the hub's shape for round 23 (lina-app#238): a task id a person never reads. */
export const ROUND23_RUNS: Readonly<Record<string, string>> = { r9: "OT-GAJ1101090105", r10: "OT-GAJ1101093210", r1: "OT-GAJ1101101500" };

/** Every string and key of a plain object or array, with `names` renamed; anything else is kept as it is. */
function renamed<T>(value: T, names: Readonly<Record<string, string>>): T {
  if (typeof value === "string") return (names[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((each) => renamed(each, names)) as T;
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [names[key] ?? key, renamed(each, names)])) as T;
}

/**
 * The hub's shapes UI QA round 23 met (`&hub=round23`, lina-app#238), field by field as the hub serves them, in made-up
 * words: k-101's worker runs carry task ids (ROUND23_RUNS) and, as the hub's long card does, a `lina-worker` entry named
 * by a command word (`wait`) with no record; and the bell holds the hub's 61 unread notices, a two-digit badge.
 */
export function round23FrameScene(scene: Scene): Scene {
  const next = renamed(scene, ROUND23_RUNS);
  const card = next.cardDetails["k-101"];
  const last = card.workerRuns.at(-1);
  const workerRuns = last ? [...card.workerRuns, { id: "wait", kind: "lina-worker" as const, firstSeenAt: last.firstSeenAt, lastSeenAt: last.lastSeenAt }] : card.workerRuns;
  const target = next.items.items.find((item) => item.kind === "todo" && item.mine);
  const unread = next.board.notices.filter((notice) => !notice.read).length;
  const more = target
    ? Array.from({ length: Math.max(0, 61 - unread) }, (_, index) => ({ key: `todo:${target.id}:${next.now - 600 - index * 60}`, target: target.id, at: next.now - 600 - index * 60, kind: "todo" as const, line: `가상 알림 ${index + 1} · 내 할 일`, read: false }))
    : [];
  const notices = [...next.board.notices, ...more];
  return {
    ...next,
    cardDetails: { ...next.cardDetails, "k-101": { ...card, workerRuns } },
    board: { ...next.board, notices, counts: { ...next.board.counts, unread: notices.filter((notice) => !notice.read).length } },
  };
}

/** Round 22's goal (lina-app#231): its title, and its done condition with an issue reference, a Latin word and a `#3`. */
export const ROUND22_GOAL = "가상 말투 키우기";
export const ROUND22_CONDITION = "lina#77 가상 말투 기준이 맞고 남은 메모가 memory 칸 #3에 들어감";

/** Round 23's made-up titles (lina-app#237): goal titles over finished cards, and the finished cards nothing names. */
export const ROUND23 = {
  /** Over five cards titled as the goal and three with titles of their own: the hub drew one `×5` line and three more. */
  weekly: "가상 주간 보고 다듬기",
  weeklyOwn: ["가상 표 칸 맞추기", "가상 요약 줄 줄이기", "가상 그림 번호 고치기"],
  /** Over two cards, each with a title of its own. */
  order: "가상 알림 순서 바꾸기",
  orderOwn: ["가상 알림 순서 1차 시험", "가상 알림 순서 2차 시험"],
  /** Over one card titled as the goal and one with a title of its own. */
  move: "가상 설정 화면 옮기기",
  moveOwn: "가상 설정 화면 글자 맞추기",
  /** Titles no rule draws (Latin only), no goal: the cards of the grey line. */
  unnamed: ["fix a9c2 (#12)", "chore bump deps (#31)", "deploy sync 3f2a1b9", "release notes v2", "wip", "retry 2", "fix typo", "merge main", "bump 1.4.2"],
  /** A goal closed with its one to-do still planned (0/1), and one finished card under its title. */
  closedEarly: "가상 시험 앱 따로 띄우기",
  /** A goal closed at 4 of 16 to-dos. */
  closedAtFour: "가상 프록시 교체 시험",
  /** A goal still planned, its one to-do planned, while both cards under its title are finished. */
  plannedDone: "가상 결함 여덟 가지 고치기",
  plannedDoneOwn: ["가상 결함 앞 넷 고치기", "가상 결함 뒤 넷 고치기"],
} as const;

/**
 * The hub's shapes UI QA round 23 met (`&hub=round23`, lina-app#237), field by field as its lists serve them, in made-up
 * words. Finished cards in the hub's finished row shape (no checked lines, no ask, read-only; the old ones keep no
 * history and no beat, the newest a beat and no `detail` field), more than the work tab reads first: a goal title over
 * cards titled as the goal and cards with titles of their own (ROUND23), titles apart, and cards nothing names from every
 * agent, the newest of them the newest finished card, so the grey line is the group's first. And the first agent's goal
 * records whose own state and to-do count disagree, as the item list serves them: two `done` with to-dos open (0/1 with
 * its to-do planned and a finished card under its title, 4/16), one `planned` (0/1) whose cards are all finished.
 */
export function round23ListScene(scene: Scene): Scene {
  const template = scene.cards.cards.find((card) => card.state === "done");
  const agents = scene.items.agents.map((agent) => agent.id);
  if (!template || agents.length < 3) return scene;
  const now = scene.now;
  let next = 0;
  const finished = (title: string, goalTitle: string | null, hoursAgo: number, agent = agents[next % 3]): SceneCard => {
    const recent = hoursAgo < 24;
    const ended = now - Math.round(hoursAgo * 3600);
    const card = { ...template, id: `k-${700 + next++}`, title, goalTitle, agent, state: "done", reason: null, waitingOn: null, retry: null, ask: null, elapsedSeconds: 900 + next * 60, todoProgress: { done: 0, total: 0 }, now: null, endedAt: ended, lastHeartbeatAt: recent ? ended : null, plain: { title: null, now: null, result: null }, readOnly: true, detail: false } as SceneCard & { detail?: boolean };
    if (recent) delete card.detail;
    return card;
  };
  const R = ROUND23;
  const cards = [
    // The newest finished card is one nothing names; the others of the grey line are spread over the days, every agent's.
    ...R.unnamed.map((title, index) => finished(title, null, index === 0 ? 0.1 : 6 + index * 20, agents[index % 3])),
    ...Array.from({ length: 5 }, (_, index) => finished(R.weekly, R.weekly, 1 + index * 30)),
    ...R.weeklyOwn.map((title, index) => finished(title, R.weekly, 2 + index * 25)),
    ...R.orderOwn.map((title, index) => finished(title, R.order, 3 + index * 40)),
    finished(R.move, R.move, 4),
    finished(R.moveOwn, R.move, 50),
    finished(R.closedEarly, R.closedEarly, 0.6),
    ...R.plannedDoneOwn.map((title, index) => finished(title, R.plannedDone, 5 + index * 10)),
    ...Array.from({ length: 12 }, (_, index) => finished(round20Title(20 + index), null, 8 + index * 9)),
  ];
  const since = now - 2 * 86_400;
  const base = scene.items.items.find((item) => item.id === "G1");
  const goal = (id: string, title: string, state: "done" | "planned", todos: { done: number; total: number }, closedAgo: number | null) =>
    ({ ...base, id, parent: "A1", title, agent: agents[0], addedBy: agents[0], mine: false, state, reason: null, stateSince: closedAgo === null ? since : now - closedAgo, lastActivityAt: now - 3600, createdAt: now - 9 * 86_400, closedAt: closedAgo === null ? null : now - closedAgo, due: null, doneCondition: null, area: "가상 영역", projects: [], todos, runCount: 2, commentCount: 0 }) as Scene["items"]["items"][number];
  const goals = [goal("G7", R.closedEarly, "done", { done: 0, total: 1 }, 37 * 60), goal("G8", R.closedAtFour, "done", { done: 4, total: 16 }, 3 * 3600), goal("G9", R.plannedDone, "planned", { done: 0, total: 1 }, null)];
  // Each goal's to-dos the item list still serves: open ones, planned.
  const todo = (id: string, parent: string, title: string) => ({ ...goals[0], id, kind: "todo" as const, parent, title, state: "planned" as const, closedAt: null, doneCondition: null, area: null, todos: null, runCount: 0 });
  const todos = [todo("T15", "G7", "가상 시험 앱 주소 정하기"), todo("T16", "G8", "가상 프록시 끊김 재기"), todo("T17", "G9", "가상 결함 목록 맞추기")];
  const detail = scene.itemDetails.G1;
  const details = Object.fromEntries(goals.map((each) => [each.id, { ...detail, ...each, why: null, basis: [], children: todos.filter((row) => row.parent === each.id), comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null }]));
  // The hub serves the detail of a card it keeps history for (no `detail: false`): its row's fields and empty lists.
  const kept = cards.filter((card) => !("detail" in card));
  const cardDetails = Object.fromEntries(kept.map((card) => [card.id, { ...card, todos: [], workerRuns: [], runsAwaitingVerdict: [], gates: [], comments: [], runs: [] }]));
  return {
    ...scene,
    cardDetails: { ...scene.cardDetails, ...cardDetails } as Scene["cardDetails"],
    cards: { ...scene.cards, cards: [...scene.cards.cards.filter((card) => card.state !== "done"), ...cards] },
    items: { ...scene.items, items: [...scene.items.items, ...goals, ...todos] },
    itemDetails: { ...scene.itemDetails, ...details },
  };
}

/** `&hub=round23`: the three shapes UI QA round 23 met, one after the other (lina-app#236, #237, #238). */
export function round23Scene(scene: Scene): Scene {
  return round23ListScene(round23FrameScene(round23RecordScene(scene)));
}

/** Round 24's made-up titles (lina-app#242). */
export const ROUND24 = {
  /** One goal over three stopped cards of one agent, each with a title of its own: the hub's rows read the goal three times. */
  stopGoal: "가상 주문 확인 관문",
  stopOwn: ["가상 관문 장 밖 주문 막기", "가상 관문 여러 주문을 한 장으로 묶기", "가상 관문 주문 유형 채우기와 알림 보내기"],
  /** One goal over two planned cards of two agents: one titled as the goal (no second line), one with a title of its own. */
  planGoal: "가상 원격 작업 환경 시험",
  planOwn: "가상 원격 작업 앱 첫 시제품 (화면·소리 한 앱)",
  /** A record goal whose title holds a Latin word, so no finished card under it is named by it. */
  workGoal: "FAKE M0 가상 기억 하나 저장소 하나",
  /** Its finished cards no rule draws: a Latin word or a reference outside a bracket in each. */
  workUnnamed: ["가상 1단계: Fake 카드에서 worker run 받기 + fake-task 고침 옮기기 (fake#27·#28)", "가상 2단계: 허브를 node로 돌려 fake-task 바꾸기 (fake#35)", "가상 선행: fake gate 열기 fake#31", "가상 3단계 fake-drift 흡수", "가상 4단계: fake 묶음 sync 옮기기 (fake#38)"],
  /** Its finished cards with titles of their own. */
  workNamed: ["가상 기억 칸 나누기", "가상 저장소 하나로 합치기"],
} as const;

/**
 * The hub's shapes UI QA round 24 met (`&hub=round24`, lina-app#242), on top of round 23's, field by field as its lists
 * serve them, in made-up words (ROUND24). Three stopped cards of one agent under one goal title, read-only, waiting on the
 * owner's decision, never retried, each with a short ask, a long Latin `now` and its inbox block reason. Two planned cards
 * of two agents under one goal title, one titled as the goal (scheduled), one with a title of its own (in triage). And the
 * first agent's goal G10 as the item list serves it (waiting, 9 of 10 to-dos closed), whose title holds a Latin word, over
 * finished cards that carry that title as theirs (`goalTitle`): five whose own titles no rule draws, every agent's, and
 * two drawn as written; the hub links them to the goal by that title alone.
 */
export function round24Scene(scene: Scene): Scene {
  const next = round23Scene(scene);
  const template = next.cards.cards.find((card) => card.state === "done");
  const agents = next.items.agents.map((agent) => agent.id);
  if (!template || agents.length < 3) return next;
  const now = next.now;
  const R = ROUND24;
  const row = (id: string, fields: Partial<SceneCard>): SceneCard =>
    ({ ...template, id, goalTitle: null, reason: null, waitingOn: null, retry: null, ask: null, now: null, endedAt: null, lastHeartbeatAt: null, plain: { title: null, now: null, result: null }, todoProgress: { done: 0, total: 0 }, readOnly: true, ...fields }) as SceneCard;
  const longNow = "11-16 20:50 (run 2134) - fake lint had one real error in the test profile merge, fixed and pushed again…";
  const stopped = R.stopOwn.map((title, index) =>
    row(`k-${800 + index}`, { title, goalTitle: R.stopGoal, agent: agents[1], state: "stopped", reason: "decision", waitingOn: "owner", retry: "none", ask: `가상 관문 시험 ${index + 1}차 승인`, elapsedSeconds: (9 - index) * 86_400, now: longNow, lastHeartbeatAt: now - (9 - index) * 86_400 }),
  );
  const planned = [
    row("k-810", { title: R.planGoal, goalTitle: R.planGoal, agent: agents[0], state: "planned", reason: "scheduled", retry: "scheduled", elapsedSeconds: 10 * 86_400, now: longNow, lastHeartbeatAt: now - 10 * 86_400 }),
    row("k-811", { title: R.planOwn, goalTitle: R.planGoal, agent: agents[1], state: "planned", reason: "triage", elapsedSeconds: 9 * 86_400, now: longNow, lastHeartbeatAt: now - 9 * 86_400 }),
  ];
  const finished = [...R.workUnnamed, ...R.workNamed].map((title, index) => {
    const ended = now - (3 + index * 30) * 3600;
    return { ...row(`k-${820 + index}`, { title, goalTitle: R.workGoal, agent: agents[index % 3], state: "done", elapsedSeconds: 30_000 + index * 600, endedAt: ended }), detail: false } as SceneCard;
  });
  const base = next.items.items.find((item) => item.id === "G1");
  const goal = { ...base, id: "G10", parent: "A1", title: R.workGoal, agent: agents[0], addedBy: agents[0], mine: false, state: "waiting" as const, reason: null, stateSince: now - 2 * 86_400, lastActivityAt: now - 2 * 86_400, createdAt: now - 15 * 86_400, closedAt: null, due: null, doneCondition: "가상 기억과 저장소가 한 곳에서 읽힌다", area: "가상 영역", projects: [], todos: { done: 9, total: 10 }, runCount: 40, commentCount: 0 } as Scene["items"]["items"][number];
  const detail = { ...next.itemDetails.G1, ...goal, why: null, basis: [], children: [], comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null };
  // The hub serves the detail of every open card: its row's fields and empty lists.
  const cardDetails = Object.fromEntries([...stopped, ...planned].map((card) => [card.id, { ...card, todos: [], workerRuns: [], runsAwaitingVerdict: [], gates: [], comments: [], runs: [] }]));
  return {
    ...next,
    cardDetails: { ...next.cardDetails, ...cardDetails } as Scene["cardDetails"],
    cards: { ...next.cards, cards: [...next.cards.cards, ...stopped, ...planned, ...finished] },
    inbox: { ...next.inbox, blocked: [...next.inbox.blocked, ...stopped.map((card) => ({ cardId: card.id, title: card.title, agent: card.agent, state: "stopped" as const, reason: card.reason, blockKind: null, blockReason: `가상 관문은 켜 두었다. ${card.ask}을 정해 주세요.` }))] },
    items: { ...next.items, items: [...next.items.items, goal] },
    itemDetails: { ...next.itemDetails, G10: detail },
  };
}

function bodyOf(scene: Scene, name: RouteName, id?: string): unknown {
  switch (name) {
    case "board":
      return scene.board;
    case "items":
      return scene.items;
    case "item":
      return id ? scene.itemDetails[id] : undefined;
    case "devices":
      return scene.devices;
    case "quota":
      return scene.quota;
    case "usage":
      return scene.usage[(id ?? "today") as keyof typeof scene.usage];
    case "modelsState":
      return scene.modelsState;
    case "checks":
      return scene.checks;
    case "goals":
      return scene.goals;
    case "goal":
      return scene.goals.goals.find((goal) => goal.id === id);
    case "cards":
      return id === undefined ? scene.cards : finishedPage(scene.cards, Number(id));
    case "card":
      return id ? scene.cardDetails[id] : undefined;
    case "inbox":
      return scene.inbox;
    case "record":
      return id ? scene.records[id] : undefined;
    case "settings":
      return settingsView(scene.settings, Math.floor(nowSeconds()));
    case "settingsHistory":
      return historyView(scene.settings, Number(id ?? SETTINGS_HISTORY.recent), Math.floor(nowSeconds()));
    case "settingsModels":
      return modelsView(scene.settings, Math.floor(nowSeconds()));
  }
}

/**
 * How the synthetic core takes settings writes (`&settings=`): this device may only read them, no revision was ever
 * written, or another device writes just before this page's first write, which the core then refuses as stale (412).
 */
export type SettingsScript = SettingsVariant | "stale" | "race";

/** Who the synthetic core says wrote from this page, and from the other device of `&settings=stale`. */
export const SETTINGS_WRITER = { principal: SYNTHETIC_OWNER.id, device: "나침반", other: "먹물" } as const;

/** A settings write drawn over another revision than the one read last: stale, and not sent, like HttpSource. */
const NOT_THE_READ: WriteResult<never> = { ok: false, status: 412, detail: null };

/** The owner's done mark can be taken back for ten minutes (lina#149). */
export const UNDO_SECONDS = 600;

/**
 * `&records=slow` (lina-app#232): each of k-101's worker runs serves the card's one record (r1's), as the hub's long card
 * does, and each read of it takes this long, as 300 kB of it does on a phone's link.
 */
export const SLOW_RECORD_MS = 1500;

type DueGroup = keyof BoardSnapshot["due"];

/** What one owner's done mark changed, so undo can put it back. */
interface DoneMark {
  readonly id: string;
  readonly at: number;
  readonly undoUntil: number;
  readonly before: readonly { id: string; state: WorkState; reason: string | null; stateSince: number | null; closedAt: number | null }[];
  readonly mine: readonly { index: number; row: BoardSnapshot["inbox"]["mine"][number] }[];
  readonly due: readonly { group: DueGroup; index: number; row: BoardSnapshot["due"][DueGroup][number] }[];
}

/** Seconds after an owner's comment before the synthetic agent replies: it lands on the next refresh. */
export const SYNTHETIC_REPLY_AFTER = 5;

/** The comment retry leaves on a to-do: the core re-runs nothing, the owning agent reads it. */
export const RETRY_TEXT = "다시 시도해 주세요.";

const REPLY_TEXT = { comment: "확인했어요. 반영할게요.", answer: "답을 받았어요. 이어서 할게요." } as const;

/** Milliseconds between two frames of the synthetic talk stream. */
export const TALK_FRAME_MS = 400;

/** The synthetic agent's reply to any message, in the pieces it streams. */
export const TALK_REPLY_DELTAS = ["네, 확인했어요. ", "입력 폼 간격부터 ", "맞추고 오늘 안에 ", "다시 알려 드릴게요."] as const;

/** How the synthetic gateway refuses a turn (`&talk=busy|down|none`): busy 429, down 503, no owning agent 409. */
export type TalkRefusal = "busy" | "down" | "none";

const TALK_REFUSED: Record<TalkRefusal, { status: number; code: string | null }> = {
  busy: { status: 429, code: null },
  down: { status: 503, code: "gateway_unreachable" },
  none: { status: 409, code: "no_owning_agent" },
};

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** The frames the core relays for one turn, in its order: talk.started, the gateway's run, talk.carried after the reply, done. */
export function syntheticTalkFrames(item: { id: string; title: string }, agent: string, message: string, ts: number): TalkEvent[] {
  const session = `app-${agent}`;
  const run = `run-${item.id}-${ts}`;
  const messageId = `msg-${item.id}-${ts}`;
  let seq = 0;
  const frame = () => ({ session_id: session, run_id: run, seq: (seq += 1), ts });
  return [
    { event: "talk.started", data: { item: { id: item.id, title: item.title }, agent, session_id: session } },
    { event: "run.started", data: { ...frame(), user_message: { role: "user", content: message } } },
    { event: "message.started", data: { ...frame(), message: { id: messageId, role: "assistant" } } },
    ...TALK_REPLY_DELTAS.map((delta): TalkEvent => ({ event: "assistant.delta", data: { ...frame(), message_id: messageId, delta } })),
    { event: "assistant.completed", data: { ...frame(), message_id: messageId, content: TALK_REPLY_DELTAS.join("") } },
    { event: "talk.carried", data: { agent, item: item.id } },
    { event: "run.completed", data: { ...frame(), message_id: messageId } },
    { event: "done", data: frame() },
  ];
}

/** The synthetic agent's reply in the owner's own window on it, in the pieces it streams. */
export const AGENT_REPLY_DELTAS = ["네, 보고 있어요. ", "지금 하는 일을 ", "정리해서 바로 ", "알려 드릴게요."] as const;

/** The first line the core puts on the owner's turns in that window (lina#482). */
export const APP_FIRST_LINE = "[LINA app]";

/** The frames of one turn in the owner's window on an agent: like a to-do's, with no item and nothing carried. */
export function syntheticAgentTalkFrames(agent: string, message: string, ts: number): AgentTalkEvent[] {
  const session = `app-${agent}`;
  const run = `run-${agent}-${ts}`;
  const messageId = `msg-${agent}-${ts}`;
  let seq = 0;
  const frame = () => ({ session_id: session, run_id: run, seq: (seq += 1), ts });
  return [
    { event: "talk.started", data: { agent, session_id: session } },
    { event: "run.started", data: { ...frame(), user_message: { role: "user", content: message } } },
    { event: "message.started", data: { ...frame(), message: { id: messageId, role: "assistant" } } },
    ...AGENT_REPLY_DELTAS.map((delta): AgentTalkEvent => ({ event: "assistant.delta", data: { ...frame(), message_id: messageId, delta } })),
    { event: "assistant.completed", data: { ...frame(), message_id: messageId, content: AGENT_REPLY_DELTAS.join("") } },
    { event: "run.completed", data: { ...frame(), message_id: messageId } },
    { event: "done", data: frame() },
  ];
}

/** Each scene's write count: a source answers "unchanged" while the scene has not changed since it served a route. */
const versions = new WeakMap<Scene, number>();

/** How often the synthetic stream sends what changed, like the core's batch interval. */
export const STREAM_TICK_MS = 300;
/** Events the synthetic stream keeps; a `since` older than that gets a resync, like the core's kept history. */
export const STREAM_HISTORY = 200;
/** `&live=drop`: the first connection drops this long after it opens, and another device writes meanwhile. */
export const STREAM_DROP_AFTER_MS = 3_000;
/** `&live=resync`: one resync this long after the first connection opens. */
export const STREAM_RESYNC_AFTER_MS = 2_000;

/** `&live=token`: the core restarts with a new session token this long after the first connection opens. */
export const STREAM_RESTART_AFTER_MS = 3_000;

/** `&live=talk`: another device sends the first agent a message this long after the first connection opens. */
export const STREAM_TALK_AFTER_MS = 3_000;

/** The message another device sends on `&live=talk`. */
export const OTHER_DEVICE_MESSAGE = "배포 순서는 정해졌어요?";

/**
 * How the synthetic stream behaves (`&live=`): as the core, refusing every connection, dropping once, one resync,
 * a core restart that hands out a new session token while another device writes, or another device's talk turn.
 */
export type StreamScript = "ok" | "down" | "drop" | "resync" | "token" | "talk";

/** Each scene's change log, shared by every source on it like the core's stores: `total` events so far. */
interface ChangeLog {
  readonly epoch: number;
  total: number;
  readonly events: ChangeEvent[];
}
const logs = new WeakMap<Scene, ChangeLog>();
let epochs = 0;

function logOf(scene: Scene): ChangeLog {
  let log = logs.get(scene);
  if (!log) {
    log = { epoch: (epochs += 1), total: 0, events: [] };
    logs.set(scene, log);
  }
  return log;
}

function cursorOf(log: ChangeLog, at: number): string {
  return `s.${log.epoch}.${at}`;
}

/** The position a cursor names in this log, or null when it is not this log's or no longer kept. */
function positionOf(log: ChangeLog, cursor: string): number | null {
  const match = /^s\.(\d+)\.(\d+)$/.exec(cursor);
  if (!match || Number(match[1]) !== log.epoch) return null;
  const at = Number(match[2]);
  return at > log.total || at < log.total - log.events.length ? null : at;
}

/** Each agent's app conversation, as its gateway keeps it: one per scene, so every device on it reads the same. */
const agentTalksOf = new WeakMap<Scene, Map<string, AgentTalkHistory["messages"]>>();

function eventsAfter(log: ChangeLog, at: number): ChangeEvent[] {
  return log.events.slice(log.events.length - (log.total - at));
}

/** One connection of the synthetic stream, as verify.mjs reads it: what it resumed from and what it got first. */
export interface StreamConnection {
  readonly since: string | null;
  first: "tail" | "missed" | "resync" | "refused" | "denied";
  missed: number;
  open: boolean;
}

interface Connection {
  readonly handlers: ChangeHandlers;
  readonly record: StreamConnection;
  at: number;
  timer: ReturnType<typeof setInterval> | null;
  resync: boolean;
  closed: boolean;
}

/** The synthetic core's public VAPID key: a real P-256 point whose private half was never kept. */
export const SYNTHETIC_PUSH_KEY = "BPkTOtYKP-jDfBYNqtOrQaKFX_KfJI3EtwD82LPKIPadvD4wW3jXqRXfGTDYvnX9VdTs8mJIRKCvV_80hq2OkUc"; // gitleaks:allow (a public key)

/** The push service hosts the core takes an endpoint on (push-client.yaml savePushSubscription). */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/** A subscription the synthetic push service handed out: an endpoint on a known host and keys of the right sizes. */
class SyntheticSubscription implements PushSubscriptionLike {
  constructor(
    readonly endpoint: string,
    private readonly dropped: (subscription: SyntheticSubscription) => void,
  ) {}

  toJSON(): PushSubscriptionJSON {
    // 65 bytes from 0x04 (an uncompressed P-256 point's length and prefix) and a 16-byte secret.
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) } };
  }

  async unsubscribe(): Promise<boolean> {
    this.dropped(this);
    return true;
  }
}

/**
 * The browser's push service in a synthetic run, where headless Chromium has none: `subscribe` hands out a made-up
 * endpoint on the Google host, and `rotate` stands for the push service changing it.
 */
export class SyntheticPushManager implements PushManagerLike {
  private current: SyntheticSubscription | null = null;
  private next = 1;

  async getSubscription(): Promise<PushSubscriptionLike | null> {
    return this.current;
  }

  async subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike> {
    if (options.applicationServerKey.length !== 65) throw new DOMException("applicationServerKey is not a P-256 public key", "InvalidAccessError");
    this.current ??= this.make();
    return this.current;
  }

  rotate(): void {
    this.current = this.make();
  }

  private make(): SyntheticSubscription {
    return new SyntheticSubscription(`https://fcm.googleapis.com/fcm/send/synthetic-${this.next++}`, (subscription) => {
      if (this.current === subscription) this.current = null;
    });
  }
}

/** The synthetic core's push store, as verify.mjs reads it (`window.__linaPush`). */
export interface SyntheticPush {
  readonly enabled: boolean;
  readonly subscriptions: Map<string, PushSubscriptionRequest>;
  saves: number;
  removes: number;
}

function work(kind: string, id: string): Omit<ChangeEvent, "at"> {
  return { source: "work", kind, id };
}

function fail(status: number, detail: string): WriteResult<never> {
  return { ok: false, status, detail };
}

/** Long enough that a click's 로그인 중 is still on screen when the click returns. */
const SIGN_IN_HOLD_MS = 180;

/**
 * Serves the synthetic scene like the core does: data on the first read of a route, then "unchanged" until a write
 * changes the scene. It keeps its own copy of the scene and applies the owner's writes to it the way the core applies
 * them to the record, so drives and captures go through the same screens and requests as on a live core.
 */
export class SyntheticSource implements Source {
  readonly scene: Scene;
  private readonly served = new Map<string, number>();
  private readonly replies: { id: string; cid: string; at: number; kind: "comment" | "answer" }[] = [];
  private nextCid = 1;
  private nextCardComment = 100;
  /** The last record per item: the owner's own done mark, or null once anything else was written after it. */
  private readonly marks = new Map<string, DoneMark | null>();
  private readonly talkRefusal: TalkRefusal | null;
  /** The owner's window on each agent, as its gateway keeps it: the first agent has two earlier turns, the rest none. */
  get agentTalks(): Map<string, AgentTalkHistory["messages"]> {
    let talks = agentTalksOf.get(this.scene);
    if (!talks) agentTalksOf.set(this.scene, (talks = new Map()));
    return talks;
  }
  private readonly connections = new Set<Connection>();
  private readonly script: StreamScript;
  /** `&records=slow`: k-101 read as the hub's long card (lina-app#232); see SLOW_RECORD_MS. */
  private readonly slowRecords: boolean;
  /** `&error=checks`: the hub's checks route does not answer, while every other route still does. */
  private readonly checksError: boolean;
  private streamDown: boolean;
  /** Every connection opened, every snapshot read and every credential renewal, for verify.mjs and the tests. */
  readonly stream: StreamConnection[] = [];
  reads = 0;
  renewals = 0;
  /** The session token the core takes, and the one this page holds; a restart changes the first. */
  private coreToken = 1;
  private pageToken = 1;
  /** `&push=off`: the core has no VAPID key. */
  readonly push: SyntheticPush;
  readonly pushManager = new SyntheticPushManager();
  /** The revision of the settings this page read last: what its If-Match names. */
  private settingsRead: string | null = null;
  /** `&settings=stale`: another device still has to write before this page's first write. */
  private staleNext: boolean;
  /** `&settings=race`: another device still has to write right after this page's first write lands. */
  private raceNext: boolean;
  /** Every settings write this page sent, refused ones too, for verify.mjs and the tests. */
  readonly settingsWrites: { kind: "patch" | "rollback"; ifMatch: string | null; status: number }[] = [];
  /** Restarts and sign-ins this page sent and the core took, for the tests. */
  readonly deviceWrites: { device: string; action: "restart" | "sign-in"; service?: "worker" | "ocx"; runner?: string }[] = [];
  /** Sign-ins taken, waiting for the next devices read to show signingIn. */
  private readonly signIns = new Set<string>();
  /** Sign-ins already shown as signingIn; the devices read after that one shows them signed in. */
  private readonly signInsRunning = new Set<string>();
  /** Sign-ins whose answer has not come back yet. */
  private readonly signing = new Set<string>();

  /** `scene` shares another source's copy, like a second device reading the same core. */
  constructor(options: { seed?: number; now?: number; sourceError?: boolean; checksError?: boolean; noRunning?: boolean; writerStopped?: boolean; endedRuns?: boolean; manyTodos?: boolean; hubRound9?: boolean; hubRound11?: boolean; hubRound18?: boolean; hubRound20?: boolean; hubRound22?: boolean; hubRound23?: boolean; hubRound24?: boolean; manyFinished?: boolean; scene?: Scene; talk?: TalkRefusal | null; live?: StreamScript; pushOff?: boolean; settings?: SettingsScript | null; power?: PowerVariant | null; slowRecords?: boolean } = {}) {
    this.slowRecords = options.slowRecords ?? false;
    this.staleNext = options.settings === "stale";
    this.raceNext = options.settings === "race";
    this.talkRefusal = options.talk ?? null;
    this.push = { enabled: !options.pushOff, subscriptions: new Map(), saves: 0, removes: 0 };
    this.script = options.live ?? "ok";
    this.checksError = options.checksError ?? false;
    this.streamDown = this.script === "down";
    const generated =
      options.scene ??
      generateScene(options.seed ?? SYNTHETIC_SEED, {
        now: Math.floor(options.now ?? nowSeconds()),
        sourceError: options.sourceError,
        checksError: options.checksError,
        noRunning: options.noRunning,
        writerStopped: options.writerStopped,
        endedRuns: options.endedRuns,
        manyTodos: options.manyTodos,
        hubRound9: options.hubRound9,
        hubRound11: options.hubRound11,
        manyFinished: options.manyFinished,
        settings: options.settings === "stale" || options.settings === "race" ? null : options.settings,
        power: options.power,
      });
    this.scene = options.scene ? generated : options.hubRound18 ? round18Scene(generated) : options.hubRound20 ? round20Scene(generated) : options.hubRound22 ? round22Scene(generated) : options.hubRound23 ? round23Scene(generated) : options.hubRound24 ? round24Scene(generated) : generated;
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const at = nowSeconds();
    this.reads += 1;
    if (this.pageToken !== this.coreToken) return { kind: "failed", offline: false, at, denied: true };
    if (this.checksError && name === "checks") return { kind: "failed", offline: false, at };
    this.deliverReplies(at);
    if (name === "devices") this.applySignIns();
    const longCard = name === "record" && this.slowRecords && this.scene.cardDetails["k-101"]?.workerRuns.some((worker) => worker.id === id);
    if (longCard) await new Promise((resolve) => setTimeout(resolve, SLOW_RECORD_MS));
    const body = longCard ? { ...this.scene.records.r1, id: id as string } : bodyOf(this.scene, name, id);
    if (body === undefined) return { kind: "missing", at };
    const key = `${name}:${id ?? ""}`;
    const version = versions.get(this.scene) ?? 0;
    if (name === "settings") this.settingsRead = revisionOf(this.scene.settings).id;
    if (this.served.get(key) === version) return { kind: "unchanged", at };
    this.served.set(key, version);
    return { kind: "data", data: structuredClone(body) as Routes[N], at };
  }

  async comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const text = body.text.trim();
    if (!text || text.length > 2000) return fail(400, "text must be 1-2000 characters after trimming");
    if (body.answer && (!detail.decision || detail.decision.answered)) return fail(409, `${id}에 주인이 정할 것이 없다`);
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    const kind = body.answer ? "answer" : "comment";
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text, status: "open", kind, replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (body.answer && detail.decision) {
      detail.decision.answered = true;
      detail.decision.cid = cid;
      for (const row of this.scene.board.inbox.decide) if (row.target === id) row.answered = true;
    }
    this.replies.push({ id, cid, at, kind });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed(work("commented", id));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  async done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    if (detail.state === "done") return fail(409, `${id}는 열린 항목이 아니다`);
    const open = detail.kind === "goal" ? detail.children.filter((child) => child.state !== "done").map((child) => child.id) : [];
    if (open.length && !body.withOpen) return fail(409, `${id}에 열린 할 일이 남아 있어 완료로 표시하지 않았다: ${open.join(", ")} — 함께 닫으려면 --with-open`);
    const at = Math.floor(nowSeconds());
    const ids = [id, ...open];
    const mark: DoneMark = {
      id,
      at,
      undoUntil: at + UNDO_SECONDS,
      before: ids.map((each) => {
        const item = this.scene.itemDetails[each];
        return { id: each, state: item.state, reason: item.reason, stateSince: item.stateSince, closedAt: item.closedAt };
      }),
      mine: this.scene.board.inbox.mine.map((row, index) => ({ index, row })).filter(({ row }) => ids.includes(row.id)),
      due: (Object.keys(this.scene.board.due) as DueGroup[]).flatMap((group) => this.scene.board.due[group].map((row, index) => ({ group, index, row })).filter(({ row }) => ids.includes(row.id))),
    };
    for (const each of ids) this.patchItem(each, { state: "done", reason: null, stateSince: at, closedAt: at, lastActivityAt: at });
    this.scene.board.inbox.mine = this.scene.board.inbox.mine.filter((row) => !ids.includes(row.id));
    for (const group of Object.keys(this.scene.board.due) as DueGroup[]) this.scene.board.due[group] = this.scene.board.due[group].filter((row) => !ids.includes(row.id));
    detail.ownerDone = { at, undoUntil: mark.undoUntil, with: open };
    this.marks.set(id, mark);
    this.recount(ids);
    this.changed(...ids.map((each) => work("done", each)));
    return { ok: true, data: { ok: true, id, state: "done", reason: null, cid: null, undoUntil: mark.undoUntil } };
  }

  async undo(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const mark = this.marks.get(id);
    if (!mark) return fail(409, `${id}의 마지막 기록이 주인의 완료 표시가 아니다`);
    if (nowSeconds() > mark.undoUntil) return fail(409, `완료 표시 뒤 10분이 지나 되돌리지 않았다 (${Math.floor((nowSeconds() - mark.at) / 60)}분 전). 다시 열려면 work reopen`);
    for (const before of mark.before) this.patchItem(before.id, { state: before.state, reason: before.reason, stateSince: before.stateSince, closedAt: before.closedAt });
    for (const { index, row } of mark.mine) this.scene.board.inbox.mine.splice(index, 0, row);
    for (const { group, index, row } of mark.due) this.scene.board.due[group].splice(index, 0, row);
    detail.ownerDone = null;
    this.marks.delete(id);
    this.recount(mark.before.map((before) => before.id));
    this.changed(...mark.before.map((before) => work("reopened", before.id)));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid: null, undoUntil: null } };
  }

  async retry(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text: RETRY_TEXT, status: "open", kind: "comment", replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed(work("commented", id));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  /** The owner's own to-do with no goal, as `work add --by <owner>` makes it (lina#693): listed, under 내 할 일, with a work event. */
  async addItem(body: AddItemRequest): Promise<WriteResult<ItemSummary>> {
    const title = body.text.trim();
    if (!title) return fail(400, "text is required");
    if (title.length > 2000) return fail(400, "text must be 1-2000 characters after trimming");
    if (body.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due)) return fail(400, `due must be YYYY-MM-DD, not ${body.due}`);
    const at = Math.floor(nowSeconds());
    const numbers = Object.keys(this.scene.itemDetails).flatMap((key) => (/^T\d+$/.test(key) ? [Number(key.slice(1))] : []));
    const id = `T${Math.max(0, ...numbers) + 1}`;
    const row: ItemSummary = { id, kind: "todo", parent: null, title, agent: null, addedBy: SYNTHETIC_OWNER.id, mine: true, state: "planned", reason: null, stateSince: at, lastActivityAt: at, createdAt: at, closedAt: null, due: body.due, doneCondition: null, area: null, projects: [], todos: null, runCount: 0, commentCount: 0 };
    this.scene.items.items.push(row);
    // The scene's details are read-only to the screens; the synthetic core is the one writer that adds to them.
    Object.assign(this.scene.itemDetails, { [id]: { ...row, why: null, basis: [], children: [], comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null } satisfies ItemDetail });
    this.scene.board.inbox.mine.push({ id, title, waiting: false, due: body.due, agent: SYNTHETIC_OWNER.id });
    this.changed(work("created", id));
    return { ok: true, data: structuredClone(row) };
  }

  async answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>> {
    const card = this.scene.cardDetails[cardId];
    if (!card) return fail(404, "no such card");
    const text = body.text.trim();
    if (!text) return fail(400, "empty text");
    const commentId = this.nextCardComment++;
    card.comments.push({ id: commentId, author: SYNTHETIC_OWNER.id, body: text, createdAt: Math.floor(nowSeconds()) });
    this.scene.inbox.questions = this.scene.inbox.questions.filter((question) => question.cardId !== cardId);
    this.changed({ source: "kanban", kind: "commented", id: cardId });
    return { ok: true, data: { ok: true, cardId, commentId, unblocked: false, state: card.state, reason: card.reason } };
  }

  async readNotices(body: NoticesReadRequest): Promise<WriteResult<NoticesReadResult>> {
    const keys = "keys" in body ? body.keys : null;
    if (keys && !keys.length) return fail(400, "keys is a non-empty list of notice keys");
    const marked = this.scene.board.notices.filter((notice) => !notice.read && (!keys || keys.includes(notice.key)));
    for (const notice of marked) notice.read = true;
    const unread = this.scene.board.notices.filter((notice) => !notice.read).length;
    this.scene.board.counts.unread = unread;
    // As the core (lina#742): one `notices` event naming the owner, only when the marks changed.
    if (marked.length) this.changed({ source: "notices", kind: "read", id: SYNTHETIC_OWNER.id });
    return { ok: true, data: { ok: true, unread } };
  }

  /**
   * One talk turn like the core's: the same refusals, then the frames one TALK_FRAME_MS apart on timers, so fake
   * timers step through it. The exchange lives in the agent's conversation, not in the work record: the scene does
   * not change.
   */
  async talk(id: string, body: TalkRequest, signal?: AbortSignal): Promise<TalkResult> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return { ok: false, status: 404, code: "unknown_item" };
    const message = body.message.trim();
    if (!message) return { ok: false, status: 400, code: "empty_message" };
    if (message.length > 4000) return { ok: false, status: 413, code: "message_too_long" };
    if (this.talkRefusal) return { ok: false, ...TALK_REFUSED[this.talkRefusal] };
    const agent = detail.agent ?? (detail.parent ? this.scene.itemDetails[detail.parent]?.agent : null);
    if (!agent) return { ok: false, status: 409, code: "no_owning_agent" };
    const frames = syntheticTalkFrames(detail, agent, message, nowSeconds());
    const over = () => this.talked(agent);
    async function* events(): AsyncGenerator<TalkEvent> {
      try {
        for (const frame of frames) {
          await wait(TALK_FRAME_MS, signal);
          yield frame;
        }
      } finally {
        over();
      }
    }
    return { ok: true, events: events() };
  }

  /** A turn in the owner's window on an agent: the same refusals as the core, then the frames on timers. */
  async agentTalk(agent: string, body: TalkRequest, signal?: AbortSignal): Promise<AgentTalkResult> {
    if (!this.scene.items.agents.some((each) => each.id === agent)) return { ok: false, status: 404, code: "unknown_agent" };
    const message = body.message.trim();
    if (!message) return { ok: false, status: 400, code: "empty_message" };
    if (message.length > 4000) return { ok: false, status: 413, code: "message_too_long" };
    if (this.talkRefusal === "busy" || this.talkRefusal === "down") return { ok: false, ...TALK_REFUSED[this.talkRefusal] };
    const at = nowSeconds();
    const frames = syntheticAgentTalkFrames(agent, message, at);
    const kept = this.agentHistory(agent);
    const over = () => this.talked(agent);
    async function* events(): AsyncGenerator<AgentTalkEvent> {
      try {
        for (const frame of frames) {
          await wait(TALK_FRAME_MS, signal);
          if (frame.event === "assistant.completed") kept.push({ role: "user", content: `${APP_FIRST_LINE}\n${message}`, timestamp: at }, { role: "assistant", content: frame.data.content, timestamp: nowSeconds() });
          yield frame;
        }
      } finally {
        over();
      }
    }
    return { ok: true, events: events() };
  }

  /**
   * A talk turn's stream is over, as the core's `_relay` ends it (lina#742): one `talk` event naming the agent, which
   * reads it back from the agent's conversation. The scene does not change, so no snapshot route answers anew.
   */
  private talked(agent: string): void {
    this.logged({ source: "talk", kind: "message", id: agent });
  }

  /** `&live=talk`: another device sends the first agent a message, and its reply is kept by the time the event goes out. */
  private anotherDeviceTalks(): void {
    const agent = this.scene.items.agents[0]?.id;
    if (!agent) return;
    const at = nowSeconds();
    this.agentHistory(agent).push({ role: "user", content: `${APP_FIRST_LINE}\n${OTHER_DEVICE_MESSAGE}`, timestamp: at }, { role: "assistant", content: AGENT_REPLY_DELTAS.join(""), timestamp: at });
    this.talked(agent);
  }

  async agentTalkHistory(agent: string): Promise<ReadResult<AgentTalkHistory>> {
    const at = nowSeconds();
    if (!this.scene.items.agents.some((each) => each.id === agent)) return { kind: "missing", at };
    const messages = this.agentHistory(agent);
    return { kind: "data", data: { agent, session_id: messages.length ? `app-${agent}` : null, messages: structuredClone(messages) }, at };
  }

  private agentHistory(agent: string): AgentTalkHistory["messages"] {
    let kept = this.agentTalks.get(agent);
    if (!kept) {
      const day = Math.floor(nowSeconds()) - 86_400;
      kept =
        agent === this.scene.items.agents[0]?.id
          ? [
              { role: "user", content: `${APP_FIRST_LINE}\n어디까지 왔어요?`, timestamp: day },
              { role: "assistant", content: "변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요.", timestamp: day + 60 },
            ]
          : [];
      this.agentTalks.set(agent, kept);
    }
    return kept;
  }

  /**
   * The core's change stream over this scene's log: the first message after a microtask (the tail, what a kept
   * `since` missed, or one resync), then what changed every STREAM_TICK_MS on a timer, so fake timers step it. The
   * tick also lets the synthetic agent reply, as the core's agents write on their own.
   */
  changes(since: string | null, handlers: ChangeHandlers): ChangeSocket {
    const record: StreamConnection = { since, first: "refused", missed: 0, open: false };
    this.stream.push(record);
    const connection: Connection = { handlers, record, at: 0, timer: null, resync: false, closed: false };
    const opening = this.stream.length === 1;
    queueMicrotask(() => {
      if (connection.closed) return;
      if (this.streamDown) {
        connection.closed = true;
        handlers.closed(false);
        return;
      }
      if (this.pageToken !== this.coreToken) {
        connection.closed = true;
        record.first = "denied";
        handlers.closed(true);
        return;
      }
      const log = logOf(this.scene);
      const at = since === null ? log.total : positionOf(log, since);
      let message: ChangeMessage;
      if (at === null) {
        record.first = "resync";
        message = { cursor: cursorOf(log, log.total), resync: true };
      } else {
        const missed = eventsAfter(log, at);
        record.first = since === null ? "tail" : "missed";
        record.missed = missed.length;
        message = { cursor: cursorOf(log, log.total), events: missed };
      }
      record.open = true;
      connection.at = log.total;
      this.connections.add(connection);
      connection.timer = setInterval(() => this.tick(connection), STREAM_TICK_MS);
      handlers.message(message);
      if (opening && this.script === "drop") setTimeout(() => this.dropWhileAnotherDeviceWrites(), STREAM_DROP_AFTER_MS);
      if (opening && this.script === "resync") setTimeout(() => this.resyncStreams(), STREAM_RESYNC_AFTER_MS);
      if (opening && this.script === "token") setTimeout(() => this.restartCore(), STREAM_RESTART_AFTER_MS);
      if (opening && this.script === "talk") setTimeout(() => this.anotherDeviceTalks(), STREAM_TALK_AFTER_MS);
    });
    return { close: () => this.end(connection, false) };
  }

  /**
   * A worker run says one more thing in its round going now, as the runner's live view does: its record changes and
   * a `worker` change event names the run.
   */
  recordSays(runId: string, text: string): void {
    const round = this.scene.records[runId]?.rounds[0];
    if (!round) return;
    round.rows.push({ at: Math.floor(nowSeconds()), kind: "said", text, count: 1 });
    this.changed({ source: "worker", kind: "progress", id: runId });
  }

  /** Every open connection drops, as on sleep or a network change. */
  dropStreams(): void {
    for (const connection of [...this.connections]) this.end(connection, true);
  }

  /** The next tick of every open connection is one resync, as when a store that was down reads again. */
  resyncStreams(): void {
    for (const connection of this.connections) connection.resync = true;
  }

  /**
   * The core restarts with a new session token: every connection drops, and another device marks the first unread
   * notice read before the page reconnects. Until it renews its credential, the page's reads answer 403 and its
   * connections are refused at the upgrade.
   */
  restartCore(): void {
    this.dropStreams();
    this.coreToken += 1;
    const key = this.scene.board.notices.find((notice) => !notice.read)?.key;
    if (key) void this.readNotices({ keys: [key] });
  }

  /** The page reads the token the core serves now, as from a fresh `/app/`. */
  async renewCredential(): Promise<Renewal> {
    this.renewals += 1;
    if (this.pageToken === this.coreToken) return "same";
    this.pageToken = this.coreToken;
    return "renewed";
  }

  async pushKey(): Promise<ReadResult<PushKey>> {
    const enabled = this.push.enabled;
    return { kind: "data", data: { version: 1, enabled, publicKey: enabled ? SYNTHETIC_PUSH_KEY : null }, at: nowSeconds() };
  }

  /** The core's checks: push set up, an https endpoint on a known push host, a 65-byte key and a 16-byte secret. */
  async savePushSubscription(body: PushSubscriptionRequest): Promise<WriteResult<PushSubscriptionResult>> {
    if (!this.push.enabled) return fail(503, "push is not set up");
    let host = "";
    try {
      const url = new URL(body.endpoint);
      host = url.protocol === "https:" ? url.hostname : "";
    } catch {
      host = "";
    }
    if (!PUSH_HOSTS.some((rule) => rule.test(host))) return fail(400, "endpoint is not a known push service");
    if (base64UrlBytes(body.keys.p256dh).length !== 65 || base64UrlBytes(body.keys.auth).length !== 16) return fail(400, "keys are not a P-256 key and a 16-byte secret");
    const created = !this.push.subscriptions.has(body.endpoint);
    this.push.subscriptions.set(body.endpoint, structuredClone(body));
    this.push.saves += 1;
    const id = [...this.push.subscriptions.keys()].indexOf(body.endpoint) + 1;
    return { ok: true, data: { ok: true, id: id.toString(16).padStart(32, "0"), created } };
  }

  async removePushSubscription(body: PushRemoveRequest): Promise<WriteResult<PushRemoveResult>> {
    this.push.removes += 1;
    return { ok: true, data: { ok: true, removed: this.push.subscriptions.delete(body.endpoint) } };
  }

  /** Restarts worker or OCX on a node. Nothing on the row changes; the next devices read is unchanged. */
  async restartDevice(name: string, service: "worker" | "ocx"): Promise<WriteResult<DeviceAction>> {
    if (service !== "worker" && service !== "ocx") return fail(400, "service는 worker 또는 ocx");
    if (!this.scene.devices.machines.some((item) => item.name === name)) {
      if (this.scene.devices.person.some((item) => item.name === name)) return fail(409, "사람 기기는 다시 시작할 수 없습니다");
      return fail(404, "기기를 찾을 수 없습니다");
    }
    this.deviceWrites.push({ device: name, action: "restart", service });
    return { ok: true, data: { ok: true, device: name, action: "restart", state: "restarted", reason: null } };
  }

  /**
   * Starts sign-in and answers 202 while it is still running, as the core does. The next devices read shows that
   * cell signingIn; the read after that shows it signed in.
   */
  async signInDevice(name: string, runner: string): Promise<WriteResult<DeviceAction>> {
    const machine = this.scene.devices.machines.find((item) => item.name === name);
    if (!machine) {
      if (this.scene.devices.person.some((item) => item.name === name)) return fail(409, "사람 기기는 로그인할 수 없습니다");
      return fail(404, "기기를 찾을 수 없습니다");
    }
    const cell = machine.runners.find((item) => item.name === runner);
    if (!cell) return fail(404, "실행기를 찾을 수 없습니다");
    const key = `${name}\0${runner}`;
    if (this.signing.has(key) || this.signIns.has(key) || this.signInsRunning.has(key) || cell.signingIn) return fail(409, "로그인이 이미 진행 중입니다");
    if (cell.signIn === "signed_in" && !cell.why) return fail(409, "이미 로그인되어 있습니다");
    this.signing.add(key);
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_HOLD_MS));
    this.signing.delete(key);
    this.signIns.add(key);
    this.deviceWrites.push({ device: name, action: "sign-in", runner });
    return { ok: true, data: { ok: true, device: name, action: "sign-in", state: "started", reason: null } };
  }

  /**
   * The next devices read after a sign-in shows signingIn. The read after that one shows the runner signed in.
   * A read with nothing queued leaves the scene alone.
   */
  private applySignIns(): void {
    const cellFor = (key: string) => {
      const [name, runner] = key.split("\0");
      return this.scene.devices.machines.find((item) => item.name === name)?.runners.find((item) => item.name === runner);
    };
    let moved = false;
    for (const key of this.signInsRunning) {
      const cell = cellFor(key);
      if (cell) {
        cell.signingIn = false;
        cell.signIn = "signed_in";
        cell.why = null;
        cell.ready = true;
        moved = true;
      }
    }
    this.signInsRunning.clear();
    for (const key of this.signIns) {
      const cell = cellFor(key);
      if (cell) {
        cell.signingIn = true;
        this.signInsRunning.add(key);
        moved = true;
      }
    }
    this.signIns.clear();
    if (moved) this.changed();
  }

  /** A JSON Merge Patch over the settings, refused like the core: read-only device, stale If-Match, invalid result. */
  async patchSettings(patch: SettingsPatch, revision: string): Promise<WriteResult<SettingsWritten>> {
    if (this.settingsRead !== null && this.settingsRead !== revision) return NOT_THE_READ;
    return this.writeSettings("patch", () => mergePatch(currentSettings(this.scene.settings), patch), { kind: "app", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.device });
  }

  /** The revision before the newest, written again as a new revision; a second rollback undoes the first. */
  async rollbackSettings(revision: string): Promise<WriteResult<SettingsWritten>> {
    if (this.settingsRead !== null && this.settingsRead !== revision) return NOT_THE_READ;
    const { revisions } = this.scene.settings;
    if (revisions.length < 2) return this.settingsRefused("rollback", null, fail(422, "there is no revision to roll back to"));
    return this.writeSettings("rollback", () => revisions[revisions.length - 2], { kind: "rollback", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.device }, revisionOf(this.scene.settings).id);
  }

  /**
   * Another device writes the settings: `devices.workers.<device>.cap` one more, as the owner on SETTINGS_WRITER.other.
   * Every page that read them before now writes against a stale revision.
   */
  settingsWrittenElsewhere(device = "솔방울"): void {
    const cap = currentSettings(this.scene.settings).devices?.workers?.[device]?.cap ?? 1;
    this.settingsPatchedElsewhere({ devices: { workers: { [device]: { cap: cap + 1 } } } });
  }

  /**
   * Another device writes a merge patch over the settings, as the owner on SETTINGS_WRITER.other, checked like a write
   * from this page: the new revision, or the core's one-line reason when it refuses.
   */
  settingsPatchedElsewhere(patch: SettingsPatch): { ok: true; rev: string } | { ok: false; detail: string } {
    const settings = mergePatch(currentSettings(this.scene.settings), patch);
    const errors = validate(settings);
    if (errors.length) return { ok: false, detail: invalidDetail(errors) };
    const line = writeRevision(this.scene.settings, settings, { kind: "app", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.other }, Math.floor(nowSeconds()));
    if (line) this.changed({ source: "settings", kind: "revised", id: line.rev });
    return { ok: true, rev: revisionOf(this.scene.settings).id };
  }

  /**
   * OCX's state of one model changes (quota used up, back, turned off), and the core says so with a settings event,
   * as it does when another device's write changes what the models view warns about.
   */
  modelChangedElsewhere(id: string, changes: Partial<Pick<SettingsModel, "state" | "left" | "resetAt">>): void {
    const model = this.scene.settings.models.find((each) => each.id === id);
    if (!model) return;
    Object.assign(model, changes);
    this.changed({ source: "settings", kind: "revised", id: revisionOf(this.scene.settings).id });
  }

  private writeSettings(kind: "patch" | "rollback", next: () => Settings, by: SettingsAuditLine["by"], rollbackOf?: string): WriteResult<SettingsWritten> {
    const ifMatch = this.settingsRead;
    if (!this.scene.settings.writable) return this.settingsRefused(kind, ifMatch, fail(403, "only the owner on an owner device writes the settings"));
    if (this.staleNext) {
      this.staleNext = false;
      this.settingsWrittenElsewhere();
    }
    const now = revisionOf(this.scene.settings).id;
    if (ifMatch === null) return this.settingsRefused(kind, ifMatch, fail(428, "If-Match is required: read the settings first"));
    if (ifMatch !== now) return this.settingsRefused(kind, ifMatch, fail(412, `the settings changed since you read them (now ${now}): read again`));
    const settings = next();
    const errors = validate(settings);
    if (errors.length) return this.settingsRefused(kind, ifMatch, fail(422, invalidDetail(errors)));
    const line = writeRevision(this.scene.settings, settings, by, Math.floor(nowSeconds()), rollbackOf);
    this.settingsWrites.push({ kind, ifMatch, status: 200 });
    if (line) this.changed({ source: "settings", kind: rollbackOf ? "rolled_back" : "revised", id: line.rev });
    const written: WriteResult<SettingsWritten> = { ok: true, data: { ok: true, changes: line?.changes ?? [], revision: revisionOf(this.scene.settings) } };
    if (this.raceNext) {
      this.raceNext = false;
      this.settingsWrittenElsewhere();
    }
    return written;
  }

  private settingsRefused(kind: "patch" | "rollback", ifMatch: string | null, result: WriteResult<never>): WriteResult<never> {
    this.settingsWrites.push({ kind, ifMatch, status: result.ok ? 200 : result.status });
    return result;
  }

  /** While down, every new connection closes before its first message. */
  setStreamDown(down: boolean): void {
    this.streamDown = down;
  }

  /** `&live=drop`: the stream drops, then another device marks the first unread notice read before the reconnect. */
  private dropWhileAnotherDeviceWrites(): void {
    this.dropStreams();
    const key = this.scene.board.notices.find((notice) => !notice.read)?.key;
    if (key) void this.readNotices({ keys: [key] });
  }

  private end(connection: Connection, notify: boolean): void {
    if (connection.timer !== null) clearInterval(connection.timer);
    connection.timer = null;
    connection.closed = true;
    connection.record.open = false;
    const wasOpen = this.connections.delete(connection);
    if (notify && wasOpen) connection.handlers.closed(false);
  }

  private tick(connection: Connection): void {
    this.deliverReplies(nowSeconds());
    const log = logOf(this.scene);
    if (connection.resync) {
      connection.resync = false;
      connection.at = log.total;
      connection.handlers.message({ cursor: cursorOf(log, log.total), resync: true });
      return;
    }
    if (connection.at === log.total) return;
    const events = eventsAfter(log, connection.at);
    connection.at = log.total;
    connection.handlers.message({ cursor: cursorOf(log, log.total), events });
  }

  /** Goals' to-do counts follow their to-dos' states. */
  private recount(ids: readonly string[]): void {
    const goals = new Set(ids.map((id) => this.scene.itemDetails[id]).map((item) => (item?.kind === "goal" ? item.id : item?.parent)).filter((id): id is string => Boolean(id)));
    for (const goal of goals) {
      const children = this.scene.itemDetails[goal]?.children ?? [];
      this.patchItem(goal, { todos: { done: children.filter((child) => child.state === "done").length, total: children.length } });
    }
  }

  /** The owning agent answers each owner comment once it is SYNTHETIC_REPLY_AFTER seconds old. */
  private deliverReplies(now: number): void {
    const due = this.replies.filter((reply) => now - reply.at >= SYNTHETIC_REPLY_AFTER);
    if (!due.length) return;
    for (const reply of due) {
      this.replies.splice(this.replies.indexOf(reply), 1);
      const detail = this.scene.itemDetails[reply.id];
      const comment = detail?.comments.find((entry) => entry.cid === reply.cid);
      if (!detail || !comment) continue;
      comment.replies.push({ by: detail.agent ?? "", at: Math.floor(now), text: REPLY_TEXT[reply.kind], result: "applied" });
      if (reply.kind === "answer") {
        detail.decision = null;
        const decide = this.scene.board.inbox.decide;
        for (let index = decide.length - 1; index >= 0; index -= 1) if (decide[index].target === reply.id) decide.splice(index, 1);
      }
    }
    this.changed(...due.map((reply) => work("comment_replied", reply.id)));
  }

  /** The same fields on the item's list entry, its detail and its row in its goal's children. */
  protected patchItem(id: string, patch: Partial<ItemSummary>): void {
    const targets: (ItemSummary | ItemDetail | undefined)[] = [this.scene.items.items.find((item) => item.id === id), this.scene.itemDetails[id]];
    const parent = this.scene.itemDetails[id]?.parent;
    if (parent) targets.push(this.scene.itemDetails[parent]?.children.find((child) => child.id === id));
    for (const target of targets) if (target) Object.assign(target, patch);
  }

  /**
   * The scene changed: every route answers with data again on its next read, from every source sharing it, and the
   * change goes into the scene's log for every stream on it.
   */
  protected changed(...events: Omit<ChangeEvent, "at">[]): void {
    versions.set(this.scene, (versions.get(this.scene) ?? 0) + 1);
    this.logged(...events);
  }

  /** The change goes into the scene's log for every stream on it; the routes keep answering unchanged. */
  private logged(...events: Omit<ChangeEvent, "at">[]): void {
    const log = logOf(this.scene);
    const at = Math.floor(nowSeconds());
    log.events.push(...events.map((event) => ({ ...event, at })));
    log.total += events.length;
    if (log.events.length > STREAM_HISTORY) log.events.splice(0, log.events.length - STREAM_HISTORY);
  }
}
