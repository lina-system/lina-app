import type {
  BoardSnapshot,
  DevicesView,
  GoalList,
  ItemDetail,
  ItemList,
  ItemSummary,
  ModelsState,
  QuotaView,
  RunCard,
  Settings,
  SettingsAuditLine,
  SettingsModel,
  StatusChecks,
  RunRecord,
  UsageRange,
  UsageRow,
  UsageView,
  WorkCardDetail,
  WorkCardList,
  WorkGoal,
  WorkInbox,
  WorkState,
} from "../api/client";
import { diffSettings } from "../model/settings";

/**
 * The model a run started with, and the settings revision it was submitted under. r1 (k-101's round 3) used
 * model-a at medium; r8 started on the fallback model-b. r9 and r10 (k-101's rounds 1 and 2) and r6 name no model,
 * so a card's 기록 can show one round with a model beside rounds with none. r6 still carries a revision so a
 * screen that drew it would fail the no-ids test. Every other run is from before the field existed.
 */
function modelFields(id: string): Pick<RunCard, "model" | "settingsRevision"> {
  if (id === "r1") return { model: { provider: "anthropic", id: "model-a", thinking: "medium", source: "runner:omo" }, settingsRevision: "r3" };
  if (id === "r8") return { model: { provider: "anthropic", id: "model-b", thinking: "high", source: "fallback:off" }, settingsRevision: "r3" };
  if (id === "r6") return { model: null, settingsRevision: "r3" };
  return { model: null, settingsRevision: null };
}

/**
 * The synthetic scene behind tests, captures and the verify skill. It is generated from a seed, never copied
 * from a real home: agent and machine names are invented words, titles are invented Korean work phrases, and
 * every time is relative to the `now` it is generated for, so a capture always reads "12분째", never a date.
 * Every route the app reads has its body here, shaped by the generated schema types.
 */
export const SYNTHETIC_SEED = 0x5eed;

const AGENT_NAMES = ["Mirel", "Tavo", "Quenna", "Orli", "Pesk"] as const;
const MACHINE_NAMES = ["솔방울", "징검돌", "모래톱", "물레방아"] as const;
// Two services the app has display names for and one it shows as the core gives it.
const SERVICE_NAMES = ["anthropic", "openai", "가온셈"] as const;
const OWNER = { id: "owner", name: "나" } as const;
export const SYNTHETIC_OWNER = OWNER;

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(rng: Rng, values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export interface SceneOptions {
  readonly now: number;
  readonly sourceError?: boolean;
  /** The hub's checks did not answer (`&error=checks`): an empty list and a failed source. */
  readonly checksError?: boolean;
  /** No card or worker run is running, so 진행 중인 작업 holds only the stopped card (`&running=none`). */
  readonly noRunning?: boolean;
  /** The writer of the checked lines has stopped (`&writer=stopped`): the screens say the summaries stopped. */
  readonly writerStopped?: boolean;
  /** The work settings (`&settings=`): this device may only read them, or no revision was ever written. */
  readonly settings?: SettingsVariant | null;
}

export type SettingsVariant = "readonly" | "empty" | "ocx-down" | "many-warnings";

/** The work settings (lina-app#48) as the core keeps them; the synthetic source writes into it. */
export interface SettingsScene {
  readonly writable: boolean;
  /** The settings of r0 (the empty start), r1, r2, …: the newest last. */
  readonly revisions: Settings[];
  /** One audit line per revision after r0, oldest first. */
  readonly history: SettingsAuditLine[];
  /** The models OCX has on; a model it has off is not in the list. */
  readonly models: SettingsModel[];
  /** `&settings=ocx-down`: OCX does not answer, and the models are the last good list, read at this time. */
  readonly ocxReadAt: number | null;
}

export interface Scene {
  readonly now: number;
  readonly board: BoardSnapshot;
  readonly items: ItemList;
  readonly itemDetails: Readonly<Record<string, ItemDetail>>;
  readonly devices: DevicesView;
  readonly quota: QuotaView;
  /** Usage per range (lina#232), the numbers the 사용량 panel shows. */
  readonly usage: Readonly<Record<UsageRange, UsageView>>;
  /** The models on and each machine's OCX link (lina#232): one link down. */
  readonly modelsState: ModelsState;
  /** The hub's own checks (lina#233): three passing, one failing and one stale. */
  readonly checks: StatusChecks;
  readonly goals: GoalList;
  readonly cards: WorkCardList;
  readonly cardDetails: Readonly<Record<string, WorkCardDetail>>;
  readonly inbox: WorkInbox;
  /** Every worker run, the ones cards started included; the board lists only runs outside any card, as the core does. */
  readonly runs: readonly RunCard[];
  /** Worker runs' own records (lina#201), by run id; a run without one answers 404. */
  readonly records: Record<string, RunRecord>;
  readonly settings: SettingsScene;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

function day(now: number, offsetDays: number): string {
  const date = new Date((now + offsetDays * DAY) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysToNextWeek(now: number): number {
  const weekday = (new Date(now * 1000).getDay() + 6) % 7;
  return 7 - weekday;
}

interface TodoSeed {
  id: string;
  goal: string;
  agent: number;
  title: string;
  state: WorkState;
  reason: string | null;
  mine?: boolean;
  sinceAgo: number;
  due?: number;
  doneCondition: string;
}

export function generateScene(seed: number = SYNTHETIC_SEED, options: SceneOptions): Scene {
  const { now } = options;
  const rng = mulberry32(seed);
  const names = shuffle(rng, AGENT_NAMES).slice(0, 3);
  const machines = shuffle(rng, MACHINE_NAMES).slice(0, 3);
  const agents = names.map((name, index) => ({ id: `ag-${index + 1}`, name }));
  const agentId = (index: number) => agents[index].id;
  const weekOffset = Math.min(2, daysToNextWeek(now) - 1);

  const goalSeeds = [
    { id: "G1", agent: 0, title: "릴리스 노트 정리", state: "in_progress", sinceAgo: 2 * DAY, due: 0, doneCondition: "이번 릴리스의 변경이 모두 노트에 실림", why: "릴리스마다 바뀐 점을 한곳에서 보고 싶어요." },
    { id: "G2", agent: 1, title: "결제 화면 개편", state: "in_progress", sinceAgo: 5 * DAY, due: -2, doneCondition: "새 결제 화면이 모든 카드사에서 통과", why: "결제 중에 이탈이 많다는 말을 들었어요." },
    { id: "G3", agent: 2, title: "백업 주기 점검", state: "waiting", reason: "decision", sinceAgo: 3 * DAY, doneCondition: "복구 연습을 한 번 마침", why: "백업이 실제로 복구되는지 확인하고 싶어요." },
    { id: "G4", agent: 0, title: "온보딩 문서 갱신", state: "done", sinceAgo: 1 * DAY, doneCondition: "새 가이드가 문서 사이트에 올라감", why: "처음 온 사람이 혼자 시작할 수 있게요." },
    { id: "G5", agent: 1, title: "검색 속도 개선", state: "in_progress", sinceAgo: 4 * DAY, due: 20, doneCondition: "느린 질의 상위 열 개가 1초 안에 끝남", why: "검색이 느리다는 의견이 많아요." },
  ] as const;

  const todoSeeds: TodoSeed[] = [
    { id: "T1", goal: "G1", agent: 0, title: "변경 목록 모으기", state: "in_progress", reason: null, sinceAgo: 40 * MIN, doneCondition: "병합된 변경이 빠짐없이 목록에 있음" },
    { id: "T2", goal: "G1", agent: 0, title: "배포 순서 정하기", state: "waiting", reason: "decision", sinceAgo: 3 * DAY, doneCondition: "배포 순서가 정해짐" },
    { id: "T3", goal: "G1", agent: 0, title: "공지 문구 확인", state: "planned", reason: null, mine: true, sinceAgo: 1 * DAY, due: weekOffset, doneCondition: "공지 문구를 확인함" },
    { id: "T4", goal: "G2", agent: 1, title: "카드 입력 폼 다듬기", state: "in_progress", reason: null, sinceAgo: 2 * HOUR, doneCondition: "입력 폼이 모든 화면 폭에서 맞음" },
    { id: "T5", goal: "G2", agent: 1, title: "오류 문구 바꾸기", state: "stopped", reason: "no_response", sinceAgo: 52 * MIN, doneCondition: "오류 문구가 새 문체로 바뀜" },
    { id: "T6", goal: "G2", agent: 1, title: "결제 실패 화면 검토", state: "waiting", reason: "review", sinceAgo: 3 * HOUR, doneCondition: "실패 화면 검토를 마침" },
    { id: "T7", goal: "G3", agent: 2, title: "백업 기록 살펴보기", state: "done", reason: null, sinceAgo: 2 * HOUR, doneCondition: "지난 한 달 백업 기록을 확인함" },
    { id: "T8", goal: "G3", agent: 2, title: "복구 연습 일정 잡기", state: "waiting", reason: "blocked_by_item", sinceAgo: 2 * DAY, doneCondition: "복구 연습 날짜가 정해짐" },
    { id: "T9", goal: "G3", agent: 2, title: "저장소 접근 권한 주기", state: "planned", reason: null, mine: true, sinceAgo: 2 * DAY, due: 30, doneCondition: "복구용 저장소에 들어갈 수 있음" },
    { id: "T10", goal: "G4", agent: 0, title: "가이드 초안 쓰기", state: "done", reason: null, sinceAgo: 1 * DAY, doneCondition: "초안이 검토를 통과함" },
    { id: "T11", goal: "G5", agent: 1, title: "색인 구조 비교", state: "stopped", reason: "failed", sinceAgo: 5 * HOUR, doneCondition: "두 색인 구조의 속도를 비교함" },
    // Another agent's to-do under G5: an agent's goals count only its own to-dos.
    { id: "T12", goal: "G5", agent: 2, title: "느린 질의 모으기", state: "waiting", reason: "feedback", sinceAgo: 1 * DAY, doneCondition: "느린 질의 목록이 정리됨" },
  ];

  const summary = (fields: Omit<ItemSummary, "createdAt" | "lastActivityAt" | "closedAt" | "area" | "projects" | "runCount" | "commentCount"> & Partial<ItemSummary>): ItemSummary => ({
    createdAt: now - 7 * DAY,
    lastActivityAt: fields.stateSince,
    closedAt: fields.state === "done" ? fields.stateSince : null,
    area: null,
    projects: [],
    runCount: 0,
    commentCount: 0,
    ...fields,
  });

  const todoItems: ItemSummary[] = todoSeeds.map((todo) =>
    summary({
      id: todo.id,
      kind: "todo",
      parent: todo.goal,
      title: todo.title,
      agent: agentId(todo.agent),
      addedBy: agentId(todo.agent),
      mine: Boolean(todo.mine),
      state: todo.state,
      reason: todo.reason,
      stateSince: now - todo.sinceAgo,
      due: todo.due === undefined ? null : day(now, todo.due),
      doneCondition: todo.doneCondition,
      todos: null,
    }),
  );

  const goalItems: ItemSummary[] = goalSeeds.map((goal) => {
    const children = todoItems.filter((todo) => todo.parent === goal.id);
    return summary({
      id: goal.id,
      kind: "goal",
      parent: null,
      title: goal.title,
      agent: agentId(goal.agent),
      addedBy: OWNER.id,
      mine: false,
      state: goal.state,
      reason: "reason" in goal ? goal.reason : null,
      stateSince: now - goal.sinceAgo,
      due: "due" in goal ? day(now, goal.due) : null,
      doneCondition: goal.doneCondition,
      todos: { done: children.filter((todo) => todo.state === "done").length, total: children.length },
    });
  });

  // The core's checked lines (lina#151); null where a line is not written yet or failed its check.
  const plain = (title: string | null, nowLine: string | null = null, result: string | null = null): RunCard["plain"] => ({ title, now: nowLine, result });
  const NO_LINES = plain(null);

  // Worker runs: r1-r5, r9 and r10 were started by work cards (r9, r1 and r10 are k-101's three rounds); r6, r7 and
  // r8 run outside any card. r7 and r8 are two jobs on one to-do that got one generated title: two cards. The raw
  // titles and live lines are what a worker records (file names, English topics); the screens never draw them.
  const runCards: RunCard[] = ([
    { id: "r1", title: "release-notes: collect merged PRs (round 3)", state: "in_progress", reason: null, agent: agentId(0), kind: "ulw", todo: "T1", host: machines[0], startedAt: now - 12 * MIN, endedAt: null, now: "adding a one-line summary per merged PR in CHANGES.md", plain: plain("변경 목록 모으기", "변경마다 한 줄 요약을 붙이는 중") },
    { id: "r2", title: "card-form.tsx polish", state: "in_progress", reason: null, agent: agentId(1), kind: "ulw", todo: "T4", host: machines[1], startedAt: now - 2 * HOUR, endedAt: null, now: "editing src/payment/card-form.tsx", plain: NO_LINES },
    { id: "r3", title: "error-copy.json rewrite", state: "stopped", reason: "unresponsive", agent: agentId(1), kind: "ulw", todo: "T5", host: machines[2], startedAt: now - 58 * MIN, endedAt: null, now: null, plain: plain("오류 문구 바꾸기") },
    { id: "r4", title: "payment failure screen review", state: "waiting", reason: "review", agent: agentId(1), kind: "research", todo: "T6", host: machines[0], startedAt: now - 4 * HOUR, endedAt: now - 3 * HOUR, now: null, plain: plain("결제 실패 화면 검토", null, "실패 화면 세 곳의 문구와 버튼을 비교함") },
    { id: "r5", title: "backup log audit", state: "done", reason: null, agent: agentId(2), kind: "ulw", todo: "T7", host: machines[1], startedAt: now - 2 * HOUR - 9 * MIN, endedAt: now - 2 * HOUR, now: null, plain: plain("백업 기록 살펴보기", null, "지난 한 달 백업이 모두 끝까지 돌았음") },
    { id: "r6", title: "index-structure benchmark v2", state: "waiting", reason: "review", agent: agentId(1), kind: "research", todo: "T11", host: machines[0], startedAt: now - 6 * HOUR, endedAt: now - 5 * HOUR, now: null, plain: plain("색인 구조 다시 비교", null, "새 색인이 느린 질의에서 두 배 빠름") },
    { id: "r7", title: "guide-draft.md pass", state: "done", reason: null, agent: agentId(0), kind: "ulw", todo: "T10", host: machines[1], startedAt: now - 50 * MIN, endedAt: now - 30 * MIN, now: null, plain: plain("가이드 초안 다듬기", null, "용어 표를 맨 앞으로 옮김") },
    { id: "r8", title: "guide-draft.md pass", state: "done", reason: null, agent: agentId(0), kind: "ulw", todo: "T10", host: machines[0], startedAt: now - 2 * DAY - 40 * MIN, endedAt: now - 2 * DAY, now: null, plain: plain("가이드 초안 다듬기", null, "첫 화면 설명을 세 문장으로 줄임") },
    { id: "r9", title: "release-notes: collect merged PRs (round 1)", state: "done", reason: null, agent: agentId(0), kind: "ulw", todo: "T1", host: machines[0], startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR - 40 * MIN, now: null, plain: plain("변경 목록 모으기", null, "병합된 변경 41개를 모음") },
    { id: "r10", title: "release-notes: collect merged PRs (round 2)", state: "done", reason: null, agent: agentId(0), kind: "ulw", todo: "T1", host: machines[1], startedAt: now - HOUR, endedAt: now - 40 * MIN, now: null, plain: plain("변경 목록 모으기", null, "문서만 바뀐 변경을 따로 묶음") },
  ] satisfies Omit<RunCard, "model" | "settingsRevision">[]).map((run) => ({ ...run, ...modelFields(run.id) }));

  // k-101 is in its third follow-up round (one card); k-102's checked lines are all missing, so its own title stands
  // in until they are written (its kind is read from that title too: 문서).
  const cardSeeds = [
    { id: "k-101", goal: "kg-1", agent: 0, title: "LINA-41 release notes / CHANGES.md", state: "in_progress", reason: null, elapsed: 12 * MIN, now: "adding one-line summaries", plain: plain("릴리스 변경 목록 정리", "변경마다 한 줄 요약을 붙이는 중"), todos: [["T1", true], ["모은 변경 확인", false], ["T3", false]], runs: ["r9", "r10", "r1"], lastBeat: now - 20 },
    { id: "k-102", goal: "kg-2", agent: 1, title: "위키: 결제 화면 문서 정리", state: "in_progress", reason: null, elapsed: 2 * HOUR, now: "editing card-form.tsx", plain: NO_LINES, todos: [["T4", false]], runs: ["r2"], lastBeat: now - 40 },
    { id: "k-103", goal: "kg-2", agent: 1, title: "payment error-copy.json", state: "stopped", reason: "unresponsive", elapsed: 52 * MIN, now: null, plain: plain("결제: 오류 문구 바꾸기"), todos: [["T5", false]], runs: ["r3"], lastBeat: now - 52 * MIN },
    { id: "k-104", goal: "kg-2", agent: 1, title: "payment failure review", state: "waiting", reason: "review", elapsed: 3 * HOUR, now: null, plain: plain("결제: 실패 화면 검토", null, "실패 화면 세 곳의 문구와 버튼을 비교함"), todos: [["T6", false]], runs: ["r4"], lastBeat: now - 3 * HOUR },
    { id: "k-105", goal: "kg-3", agent: 2, title: "backup log audit", state: "done", reason: null, elapsed: 9 * MIN, now: null, plain: plain("백업: 지난 기록 살펴보기", null, "지난 한 달 백업이 모두 끝까지 돌았음"), todos: [["T7", true]], runs: ["r5"], lastBeat: now - 2 * HOUR },
    // Just created in goal mode and not started: 예정 · ready, no run and no worker run yet.
    { id: "k-106", goal: "kg-3", agent: 2, title: "backup restore drill prep", state: "planned", reason: "ready", elapsed: 5 * MIN, now: null, plain: plain("백업: 복구 연습 준비하기"), todos: [["T8", false]], runs: [], lastBeat: now - 5 * MIN },
  ] as const;
  // k-101's rounds: each one's own start and end; the worker run of a round started inside it. k-103's first two
  // rounds started before the kept history (start 0): the first left a line, the second only its end receipt.
  const rounds: Record<string, WorkCardDetail["runs"]> = {
    "k-106": [],
    "k-103": [
      { id: 1, profile: null, status: "done", outcome: "completed", startedAt: 0, endedAt: now - 2 * HOUR, lastHeartbeatAt: now - 2 * HOUR, summary: "오류 문구 초안을 남김", live: false },
      { id: 2, profile: null, status: "done", outcome: "completed", startedAt: 0, endedAt: now - 90 * MIN, lastHeartbeatAt: now - 90 * MIN, summary: null, live: false },
      { id: 3, profile: null, status: "blocked", outcome: null, startedAt: now - HOUR, endedAt: null, lastHeartbeatAt: now - 52 * MIN, summary: null, live: false },
    ],
    "k-101": [
      // Each round spans exactly its worker run (r9, r10, r1), so a round's times and its run's duration agree.
      { id: 1, profile: null, status: "done", outcome: "completed", startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR - 40 * MIN, lastHeartbeatAt: now - 2 * HOUR - 40 * MIN, summary: null, live: false },
      { id: 2, profile: null, status: "done", outcome: "completed", startedAt: now - HOUR, endedAt: now - 40 * MIN, lastHeartbeatAt: now - 40 * MIN, summary: null, live: false },
      { id: 3, profile: null, status: "running", outcome: null, startedAt: now - 12 * MIN, endedAt: null, lastHeartbeatAt: now - 20, summary: null, live: true },
    ],
  };

  const todoTitle = (id: string) => todoSeeds.find((todo) => todo.id === id)?.title ?? "";
  const cardDetails: Record<string, WorkCardDetail> = {};
  for (const card of cardSeeds) {
    const done = card.todos.filter(([, isDone]) => isDone).length;
    cardDetails[card.id] = {
      id: card.id,
      title: card.title,
      agent: agentId(card.agent),
      state: card.state,
      reason: card.reason,
      elapsedSeconds: card.elapsed,
      todoProgress: { done, total: card.todos.length },
      now: card.now,
      plain: card.plain,
      todos: card.todos.map(([id, isDone], index) => ({ id: `check-${index + 1}`, title: todoTitle(id) || id, kind: "check", done: isDone })),
      workerRuns: card.runs.map((id) => {
        const run = runCards.find((candidate) => candidate.id === id);
        return { id, kind: "lina-worker", firstSeenAt: run?.startedAt ?? now, lastSeenAt: run?.endedAt ?? card.lastBeat };
      }),
      gates: [],
      comments:
        card.id === "k-103"
          ? [
              { id: 3, author: agentId(1), body: "오류 문구 초안을 공유했어요.", createdAt: now - 70 * MIN },
              { id: 4, author: agentId(1), body: "copy/errors.json 키 12개를 바꿈 (3f2a1c9)", createdAt: now - 60 * MIN },
              { id: 5, author: agentId(1), body: "결제 실패 문구를 새 문체로 바꾸는 중인데 카드사별로…", createdAt: now - 55 * MIN },
            ]
          : card.id === "k-101"
          ? [
              // In time order: the agent's note in round 1; the owner asks for the doc-only group before round 2 does
              // it, sends round 2 back for one-line summaries, then asks for a table before round 3 (which does both).
              // The owner's words are also the record's comment rows at the same times (records()).
              { id: 1, author: agentId(0), body: "지난 릴리스 이후 병합된 변경부터 모읍니다.", createdAt: now - 2 * HOUR - 55 * MIN },
              { id: 2, author: OWNER.id, body: "문서만 바뀐 변경은 따로 묶어 주세요.", createdAt: now - 90 * MIN },
              { id: 3, author: OWNER.id, body: "변경마다 한 줄 요약을 붙여 주세요", createdAt: now - 45 * MIN },
              { id: 4, author: OWNER.id, body: "변경 목록은 표로 보여 주세요", createdAt: now - 25 * MIN },
            ]
          : [],
      runs: rounds[card.id] ?? [
        {
          id: 1,
          profile: null,
          status: card.state === "done" ? "done" : card.state === "in_progress" ? "running" : "blocked",
          outcome: null,
          startedAt: now - card.elapsed,
          endedAt: card.state === "done" ? card.lastBeat : null,
          lastHeartbeatAt: card.lastBeat,
          summary: null,
          live: card.state === "in_progress",
        },
      ],
    };
  }
  const cardList: WorkCardList = {
    cards: cardSeeds.map((card) => {
      const { todos: _todos, workerRuns: _runs, gates: _gates, comments: _comments, runs: _cardRuns, ...summaryFields } = cardDetails[card.id];
      return summaryFields;
    }),
  };

  const goalCards: WorkGoal[] = [
    { id: "kg-1", title: "릴리스 노트 정리", agent: agentId(0), state: "in_progress", reason: null, elapsedSeconds: 2 * DAY, workCards: [cardList.cards[0]], evidence: [] },
    { id: "kg-2", title: "결제 화면 개편", agent: agentId(1), state: "in_progress", reason: null, elapsedSeconds: 5 * DAY, workCards: cardList.cards.slice(1, 4), evidence: [] },
    { id: "kg-3", title: "백업 주기 점검", agent: agentId(2), state: "waiting", reason: "review", elapsedSeconds: 3 * DAY, workCards: [cardList.cards[4]], evidence: [] },
    {
      id: "kg-4",
      title: "온보딩 문서 갱신",
      agent: agentId(0),
      state: "done",
      reason: null,
      elapsedSeconds: 6 * DAY,
      workCards: [],
      evidence: [{ cardId: "kg-4", title: "온보딩 문서 갱신", summary: "새 가이드를 문서 사이트에 올리고 첫 화면에 연결함", metadata: null, completedAt: now - 1 * DAY }],
    },
  ];

  const goalWorkCards: Record<string, string[]> = { G1: ["kg-1", "k-101"], G2: ["kg-2", "k-102", "k-103", "k-104"], G3: ["kg-3", "k-105"], G4: ["kg-4"], G5: [] };
  const todoWorkCards: Record<string, string[]> = { T1: ["k-101"], T3: ["k-101"], T4: ["k-102"], T5: ["k-103"], T6: ["k-104"], T7: ["k-105"] };

  const decisions: Record<string, { text: string; kind: "ask" | "act"; ago: number; choices?: string[]; recommended?: string }> = {
    T2: { text: "배포를 금요일 오후에 해도 될까요?", kind: "ask", ago: 3 * DAY, choices: ["금요일 오후", "월요일 오전"], recommended: "금요일 오후" },
    G3: { text: "복구 연습에 쓸 두 시간을 비워 주세요.", kind: "act", ago: 2 * DAY },
    T12: { text: "자주 쓰는 검색어 열 개를 알려 주세요.", kind: "act", ago: 1 * DAY },
  };

  const comments: Record<string, ItemDetail["comments"]> = {
    T4: [
      {
        cid: "c1",
        by: agentId(1),
        at: now - 90 * MIN,
        text: "입력 칸 순서를 카드 번호, 유효 기간, 보안 코드로 바꿨어요.",
        status: "open",
        kind: "comment",
        replies: [{ by: OWNER.id, at: now - 80 * MIN, text: "좋아요. 휴대폰에서도 한 줄에 맞는지 봐 주세요.", result: null }],
      },
      {
        cid: "c2",
        by: OWNER.id,
        at: now - 60 * MIN,
        text: "오류가 나면 입력한 값은 지우지 말아 주세요.",
        status: "resolved",
        kind: "comment",
        replies: [{ by: agentId(1), at: now - 55 * MIN, text: "입력값을 남기도록 고쳤어요.", result: "applied" }],
      },
    ],
    T2: [
      {
        cid: "c3",
        by: agentId(0),
        at: now - 3 * DAY,
        text: "금요일 오후가 사용량이 가장 적어요.",
        status: "open",
        kind: "comment",
        replies: [
          { by: OWNER.id, at: now - 2 * DAY, text: "월요일 오전은 어떤가요?", result: null },
          { by: agentId(0), at: now - 2 * DAY + HOUR, text: "월요일 오전에는 정산 작업이 겹쳐요.", result: "needs_answer" },
        ],
      },
    ],
  };

  const itemRuns = (todoId: string): ItemDetail["runs"] =>
    runCards
      .filter((run) => run.todo === todoId)
      .map((run) => ({ id: run.id, title: run.plain.title ?? todoTitle(todoId), state: run.state, reason: run.reason, startedAt: run.startedAt === null ? null : Math.round(run.startedAt), endedAt: run.endedAt === null ? null : Math.round(run.endedAt) }));

  const itemDetails: Record<string, ItemDetail> = {};
  for (const goal of goalItems) {
    const seedGoal = goalSeeds.find((candidate) => candidate.id === goal.id);
    itemDetails[goal.id] = {
      ...goal,
      why: seedGoal?.why ?? null,
      basis: [{ text: seedGoal?.why ?? "", at: now - 7 * DAY }],
      children: todoItems.filter((todo) => todo.parent === goal.id),
      comments: [],
      runs: [],
      links: [],
      workCards: goalWorkCards[goal.id] ?? [],
      decision: decisions[goal.id]
        ? { text: decisions[goal.id].text, kind: decisions[goal.id].kind, choices: [], recommended: null, cid: null, at: now - decisions[goal.id].ago, answered: false }
        : null,
      ownerDone: null,
    };
  }
  for (const todo of todoItems) {
    const decision = decisions[todo.id];
    const todoComments = comments[todo.id] ?? [];
    const runs = itemRuns(todo.id);
    itemDetails[todo.id] = {
      ...todo,
      runCount: runs.length,
      commentCount: todoComments.length,
      why: null,
      basis: [],
      children: [],
      comments: todoComments,
      runs,
      links: [],
      workCards: todoWorkCards[todo.id] ?? [],
      decision: decision
        ? { text: decision.text, kind: decision.kind, choices: decision.choices ?? [], recommended: decision.recommended ?? null, cid: null, at: now - decision.ago, answered: false }
        : null,
      ownerDone: null,
    };
  }
  const listItems = [...goalItems, ...todoItems].map((item) => {
    const detail = itemDetails[item.id];
    return { ...item, runCount: detail.runs.length, commentCount: detail.comments.length };
  });

  const question = { cardId: "k-102", title: "위키: 결제 화면 문서 정리", agent: agentId(1), commentId: 7, body: "카드 번호는 앞 여섯 자리까지 보여 줄까요?", askedAt: now - 1 * DAY - 4 * HOUR };

  const decide = Object.entries(decisions).map(([target, decision]) => ({
    target,
    title: listItems.find((item) => item.id === target)?.title ?? "",
    agent: listItems.find((item) => item.id === target)?.agent ?? null,
    kind: decision.kind,
    text: decision.text,
    at: now - decision.ago,
    answered: false,
  }));
  const mineRows = todoItems
    .filter((todo) => todo.mine)
    .map((todo) => ({ id: todo.id, title: todo.title, waiting: false, due: todo.due, agent: todo.addedBy }));

  const row = (item: ItemSummary) => ({ id: item.id, kind: item.kind, title: item.title, due: item.due, agent: item.agent });
  const open = listItems.filter((item) => item.state !== "done" && item.due !== null);
  const today = day(now, 0);
  const weekEnd = day(now, daysToNextWeek(now) - 1);
  const due = {
    overdue: open.filter((item) => (item.due ?? "") < today).map(row),
    today: open.filter((item) => item.due === today).map(row),
    week: open.filter((item) => (item.due ?? "") > today && (item.due ?? "") <= weekEnd).map(row),
    later: open.filter((item) => (item.due ?? "") > weekEnd).map(row),
  };

  // Runners (lina#234): one work node needs an update, one needs sign-in, one is unreachable, then the file node.
  // Names stay Korean. type and fleet are not drawn. The file node is the machine name the three work nodes did not take.
  const runner = (
    name: string,
    installed: string | null,
    signIn: "signed_in" | "signed_out" | "api_key" | "ocx" | "unknown" | null,
    why: "update" | "prepare" | "sign_in" | "unreachable" | "unknown" | null,
    fleet: string | null = installed,
  ) => ({ name, type: null, fleet, installed, signIn, signingIn: false, ready: why === null, why });
  const filesName = MACHINE_NAMES.find((name) => !machines.includes(name)) ?? MACHINE_NAMES[0];
  const machineList: BoardSnapshot["machines"] = [
    {
      name: machines[0],
      role: "work",
      reachable: true,
      state: "ok",
      why: null,
      cpu: 22,
      memory: 41,
      disk: 37,
      temp: 48,
      load: 0.6,
      cores: 8,
      running: 2,
      cap: 4,
      freeGb: 210,
      metricsAt: now - 20,
      runners: [runner("글결", "1.2", "signed_out", "sign_in", "1.4"), runner("탐색", "1.4", "signed_in", null)],
    },
    {
      name: machines[1],
      role: "work",
      reachable: true,
      state: "warn",
      why: "disk",
      cpu: 35,
      memory: 58,
      disk: 91,
      temp: 55,
      load: 1.2,
      cores: 8,
      running: 1,
      cap: 4,
      freeGb: 18,
      metricsAt: now - 25,
      runners: [runner("글결", "1.2", "signed_in", "update", "1.6"), runner("탐색", "1.4", "signed_in", null)],
    },
    {
      name: machines[2],
      role: "work",
      reachable: false,
      state: "down",
      why: "unreachable",
      cpu: null,
      memory: null,
      disk: null,
      temp: null,
      load: null,
      cores: null,
      running: null,
      cap: 2,
      freeGb: null,
      metricsAt: now - 3 * HOUR,
      runners: [runner("글결", null, null, "unreachable", "1.4"), runner("탐색", null, null, "unreachable", "1.4")],
    },
    {
      name: filesName,
      role: "files",
      reachable: true,
      state: "ok",
      why: null,
      cpu: 12,
      memory: 30,
      disk: 44,
      temp: 40,
      load: 0.2,
      cores: 4,
      running: 0,
      cap: 2,
      freeGb: 400,
      metricsAt: now - 15,
      runners: [runner("보관", "2.0", "signed_in", null)],
    },
  ];
  const person: DevicesView["person"] = [
    {
      name: "나침반",
      role: "person",
      reachable: true,
      checkedAt: now - 40,
      tools: [
        { name: "글결", fleet: "1.4", installed: "1.4" },
        { name: "탐색", fleet: "1.4", installed: "1.1" },
      ],
    },
    {
      name: "먹물",
      role: "person",
      reachable: false,
      checkedAt: now - 3 * HOUR,
      tools: [
        { name: "글결", fleet: "1.4", installed: "1.0" },
        { name: "탐색", fleet: "1.4", installed: "1.1" },
      ],
    },
  ];
  // A window warns when its rate reaches 100% before it resets, the core's rule for `warn`; `left` is the rest.
  const quotaWindow = (key: string, percent: number, resetIn: number, ratePerHour: number | null) => ({
    key,
    percent,
    left: Math.min(100, Math.max(0, 100 - percent)),
    resetAt: now + resetIn,
    ratePerHour,
    warn: ratePerHour !== null && percent + (ratePerHour * resetIn) / HOUR >= 100,
  });
  const quotaAccount = (id: string, number: number, plan: string, mainWindow: string | null, windows: ReturnType<typeof quotaWindow>[], state: "ok" | "paused" | "reauth" = "ok", active = true) => ({
    id,
    number,
    plan,
    paused: state === "paused",
    active,
    state,
    unavailable: false,
    mainWindow,
    warn: windows.some((window) => window.warn),
    windows,
  });
  // The core's rule (lina_board_quota.quota_view): a service row's percent and rate are the mean over the accounts
  // that are not paused and have a main window, so every service here keeps one such account and the row equals it.
  // A reauth account holds no window at all, so nothing stale can be read off it.
  const quotaList: BoardSnapshot["quota"] = options.sourceError
    ? []
    : [
        {
          service: SERVICE_NAMES[0],
          percent: 72,
          ratePerHour: 10,
          accounts: [
            quotaAccount("acct-a", 1, "pro", "fiveHour", [quotaWindow("fiveHour", 72, 3 * HOUR, 10), quotaWindow("weekly", 40, 4 * DAY, 0.5)]),
            quotaAccount("acct-b", 2, "pro", null, [], "reauth", false),
          ],
        },
        {
          service: SERVICE_NAMES[1],
          percent: 31,
          ratePerHour: 1,
          accounts: [quotaAccount("acct-c", 1, "team", "weekly", [quotaWindow("weekly", 31, 2 * DAY, 1)])],
        },
        {
          service: SERVICE_NAMES[2],
          percent: 5,
          ratePerHour: null,
          accounts: [
            quotaAccount("acct-d", 1, "basic", "monthly", [quotaWindow("monthly", 5, 12 * DAY, null)]),
            quotaAccount("acct-e", 2, "basic", "monthly", [quotaWindow("monthly", 9, 26 * DAY, null)], "paused"),
          ],
        },
      ];
  // Usage (lina#232), invented small numbers: a few dollars and a few thousand tokens today, more in 7 and 30 days.
  // byModel and byMachine are what the 사용량 panel's two lists read; byProvider and byAccount are not drawn.
  const usageTokens = (input: number, output: number, cacheRead: number) => ({ total: input + output + cacheRead, input, output, cacheRead });
  const usageRow = (requests: number, costUsd: number, tokens: [number, number, number], extra: { model?: string; provider?: string; machine?: string }): UsageRow => ({
    requests,
    tokens: usageTokens(...tokens),
    costUsd,
    ...extra,
  });
  const usage: Readonly<Record<UsageRange, UsageView>> = {
    today: {
      version: 1,
      at: now,
      range: "today",
      generatedAt: now - MIN,
      requests: 42,
      tokens: usageTokens(9000, 2000, 1480),
      costUsd: 3.42,
      byModel: [
        usageRow(18, 1.85, [4700, 1000, 500], { model: "haru", provider: "anthropic" }),
        usageRow(14, 1.12, [3000, 800, 400], { model: "saeol", provider: "openai" }),
        usageRow(10, 0.45, [1300, 200, 580], { model: "moru", provider: "openai" }),
      ],
      byProvider: [usageRow(18, 1.85, [4700, 1000, 500], { provider: "anthropic" }), usageRow(24, 1.57, [4300, 1000, 980], { provider: "openai" })],
      byAccount: [],
      byMachine: [usageRow(24, 2.05, [5000, 1200, 800], { machine: machines[0] }), usageRow(12, 1.01, [2800, 600, 400], { machine: machines[1] }), usageRow(6, 0.36, [1200, 200, 280], { machine: machines[2] })],
    },
    "7d": {
      version: 1,
      at: now,
      range: "7d",
      generatedAt: now - MIN,
      requests: 310,
      tokens: usageTokens(60000, 18000, 8400),
      costUsd: 18.4,
      byModel: [
        usageRow(130, 9.8, [28000, 9000, 4200], { model: "haru", provider: "anthropic" }),
        usageRow(104, 6.1, [21000, 6200, 3200], { model: "saeol", provider: "openai" }),
        usageRow(76, 2.5, [11000, 2800, 1000], { model: "moru", provider: "openai" }),
      ],
      byProvider: [usageRow(130, 9.8, [28000, 9000, 4200], { provider: "anthropic" }), usageRow(180, 8.6, [32000, 9000, 4200], { provider: "openai" })],
      byAccount: [],
      byMachine: [usageRow(190, 11.2, [34000, 10000, 5000], { machine: machines[0] }), usageRow(80, 5.4, [18000, 5500, 2500], { machine: machines[1] }), usageRow(40, 1.8, [8000, 2500, 900], { machine: machines[2] })],
    },
    "30d": {
      version: 1,
      at: now,
      range: "30d",
      generatedAt: now - MIN,
      requests: 1180,
      tokens: usageTokens(300000, 80000, 40000),
      costUsd: 63.1,
      byModel: [
        usageRow(480, 34.2, [135000, 36000, 19000], { model: "haru", provider: "anthropic" }),
        usageRow(420, 19.9, [105000, 28000, 15000], { model: "saeol", provider: "openai" }),
        usageRow(280, 9, [60000, 16000, 6000], { model: "moru", provider: "openai" }),
      ],
      byProvider: [usageRow(480, 34.2, [135000, 36000, 19000], { provider: "anthropic" }), usageRow(700, 28.9, [165000, 44000, 21000], { provider: "openai" })],
      byAccount: [],
      byMachine: [usageRow(720, 38.5, [170000, 45000, 25000], { machine: machines[0] }), usageRow(310, 17.6, [85000, 23000, 12000], { machine: machines[1] }), usageRow(150, 7, [45000, 12000, 3000], { machine: machines[2] })],
    },
  };
  // OCX itself (lina#232): three models on, and two links of which one did not answer. The machines named here are the
  // work nodes, and the link that is not fine is the work node the panel draws as 꺼짐 (machines[2]). The file node
  // is not an OCX link and is not in usage's 기기별.
  const modelsState: ModelsState = {
    version: 1,
    at: now,
    enabled: 3,
    disabled: 2,
    enabledModels: [
      { provider: "anthropic", model: "haru" },
      { provider: "openai", model: "saeol" },
      { provider: "openai", model: "moru" },
    ],
    machines: [
      { machine: machines[0], state: "connected", reportedAt: now - 30, ok: true },
      { machine: machines[2], state: "failed", reportedAt: now - 2 * HOUR, ok: false },
    ],
  };
  // The hub's own checks (lina#233), newest `at` first. Only the failing and stale ones draw; the three that pass
  // fold into one count. Each name and line is invented Korean, with no machine name, person or path.
  const checks: StatusChecks = options.checksError
    ? { version: 1, at: now, checks: [] }
    : {
        version: 1,
        at: now,
        checks: [
          { name: "도구 버전", ok: true, line: "모두 최신", at: now - 3 * MIN, staleAfter: HOUR, stale: false, state: "ok", file: "tools.json" },
          { name: "로그인 상태", ok: true, line: "로그인됨", at: now - 4 * MIN, staleAfter: HOUR, stale: false, state: "ok", file: "login.json" },
          { name: "매일 도구 통일", ok: true, line: "어제와 같음", at: now - 5 * MIN, staleAfter: HOUR, stale: false, state: "ok", file: "daily.json" },
          { name: "백업 회선", ok: false, line: "응답 없음", at: now - 12 * MIN, staleAfter: HOUR, stale: false, state: "failing", file: "backup.json" },
          { name: "대기 봇", ok: true, line: "소식이 끊김", at: now - 3 * HOUR, staleAfter: HOUR, stale: true, state: "stale", file: "wait.json" },
        ],
      };
  const errors: BoardSnapshot["errors"] = options.sourceError ? [{ source: "quota", message: "quota source did not answer" }] : [];

  const notices: BoardSnapshot["notices"] = [
    ...decide.map((row) => ({ key: `ask:${row.target}:${row.at}`, target: row.target, at: row.at, kind: "ask" as const, line: `${row.title}: ${row.kind === "ask" ? "질문" : "요청"}`, read: false })),
    { key: `ask:${question.cardId}:${question.askedAt}`, target: question.cardId, at: question.askedAt, kind: "ask", line: `${question.title}: 질문`, read: false },
    { key: `review:r6:${now - 5 * HOUR}`, target: "r6", at: now - 5 * HOUR, kind: "review", line: "색인 구조 다시 비교: 검토 필요", read: true },
    ...mineRows.map((row) => ({ key: `todo:${row.id}:${now - DAY}`, target: row.id, at: now - DAY, kind: "todo" as const, line: `${row.title}: 내 할 일`, read: row.id === "T9" })),
  ];

  const writer: BoardSnapshot["writer"] = options.writerStopped
    ? { state: "stopped", lastSuccessAt: now - 2 * HOUR, stoppedSince: now - 40 * MIN }
    : { state: "ok", lastSuccessAt: now - MIN, stoppedSince: null };

  const board: BoardSnapshot = {
    version: 1,
    at: now,
    errors,
    counts: {
      inbox: decide.length + 1 + 2 + mineRows.length,
      running: 2,
      stopped: 1,
      due: due.overdue.length + due.today.length + due.week.length + due.later.length,
      done: 3,
      agents: { [agentId(0)]: 1, [agentId(1)]: 1, [agentId(2)]: 0 },
      unread: notices.filter((notice) => !notice.read).length,
    },
    // Like the core (hermes_cli/worker/board.py), the board lists only worker runs outside any card.
    cards: runCards.filter((run) => !cardSeeds.some((card) => (card.runs as readonly string[]).includes(run.id))),
    inbox: { decide, review: ["r6"], mine: mineRows },
    due,
    notices,
    machines: machineList,
    quota: quotaList,
    writer,
  };

  if (options.noRunning) {
    const running = new Set([...cardList.cards.filter((card) => card.state === "in_progress").map((card) => card.id), ...runCards.filter((run) => run.state === "in_progress").map((run) => run.id)]);
    cardList.cards = cardList.cards.filter((card) => !running.has(card.id));
    for (const id of running) delete cardDetails[id];
    for (const goal of goalCards) goal.workCards = goal.workCards.filter((card) => !running.has(card.id));
    board.cards = board.cards.filter((run) => !running.has(run.id));
    board.counts.running = 0;
    for (const agent of Object.keys(board.counts.agents ?? {})) if (board.counts.agents) board.counts.agents[agent] = 0;
  }

  return {
    now,
    board,
    items: { version: 1, at: now, errors: [], owner: { ...OWNER }, agents, items: listItems },
    itemDetails,
    devices: { version: 1, at: now, errors: [], machines: machineList, person },
    quota: { version: 1, at: now, errors, quota: quotaList, missing: options.sourceError ? null : ["Cursor"] },
    usage,
    modelsState,
    checks,
    goals: { goals: goalCards },
    cards: cardList,
    cardDetails,
    inbox: { blocked: [], questions: [question] },
    runs: runCards,
    records: records(now),
    settings: settingsScene(now, options.settings ?? null),
  };
}

/**
 * The work settings: three runners (dsh's model is off in OCX, codex's out of quota, so two warnings show), two
 * routing rules, two work machines, a file machine and a person's device, written in three revisions by the CLI,
 * this app and an outside edit. OCX has three of the four models on, from two services.
 */
function settingsScene(now: number, variant: SettingsVariant | null): SettingsScene {
  const models: SettingsModel[] = [
    { provider: "anthropic", id: "model-a", name: null, namespaced: null, efforts: ["low", "medium", "high"], defaultEffort: "high", state: "ok", left: 72, resetAt: now + 3 * HOUR - 10 * MIN, accounts: 1 },
    { provider: "anthropic", id: "model-b", name: null, namespaced: null, efforts: ["high"], defaultEffort: "high", state: "ok", left: 40, resetAt: now + 2 * DAY, accounts: 1 },
    { provider: "openai", id: "model-c", name: null, namespaced: null, efforts: ["low", "medium", "high"], defaultEffort: "medium", state: "out_of_quota", left: 0, resetAt: now + 5 * HOUR, accounts: 1 },
  ];
  const ocxReadAt = variant === "ocx-down" ? now - 7 * MIN : null;
  if (variant === "empty") return { writable: true, revisions: [{}], history: [], models, ocxReadAt };
  const r1: Settings = {
    devices: {
      workers: {
        "machine-a": { host: "machine-a", role: "work", cap: 1, named_cap: 2, fast: true },
        "machine-b": { host: "machine-b", role: "work", cap: 1, no_repo: true },
        "files-a": { host: "files-a", role: "files", named_cap: 1, no_repo: true },
        "laptop-a": { role: "person" },
      },
    },
    worker: {
      default_runner: "omo",
      models: { fallback: "anthropic/model-b" },
      runners: {
        omo: { type: "omo", on: true, model: "anthropic/model-a:high", access: "full" },
        codex: { type: "command", argv: ["codex", "exec", "-"], on: true, model: "openai/model-c:low", fallback_model: "anthropic/model-b", access: "workspace-write" },
        dsh: { type: "command", argv: ["dsh", "-"], on: true, model: "openai/model-d", access: "read-only" },
      },
      routing: [{ name: "docs", when: { labels_any: ["docs"] }, runner: "codex" }],
    },
  };
  const r2: Settings = structuredClone(r1);
  r2.worker!.runners!.codex.model = "openai/model-c:medium";
  const r3: Settings = structuredClone(r2);
  r3.worker!.routing!.push({ name: "quick", when: { labels_any: ["quick"], size: ["S"] }, runner: "dsh" });
  r3.devices!.workers!["machine-a"].cap = 2;
  if (variant === "many-warnings") {
    // Four models warned about: omo's and the fallback off, codex's out of quota, dsh's off with no fallback to take.
    r3.worker!.runners!.omo.model = "openai/model-d";
    r3.worker!.models!.fallback = "openai/model-d";
  }
  const revisions = [{}, r1, r2, r3];
  const by = [
    { kind: "cli", principal: OWNER.id, device: "local", at: now - 3 * DAY },
    { kind: "app", principal: OWNER.id, device: "laptop-a", at: now - DAY },
    { kind: "outside", principal: "", device: "", at: now - 2 * HOUR },
  ] as const;
  const history = by.map(({ at, ...who }, index): SettingsAuditLine => ({ rev: `r${index + 1}`, base: `r${index}`, at, by: who, changes: diffSettings(revisions[index], revisions[index + 1]) }));
  return { writable: variant !== "readonly", revisions, history, models, ocxReadAt };
}

/**
 * The worker runs' own records. r1 (k-101's job) has its round going now (a sentence, a tools row, a raw English
 * line with a path, a sentence said three times in a row), an earlier round the owner sent back with its note, a
 * round whose start fell out of the kept history with only its result, and two comments made between rounds. r6 has one
 * finished round whose result line is raw text. Raw text here fails the screens' no-raw-text tests if drawn as is.
 */
function records(now: number): Record<string, RunRecord> {
  const row = (at: number, kind: RunRecord["comments"][number]["kind"], text: string | null, count = 1) => ({ at, kind, text, count });
  return {
    r1: {
      id: "r1",
      at: now,
      ...modelFields("r1"),
      rounds: [
        {
          run: 3,
          startedAt: now - 12 * MIN,
          endedAt: null,
          endKnown: false,
          startUnknown: false,
          result: null,
          verdict: null,
          stopped: false,
          rows: [
            row(now - 11 * MIN, "said", "변경마다 한 줄 요약을 붙이는 중"),
            row(now - 10 * MIN, "tools", null, 4),
            row(now - 8 * MIN, "said", "Running npm test in packages/release"),
            row(now - 6 * MIN, "said", "요약을 표로 옮기는 중", 3),
          ],
        },
        {
          run: 2,
          startedAt: now - HOUR,
          endedAt: now - 40 * MIN,
          endKnown: true,
          startUnknown: false,
          result: "문서만 바뀐 변경을 따로 묶음",
          verdict: "rejected",
          stopped: false,
          rows: [row(now - 45 * MIN, "comment", "변경마다 한 줄 요약을 붙여 주세요")],
        },
        // Round 1 (r9's): its start fell out of the kept history; it ends where r9 ends.
        { run: null, startedAt: null, endedAt: now - 2 * HOUR - 40 * MIN, endKnown: true, startUnknown: true, result: "병합된 변경 41개를 모음", verdict: null, stopped: false, rows: [] },
      ],
      comments: [row(now - 90 * MIN, "comment", "문서만 바뀐 변경은 따로 묶어 주세요."), row(now - 25 * MIN, "comment", "변경 목록은 표로 보여 주세요")],
      errors: [],
    },
    r6: {
      id: "r6",
      at: now,
      ...modelFields("r6"),
      rounds: [{ run: 1, startedAt: now - 6 * HOUR, endedAt: now - 5 * HOUR, endKnown: true, startUnknown: false, result: "index-structure benchmark v2 done (3f2a1c9)", verdict: null, stopped: false, rows: [] }],
      comments: [],
      errors: [],
    },
  };
}

/** The numbers the scene is built to show; the fixture test and verify.mjs doctor hold the screens to them. */
export const SCENE_COUNTS = {
  agents: 3,
  goals: 5,
  todos: 12,
  decisions: 4,
  // 결정 필요 4, 검토 필요 2 (r6 outside any card, k-104 a card waiting for review), 내 할 일 2.
  inbox: 8,
  running: 2,
  stopped: 1,
  due: 5,
  done: 3,
  machines: 4,
  machinesOk: 2,
  machinesWarn: 1,
  machinesDown: 1,
  // OCX (lina#232): three models on, two links, one of them down; usage for each of the three ranges.
  modelsEnabled: 3,
  links: 2,
  linksDown: 1,
  usageRanges: 3,
  // 점검: three pass and fold into 정상 3; one failing and one stale stay open.
  checks: 5,
  checksOk: 3,
  checksOpen: 2,
  notices: 7,
  unread: 5,
} as const;
