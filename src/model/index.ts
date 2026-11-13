import type {
  BoardSnapshot,
  DevicesView,
  GoalList,
  ItemDetail,
  ItemList,
  ItemSummary,
  Machine,
  ModelsState,
  PersonDevice,
  Notice,
  QuotaService,
  QuotaView,
  RunCard,
  StatusChecks,
  UsageRange,
  UsageView,
  WorkCardDetail,
  WorkCardList,
  WorkCardSummary,
  WorkGoal,
  WorkInbox,
  WorkState,
} from "../api/client";
import { CRUMB, KIND_TITLE, REASON_WORD, SEP, SOURCE_WORD, STATE_WORD, W, reasonWord } from "../words";
import { href } from "../router";
import { checksView, type ChecksView } from "./checks";
import { foldReason } from "./fold";
import { cardKind, type CardKind } from "./kind";
import { ocxView, usageViews, type OcxView, type UsageRangeView } from "./usage";

export interface ModelInput {
  readonly board?: BoardSnapshot;
  readonly items?: ItemList;
  readonly goals?: GoalList;
  readonly cards?: WorkCardList;
  /** When the cards list was received; `elapsedSeconds` counts from here. */
  readonly cardsAt?: number;
  readonly inbox?: WorkInbox;
  readonly devices?: DevicesView;
  readonly quota?: QuotaView;
  /** Usage per range (lina#232); the screen shows the one its control picks. */
  readonly usage?: Readonly<Partial<Record<UsageRange, UsageView>>>;
  /** The models on and each machine's OCX link (lina#232). */
  readonly modelsState?: ModelsState;
  readonly checks?: StatusChecks;
  readonly cardDetails: Readonly<Record<string, WorkCardDetail>>;
  readonly failed: readonly string[];
  /** What the owner's writes in flight change in the lists (see Actions); counts follow the rows it leaves. */
  readonly pending?: Pending;
}

export type MineSource = BoardSnapshot["inbox"]["mine"][number];

export interface Pending {
  /** Inbox rows hidden while their answer waits for its toast. */
  readonly hidden: ReadonlySet<string>;
  /** 내 할 일 rows just marked done: they stay where they were, struck through, until their toast ends. */
  readonly held: readonly { readonly row: MineSource; readonly index: number }[];
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly letter: string;
  readonly index: number;
  readonly href: string;
}

/**
 * One 작업: a work card or a worker run started outside any card. Its lines are the core's checked lines
 * (`plain`, lina#151) only: a line not written yet, or one that failed its check, is null and shows nothing; the
 * raw title or live state is never drawn in its place.
 */
export interface CardRow {
  readonly key: string;
  readonly kind: "card" | "run";
  readonly work: CardKind;
  readonly id: string;
  readonly href: string;
  /** The name in colour: a work card's checked title, or its own title until that exists when it may be drawn (cardTitle); a run's checked title only. */
  readonly title: string | null;
  /** What the card is called everywhere: that title, else its kind word (cardName). */
  readonly name: string;
  readonly agent: string | null;
  readonly state: WorkState;
  readonly reason: string | null;
  /** Running: when it started (the time counts up from here). */
  readonly startedAt: number | null;
  /** Waiting or stopped: when it entered that state or last beat. */
  readonly stateAt: number | null;
  /** Done: when it ended and how long it took. */
  readonly endedAt: number | null;
  readonly totalSeconds: number | null;
  readonly now: string | null;
  /** The checked result line of a finished card. */
  readonly result: string | null;
  /** A work card's to-dos done and in all; null when it has none (a worker run has none). */
  readonly progress: { readonly done: number; readonly total: number } | null;
  /** The work record to-do the card's runs take on: retry goes there; null for a card with none. */
  readonly todo: string | null;
  /**
   * A stopped row's few words after 중단됨: why and who it waits on, from what the core serves. `known` is false when
   * the core does not say who (lina#629): the line is then grey. Null for any other state.
   */
  readonly stop?: { readonly words: string; readonly known: boolean } | null;
}

/** Where an answer to a decision goes: the record's item (comments with answer) or a work card's question. */
export type DecisionTarget = { readonly kind: "item"; readonly id: string } | { readonly kind: "card"; readonly id: string };

export type InboxRow =
  | { readonly type: "decide"; readonly key: string; readonly href: string; readonly agent: string | null; readonly context: string; readonly text: string; readonly ask: boolean; readonly at: number; readonly target: DecisionTarget }
  | { readonly type: "review"; readonly key: string; readonly href: string; readonly agent: string | null; readonly card: CardRow }
  | { readonly type: "mine"; readonly key: string; readonly id: string; readonly href: string; readonly agent: string | null; readonly title: string; readonly due: string | null; readonly done: boolean };

export interface Section<T> {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly T[];
  /** Rows that are not stopped (grey number). */
  readonly count: number;
  /** Stopped rows, shown as their own red number and never summed into `count`. */
  readonly stopped: number;
}

export interface DueRow {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  readonly agent: string | null;
  readonly due: string | null;
  readonly group: "overdue" | "today" | "week" | "later";
}

export interface GoalRow {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly agent: string | null;
  readonly state: WorkState;
  readonly reason: string | null;
  readonly stateSince: number | null;
  readonly doneCondition: string | null;
  readonly todosDone: number;
  readonly todosTotal: number;
  readonly runningTodos: readonly ItemSummary[];
  readonly runningCount: number;
  /** Every to-do of the goal is done, whoever owns it (the check box marks the whole goal). */
  readonly allDone: boolean;
}

export interface AgentView {
  readonly agent: Agent;
  /** The latest moment any of the agent's cards moved (latestActivity), the same everywhere it shows. */
  readonly latest: number | null;
  readonly running: Section<CardRow>;
  readonly review: Section<CardRow>;
  /** Cards just created and not started (예정), newest first; only here, never on the home. */
  readonly planned: Section<CardRow>;
  readonly goals: Section<GoalRow>;
  readonly doneToday: Section<CardRow>;
}

export interface Counts {
  readonly inbox: number;
  readonly running: number;
  readonly stopped: number;
  readonly due: number;
  readonly done: number;
  readonly goals: number;
  readonly notices: number;
  /** The core's unread count (counts.unread); counted from the notices' read marks when the core gives none. */
  readonly unread: number;
  readonly agents: Readonly<Record<string, { readonly running: number; readonly stopped: number }>>;
  readonly devices: { readonly all: number; readonly ok: number; readonly warn: number; readonly down: number };
}

/** The home (진행 중인 작업): what waits for the owner, then the stopped and running cards, then the rest by age. */
export interface Home {
  /** Open decisions, the same number as the inbox's 결정 필요; one line on the home, only when there are any. */
  readonly decisions: number;
  /** The stopped and running cards, stopped on top: the running number and the red stopped number, as the sidebar. */
  readonly active: Section<CardRow>;
  readonly waiting: Section<CardRow>;
  /** Finished in the last 24 hours, newest first. */
  readonly recent: Section<CardRow>;
  readonly older: Section<CardRow>;
}

/** How long a finished card counts as recent on the home. */
export const RECENT_SECONDS = 86_400;

export interface Model {
  readonly ready: boolean;
  readonly agents: readonly Agent[];
  readonly names: ReadonlyMap<string, string>;
  readonly inbox: { readonly sections: readonly Section<InboxRow>[]; readonly rows: readonly InboxRow[] };
  readonly running: { readonly sections: readonly Section<CardRow>[]; readonly rows: readonly CardRow[] };
  readonly due: { readonly sections: readonly Section<DueRow>[]; readonly rows: readonly DueRow[] };
  readonly done: readonly CardRow[];
  readonly home: Home;
  /** The writer of the checked lines stopped: the screens say the summaries stopped. */
  readonly summariesStopped: boolean;
  readonly goals: readonly GoalRow[];
  readonly cards: ReadonlyMap<string, CardRow>;
  /** Ids in `cards` that no list shows: ended work (a replaced run, a stopped card of a finished goal) kept for links. */
  readonly unlisted: ReadonlySet<string>;
  readonly runs: ReadonlyMap<string, RunCard>;
  readonly runOwner: ReadonlyMap<string, string>;
  readonly items: ReadonlyMap<string, ItemSummary>;
  readonly machines: readonly Machine[];
  /** The owner's own Macs (role person). They are not nodes and are not counted in `counts.devices`. */
  readonly person: readonly PersonDevice[];
  readonly devices: { readonly ok: readonly Machine[]; readonly warn: readonly Machine[]; readonly down: readonly Machine[] };
  readonly quota: readonly QuotaService[];
  /** Services OCX holds no account for (the view's `missing`), one line each under the quota rows. */
  readonly quotaMissing: readonly string[];
  /** Usage for every range read so far, in the screen's order: today, 7 days, 30 days. */
  readonly usage: readonly UsageRangeView[];
  /** OCX's own line: the models on and the links down; null until its route answered. */
  readonly ocx: OcxView | null;
  /** The hub's own checks, folded: only failing, stale and error rows stay open. */
  readonly checks: ChecksView;
  readonly notices: readonly Notice[];
  readonly errors: readonly string[];
  readonly counts: Counts;
  readonly today: string;
}

function isStopped(row: unknown): boolean {
  return typeof row === "object" && row !== null && (row as { state?: unknown }).state === "stopped" && "kind" in row;
}

function section<T>(id: string, title: string, rows: readonly T[]): Section<T> {
  const stopped = rows.filter(isStopped).length;
  return { id, title, rows, count: rows.length - stopped, stopped };
}

export function localDay(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function maxOf(values: (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length ? Math.max(...present) : null;
}

/**
 * The title a work card may draw: its checked title, or its own title until the checked one exists, but only while
 * that own title passes the raw-text rule the app already applies to comments (foldReason). Null means nothing may
 * be drawn, so the kind of work stands in.
 */
export function cardTitle(checked: string | null, own: string | null): string | null {
  if (checked !== null) return checked;
  return own !== null && foldReason(own) === null ? own : null;
}

/** The one naming rule: that title, else the kind of work (코드 작업, 문서 작업, 조사, 기기 작업). */
export function cardName(title: string | null, work: CardKind, ownTitle: string | null = null): string {
  return cardTitle(title, ownTitle) ?? KIND_TITLE[work];
}

function workCardRow(card: WorkCardSummary, detail: WorkCardDetail | undefined, receivedAt: number, runCards: ReadonlyMap<string, RunCard>): CardRow {
  const runs = detail?.runs ?? [];
  // The list row's own times first (lina#577); a core without them leaves them out, and the detail's runs stand in.
  const lastBeat = card.lastHeartbeatAt ?? maxOf(runs.map((run) => run.lastHeartbeatAt));
  const ended = card.endedAt ?? maxOf(runs.map((run) => run.endedAt));
  const base = receivedAt - card.elapsedSeconds;
  // A card with no checked title is named by its own title when that may be drawn; its kind is read from that same
  // text, so a card showing its own title is not guessed as code when it is a documents card.
  const title = cardTitle(card.plain.title, card.title);
  const work = cardKind(title ?? "", (detail?.workerRuns ?? []).map((worker) => runCards.get(worker.id)).filter((run): run is RunCard => run !== undefined));
  return {
    key: `card:${card.id}`,
    kind: "card",
    work,
    id: card.id,
    href: href({ name: "card", id: card.id }),
    title,
    name: cardName(card.plain.title, work, card.title),
    agent: card.agent,
    state: card.state,
    reason: card.reason,
    startedAt: card.state === "in_progress" ? base : null,
    stateAt: card.state === "stopped" ? (lastBeat ?? base) : card.state === "done" ? null : base,
    // With neither the row's end nor a read detail, a finished card's end is unknown, not "just now" (lina-app#100).
    endedAt: card.state === "done" ? (ended ?? (detail ? receivedAt : null)) : null,
    totalSeconds: card.state === "done" ? card.elapsedSeconds : null,
    now: card.plain.now,
    result: card.plain.result,
    progress: card.todoProgress.total > 0 ? { done: card.todoProgress.done, total: card.todoProgress.total } : null,
    todo: (detail?.workerRuns ?? []).map((worker) => runCards.get(worker.id)?.todo).find((todo): todo is string => Boolean(todo)) ?? null,
  };
}

export function runRow(run: RunCard): CardRow {
  const work = cardKind(run.plain.title ?? "", [run]);
  return {
    key: `run:${run.id}`,
    kind: "run",
    work,
    id: run.id,
    href: href({ name: "run", id: run.id }),
    title: run.plain.title,
    name: cardName(run.plain.title, work),
    agent: run.agent,
    state: run.state,
    reason: run.reason,
    startedAt: run.state === "in_progress" ? run.startedAt : null,
    stateAt: run.state === "in_progress" || run.state === "done" ? null : (run.endedAt ?? run.startedAt),
    endedAt: run.state === "done" ? run.endedAt : null,
    totalSeconds: run.state === "done" && run.endedAt !== null && run.startedAt !== null ? run.endedAt - run.startedAt : null,
    now: run.plain.now,
    result: run.plain.result,
    progress: null,
    todo: run.todo,
  };
}

const newestFirst = (pick: (row: CardRow) => number | null) => (a: CardRow, b: CardRow) => (pick(b) ?? 0) - (pick(a) ?? 0);

export function buildModel(input: ModelInput, now: number): Model {
  const { board, items, cards, inbox: workInbox } = input;
  const today = localDay(now);

  const agents: Agent[] = (items?.agents ?? []).map((person, index) => ({
    id: person.id,
    name: person.name,
    letter: Array.from(person.name)[0]?.toUpperCase() ?? "",
    index,
    href: href({ name: "agent", id: person.id }),
  }));
  const names = new Map<string, string>(agents.map((agent) => [agent.id, agent.name]));
  if (items?.owner) names.set(items.owner.id, items.owner.name);
  const itemMap = new Map<string, ItemSummary>((items?.items ?? []).map((item) => [item.id, item]));

  const runOwner = new Map<string, string>();
  for (const detail of Object.values(input.cardDetails)) {
    for (const run of detail.workerRuns) runOwner.set(run.id, detail.id);
  }
  const runs = new Map<string, RunCard>((board?.cards ?? []).map((run) => [run.id, run]));
  const receivedAt = input.cardsAt ?? now;

  // What a row's work is for: the work goal a card sits in, the record goal a run's to-do sits under (or the to-do is).
  const cardGoal = new Map<string, WorkGoal>();
  for (const goal of input.goals?.goals ?? []) for (const card of goal.workCards) cardGoal.set(card.id, goal);
  const runGoal = (run: RunCard): ItemSummary | undefined => {
    const item = run.todo ? itemMap.get(run.todo) : undefined;
    if (item?.kind === "goal") return item;
    const parent = item?.parent ? itemMap.get(item.parent) : undefined;
    return parent?.kind === "goal" ? parent : undefined;
  };
  const ownerName = items?.owner?.name ?? null;
  // A run that a later run of the same to-do replaced has ended for good: nobody needs to act on it.
  const replaced = (run: RunCard) =>
    run.todo !== null && (board?.cards ?? []).some((other) => other.id !== run.id && other.todo === run.todo && (other.startedAt ?? 0) > (run.startedAt ?? 0));
  const contextRow = (row: CardRow, parentTitle: string | null, isRun: boolean, waitingOn: string | null): CardRow => {
    // The kind of work is the icon only, never the title: else what the work is for, else one grey 제목 없음.
    const title = row.title ?? parentTitle;
    return { ...row, title, name: title ?? W.untitled, stop: row.state === "stopped" ? stopWords(row.reason, isRun, waitingOn) : null };
  };
  const stopWords = (reason: string | null, isRun: boolean, waitingOn: string | null): NonNullable<CardRow["stop"]> => {
    const agent = waitingOn?.startsWith("agent:") ? agents.find((each) => each.id === waitingOn.slice(6) || each.name === waitingOn.slice(6)) : undefined;
    if (agent) return { words: `${agent.name} ${W.waitReview}`, known: true };
    if (reason === "decision" || reason === "feedback") return { words: ownerName ? `${ownerName} ${W.needsCheck}` : W.needsCheck, known: true };
    if (reason === "review") return { words: W.waitReview, known: true };
    // A failed run still listed has no later run of its to-do: nobody tried it again.
    if (isRun && (reason === "failed" || reason === "rejected")) return { words: `${REASON_WORD.failed}${SEP}${W.notRetried}`, known: true };
    return { words: reasonWord(reason) ?? "", known: false };
  };
  const runListRow = (run: RunCard): CardRow => {
    const owner = runOwner.get(run.id);
    const ownerCard = owner ? (cards?.cards ?? []).find((card) => card.id === owner) : undefined;
    const goalTitle = goalName(runGoal(run)?.title);
    const cardTitleText = ownerCard ? cardTitle(ownerCard.plain.title, ownerCard.title) : null;
    const ownName = foldReason(run.title) === null ? run.title : null;
    return contextRow(runRow(run), goalTitle ?? cardTitleText ?? ownName, true, run.waitingOn ?? null);
  };

  // Only work with no parent is a row of its own: a worker run of a card or of a goal's to-do shows inside them.
  // A stopped run a later run replaced, and stopped work whose card or goal is done, need nobody and are not listed.
  const goalDone = (goal: { state: WorkState } | undefined) => goal?.state === "done";
  // A goal's title is an unchecked string: it names a row only when it passes the same raw-text rule as a card's own.
  const goalName = (title: string | null | undefined) => (title && foldReason(title) === null ? title : null);
  const isEnded = (card: { id: string; state: WorkState }, run: RunCard | null) =>
    run ? runOwner.has(run.id) || runGoal(run) !== undefined || (run.state === "stopped" && replaced(run)) : card.state === "stopped" && goalDone(cardGoal.get(card.id));
  const everyCard: { row: CardRow; listed: boolean }[] = [
    ...(cards?.cards ?? []).map((card) => ({
      row: contextRow(workCardRow(card, input.cardDetails[card.id], receivedAt, runs), goalName(cardGoal.get(card.id)?.title), false, null),
      listed: !isEnded(card, null),
    })),
    ...(board?.cards ?? []).filter((run) => !runOwner.has(run.id)).map((run) => ({ row: runListRow(run), listed: !isEnded(run, run) })),
  ];
  // The lookup keeps every card (a goal's page and a run page link to them); only the lists leave out ended work.
  const allCards: CardRow[] = everyCard.filter((each) => each.listed).map((each) => each.row);
  const unlisted = new Set(everyCard.filter((each) => !each.listed).map((each) => each.row.id));
  const cardMap = new Map(everyCard.map((each) => [each.row.id, each.row]));

  const stopped = allCards.filter((card) => card.state === "stopped").sort(newestFirst((card) => card.stateAt));
  const running = allCards.filter((card) => card.state === "in_progress").sort(newestFirst((card) => card.startedAt));
  const runningSections = [section("stopped", "", stopped), section("running", "", running)];
  const done = allCards.filter((card) => card.state === "done").sort(newestFirst((card) => card.endedAt));
  const waiting = allCards.filter((card) => card.state === "waiting").sort(newestFirst((card) => card.stateAt));
  const recent = done.filter((card) => card.endedAt !== null && now - card.endedAt < RECENT_SECONDS);

  // Inbox: decisions (oldest first), finished runs waiting on the owner, then the owner's own to-dos.
  const goalTitleOfCard = (cardId: string) => input.goals?.goals.find((goal) => goal.workCards.some((card) => card.id === cardId))?.title;
  // A card's question names the card by its name (checked title, its own title when that may be drawn, or a kind word).
  const questionContext = (cardId: string) => [goalTitleOfCard(cardId), cardMap.get(cardId)?.name].filter(Boolean).join(CRUMB);
  const contextOf = (target: string) => {
    const item = itemMap.get(target);
    if (!item) return "";
    const parent = item.parent ? itemMap.get(item.parent) : undefined;
    return parent && parent.kind === "goal" ? `${parent.title}${CRUMB}${item.title}` : item.title;
  };
  const hidden = input.pending?.hidden ?? new Set<string>();
  const decideRows: InboxRow[] = [
    ...(board?.inbox.decide ?? [])
      .filter((row) => !row.answered)
      .map((row): InboxRow => ({
        type: "decide",
        key: `decide:${row.target}`,
        href: itemMap.get(row.target)?.kind === "goal" ? href({ name: "goal", id: row.target }) : href({ name: "item", id: row.target }),
        agent: row.agent,
        context: contextOf(row.target) || row.title,
        text: row.text,
        ask: row.kind === "ask",
        at: row.at,
        target: { kind: "item", id: row.target },
      })),
    ...(workInbox?.questions ?? []).map((question): InboxRow => {
      return {
        type: "decide",
        key: `question:${question.cardId}:${question.commentId}`,
        href: href({ name: "card", id: question.cardId }),
        agent: question.agent,
        context: questionContext(question.cardId),
        text: question.body,
        ask: true,
        at: question.askedAt,
        target: { kind: "card", id: question.cardId },
      };
    }),
  ]
    .filter((row) => !hidden.has(row.key))
    .sort((a, b) => (a.type === "decide" && b.type === "decide" ? a.at - b.at : 0));
  // Finished work waiting for the owner's review: runs outside any card the core lists, and work cards whose run waits
  // for review (the board does not list a card's own runs), whoever owns them and whether or not they have a to-do.
  const reviewRows: InboxRow[] = [
    ...(board?.inbox.review ?? [])
      .map((id) => runs.get(id))
      .filter((run): run is RunCard => run !== undefined)
      .map((run): InboxRow => ({ type: "review", key: `review:${run.id}`, href: href({ name: "run", id: run.id }), agent: run.agent, card: runListRow(run) })),
    ...allCards
      .filter((card) => card.kind === "card" && card.state === "waiting" && card.reason === "review")
      .sort(newestFirst((card) => card.stateAt))
      .map((card): InboxRow => ({ type: "review", key: `review:${card.id}`, href: card.href, agent: card.agent, card })),
  ];
  // An owner to-do that an open decision targets by its id is that decision's: it shows once, as the decision. Only
  // an explicit id link counts, never similar text. The inbox, the sidebar and the bell read this same set.
  const decided = new Set((board?.inbox.decide ?? []).filter((row) => !row.answered).map((row) => row.target));
  const listed = new Set((board?.inbox.mine ?? []).map((row) => row.id));
  const mineSource = (board?.inbox.mine ?? []).filter((row) => !decided.has(row.id));
  for (const { row, index } of [...(input.pending?.held ?? [])].sort((a, b) => a.index - b.index)) if (!mineSource.some((each) => each.id === row.id)) mineSource.splice(Math.min(index, mineSource.length), 0, row);
  const mineRows: InboxRow[] = mineSource.map((row) => ({
    type: "mine",
    key: `mine:${row.id}`,
    id: row.id,
    href: href({ name: "item", id: row.id }),
    agent: row.agent,
    title: row.title,
    due: row.due,
    done: !listed.has(row.id),
  }));
  const inboxSections = [section("decide", W.decide, decideRows), section("review", W.review, reviewRows), section("mine", W.mine, mineRows)];

  const dueGroups = board?.due ?? { overdue: [], today: [], week: [], later: [] };
  const dueSection = (group: DueRow["group"], title: string) =>
    section(
      group,
      title,
      dueGroups[group].map((row) => ({
        key: `due:${row.id}`,
        href: row.kind === "goal" ? href({ name: "goal", id: row.id }) : href({ name: "item", id: row.id }),
        title: row.title,
        agent: row.agent,
        due: row.due,
        group,
      })),
    );
  const dueSections = [dueSection("overdue", W.dueOverdue), dueSection("today", W.dueToday), dueSection("week", W.dueWeek), dueSection("later", W.dueLater)];

  const goals: GoalRow[] = (items?.items ?? [])
    .filter((item) => item.kind === "goal")
    .map((goal) => {
      const runningTodos = (items?.items ?? []).filter((item) => item.kind === "todo" && item.parent === goal.id && item.state === "in_progress");
      return {
        id: goal.id,
        href: href({ name: "goal", id: goal.id }),
        title: goal.title,
        agent: goal.agent,
        state: goal.state,
        reason: goal.reason,
        stateSince: goal.stateSince,
        doneCondition: goal.doneCondition,
        todosDone: goal.todos?.done ?? 0,
        todosTotal: goal.todos?.total ?? 0,
        runningTodos,
        runningCount: runningTodos.length,
        allDone: (goal.todos?.total ?? 0) > 0 && goal.todos?.done === goal.todos?.total,
      };
    });

  const machines = input.devices?.machines ?? board?.machines ?? [];
  const person = input.devices?.person ?? [];
  const quota = input.quota?.quota ?? board?.quota ?? [];
  const quotaMissing = input.quota?.missing ?? [];
  const usage = usageViews(input.usage);
  const ocx = ocxView(input.modelsState);
  const checks = checksView(input.checks);
  const okMachines = machines.filter((machine) => machine.state === "ok");
  const warnMachines = machines.filter((machine) => machine.state === "warn");
  const downMachines = machines.filter((machine) => machine.state === "down");
  const allNotices = board?.notices ?? [];
  const notices = allNotices.filter((notice) => !(notice.kind === "todo" && decided.has(notice.target)));
  const hiddenUnread = allNotices.filter((notice) => !notices.includes(notice) && !notice.read).length;

  const errorSources = new Set<string>();
  for (const view of [board, items, input.devices, input.quota]) for (const error of view?.errors ?? []) errorSources.add(error.source);
  for (const route of input.failed) errorSources.add(route);
  const errors = [...errorSources].map((source) => SOURCE_WORD[source] ?? SOURCE_WORD.detail).filter((word, index, all) => all.indexOf(word) === index);

  const agentCounts: Record<string, { running: number; stopped: number }> = {};
  for (const agent of agents) {
    agentCounts[agent.id] = {
      running: running.filter((card) => card.agent === agent.id).length,
      stopped: stopped.filter((card) => card.agent === agent.id).length,
    };
  }

  const inboxRows = [...decideRows, ...reviewRows, ...mineRows];
  const dueRows = dueSections.flatMap((group) => group.rows);
  const runningRows = [...stopped, ...running];

  return {
    ready: Boolean(board && items),
    agents,
    names,
    inbox: { sections: inboxSections, rows: inboxRows },
    running: { sections: runningSections, rows: runningRows },
    due: { sections: dueSections, rows: dueRows },
    done,
    home: {
      decisions: inboxSections[0].count,
      active: section("active", W.agentRunning, runningRows),
      waiting: section("waiting", STATE_WORD.waiting, waiting),
      recent: section("recent", W.doneRecent, recent),
      older: section("older", W.doneOlder, done.filter((card) => !recent.includes(card))),
    },
    summariesStopped: board?.writer.state === "stopped",
    goals,
    cards: cardMap,
    unlisted,
    runs,
    runOwner,
    items: itemMap,
    machines,
    person,
    devices: { ok: okMachines, warn: warnMachines, down: downMachines },
    quota,
    quotaMissing,
    usage,
    ocx,
    checks,
    notices,
    errors,
    today,
    counts: {
      inbox: inboxRows.length,
      running: running.length,
      stopped: stopped.length,
      due: dueRows.length,
      done: done.length,
      goals: goals.length,
      notices: notices.length,
      unread: (board?.counts.unread ?? allNotices.filter((notice) => !notice.read).length) - hiddenUnread,
      agents: agentCounts,
      devices: { all: machines.length, ok: okMachines.length, warn: warnMachines.length, down: downMachines.length },
    },
  };
}

/** The latest moment one of these cards moved: started, changed state or ended. The one definition every view uses. */
export function latestActivity(cards: Iterable<CardRow>): number | null {
  return maxOf([...cards].flatMap((card) => [card.startedAt, card.stateAt, card.endedAt]));
}

/** 완료, for every agent or for one; the filter's counts and the list are this one list. */
export function doneFor(model: Model, agentId?: string): readonly CardRow[] {
  return agentId ? model.done.filter((card) => card.agent === agentId) : model.done;
}

export function agentView(model: Model, agentId: string): AgentView | null {
  const agent = model.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return null;
  const mine = [...model.cards.values()].filter((card) => card.agent === agentId && !model.unlisted.has(card.id));
  const stoppedCards = mine.filter((card) => card.state === "stopped").sort(newestFirst((card) => card.stateAt));
  const running = [...stoppedCards, ...mine.filter((card) => card.state === "in_progress").sort(newestFirst((card) => card.startedAt))];
  const review = mine.filter((card) => card.state === "waiting").sort(newestFirst((card) => card.stateAt));
  const planned = mine.filter((card) => card.state === "planned").sort(newestFirst((card) => card.stateAt));
  // An agent's goals: the ones it owns and the ones holding its to-dos, another agent's included; the dial, the count
  // and the running number all count only this agent's to-dos.
  const goals = model.goals
    .map((goal) => {
      const todos = [...model.items.values()].filter((item) => item.kind === "todo" && item.parent === goal.id && item.agent === agentId);
      const runningTodos = todos.filter((todo) => todo.state === "in_progress");
      return { goal, row: { ...goal, todosDone: todos.filter((todo) => todo.state === "done").length, todosTotal: todos.length, runningTodos, runningCount: runningTodos.length } };
    })
    .filter(({ goal, row }) => goal.agent === agentId || row.todosTotal > 0)
    .map(({ row }) => row);
  const doneToday = model.done.filter((card) => card.agent === agentId && card.endedAt !== null && localDay(card.endedAt) === model.today);
  return {
    agent,
    latest: latestActivity(mine),
    running: section("running", W.agentRunning, running),
    review: section("review", W.agentReview, review),
    planned: section("planned", STATE_WORD.planned, planned),
    goals: section("goals", W.agentGoals, goals),
    doneToday: section("done", W.done, doneToday),
  };
}

/** A goal's work cards (kanban goal cards excluded) and the evidence that closed it. */
export function goalCards(model: Model, detail: ItemDetail, goals: GoalList | undefined): { cards: Section<CardRow>; evidence: { key: string; text: string; at: number | null }[] } {
  const goalCardIds = new Set((goals?.goals ?? []).map((goal) => goal.id));
  const cards = detail.workCards.filter((id) => !goalCardIds.has(id)).map((id) => model.cards.get(id)).filter((card): card is CardRow => card !== undefined);
  const linked = new Set(detail.workCards);
  const evidence = (goals?.goals ?? [])
    .flatMap((goal) => goal.evidence)
    .filter((entry) => linked.has(entry.cardId) && entry.summary)
    .map((entry) => ({ key: entry.cardId, text: entry.summary ?? "", at: entry.completedAt }));
  return { cards: section("cards", W.cards, cards), evidence };
}

export function quotaHasData(view: QuotaView | undefined): boolean {
  return Boolean(view && view.quota.length);
}
