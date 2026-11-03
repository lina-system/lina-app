import type {
  BoardSnapshot,
  DevicesView,
  GoalList,
  ItemDetail,
  ItemList,
  ItemSummary,
  Machine,
  Notice,
  QuotaService,
  QuotaView,
  RunCard,
  WorkCardDetail,
  WorkCardList,
  WorkCardSummary,
  WorkInbox,
  WorkState,
} from "../api/client";
import { CRUMB, SOURCE_WORD, W } from "../words";
import { href } from "../router";

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
  readonly cardDetails: Readonly<Record<string, WorkCardDetail>>;
  readonly failed: readonly string[];
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly letter: string;
  readonly index: number;
  readonly href: string;
}

/** One 작업: a work card or a worker run started outside any card. */
export interface CardRow {
  readonly key: string;
  readonly kind: "card" | "run";
  readonly id: string;
  readonly href: string;
  readonly title: string;
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
}

export type InboxRow =
  | { readonly type: "decide"; readonly key: string; readonly href: string; readonly agent: string | null; readonly context: string; readonly text: string; readonly ask: boolean; readonly at: number }
  | { readonly type: "review"; readonly key: string; readonly href: string; readonly agent: string | null; readonly card: CardRow }
  | { readonly type: "mine"; readonly key: string; readonly href: string; readonly agent: string | null; readonly title: string; readonly due: string | null };

export interface Section<T> {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly T[];
  readonly count: number;
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
}

export interface AgentView {
  readonly agent: Agent;
  readonly running: Section<CardRow>;
  readonly review: Section<CardRow>;
  readonly goals: Section<GoalRow>;
  readonly doneToday: Section<CardRow>;
}

export interface Counts {
  readonly inbox: number;
  readonly running: number;
  readonly due: number;
  readonly done: number;
  readonly goals: number;
  readonly notices: number;
  readonly agents: Readonly<Record<string, number>>;
  readonly devices: { readonly all: number; readonly ok: number; readonly down: number };
}

export interface Model {
  readonly ready: boolean;
  readonly agents: readonly Agent[];
  readonly names: ReadonlyMap<string, string>;
  readonly inbox: { readonly sections: readonly Section<InboxRow>[]; readonly rows: readonly InboxRow[] };
  readonly running: { readonly sections: readonly Section<CardRow>[]; readonly rows: readonly CardRow[] };
  readonly due: { readonly sections: readonly Section<DueRow>[]; readonly rows: readonly DueRow[] };
  readonly done: readonly CardRow[];
  readonly goals: readonly GoalRow[];
  readonly cards: ReadonlyMap<string, CardRow>;
  readonly runs: ReadonlyMap<string, RunCard>;
  readonly runOwner: ReadonlyMap<string, string>;
  readonly items: ReadonlyMap<string, ItemSummary>;
  readonly machines: readonly Machine[];
  readonly devices: { readonly ok: readonly Machine[]; readonly down: readonly Machine[] };
  readonly quota: readonly QuotaService[];
  readonly notices: readonly Notice[];
  readonly errors: readonly string[];
  readonly counts: Counts;
  readonly today: string;
}

function section<T>(id: string, title: string, rows: readonly T[]): Section<T> {
  return { id, title, rows, count: rows.length };
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

function workCardRow(card: WorkCardSummary, detail: WorkCardDetail | undefined, receivedAt: number): CardRow {
  const runs = detail?.runs ?? [];
  const lastBeat = maxOf(runs.map((run) => run.lastHeartbeatAt));
  const ended = maxOf(runs.map((run) => run.endedAt));
  const base = receivedAt - card.elapsedSeconds;
  return {
    key: `card:${card.id}`,
    kind: "card",
    id: card.id,
    href: href({ name: "card", id: card.id }),
    title: card.title,
    agent: card.agent,
    state: card.state,
    reason: card.reason,
    startedAt: card.state === "in_progress" ? base : null,
    stateAt: card.state === "stopped" ? (lastBeat ?? base) : card.state === "done" ? null : base,
    endedAt: card.state === "done" ? (ended ?? receivedAt) : null,
    totalSeconds: card.state === "done" ? card.elapsedSeconds : null,
    now: card.now,
  };
}

export function runRow(run: RunCard): CardRow {
  return {
    key: `run:${run.id}`,
    kind: "run",
    id: run.id,
    href: href({ name: "run", id: run.id }),
    title: run.title,
    agent: run.agent,
    state: run.state,
    reason: run.reason,
    startedAt: run.state === "in_progress" ? run.startedAt : null,
    stateAt: run.state === "in_progress" || run.state === "done" ? null : (run.endedAt ?? run.startedAt),
    endedAt: run.state === "done" ? run.endedAt : null,
    totalSeconds: run.state === "done" && run.endedAt !== null && run.startedAt !== null ? run.endedAt - run.startedAt : null,
    now: run.now,
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
  const allCards: CardRow[] = [
    ...(cards?.cards ?? []).map((card) => workCardRow(card, input.cardDetails[card.id], receivedAt)),
    ...(board?.cards ?? []).filter((run) => !runOwner.has(run.id)).map(runRow),
  ];
  const cardMap = new Map(allCards.map((card) => [card.id, card]));

  const stopped = allCards.filter((card) => card.state === "stopped").sort(newestFirst((card) => card.stateAt));
  const running = allCards.filter((card) => card.state === "in_progress").sort(newestFirst((card) => card.startedAt));
  const runningSections = [section("stopped", "", stopped), section("running", "", running)];
  const done = allCards.filter((card) => card.state === "done").sort(newestFirst((card) => card.endedAt));

  // Inbox: decisions (oldest first), finished runs waiting on the owner, then the owner's own to-dos.
  const goalTitleOfCard = (cardId: string) => input.goals?.goals.find((goal) => goal.workCards.some((card) => card.id === cardId))?.title;
  const contextOf = (target: string) => {
    const item = itemMap.get(target);
    if (!item) return "";
    const parent = item.parent ? itemMap.get(item.parent) : undefined;
    return parent && parent.kind === "goal" ? `${parent.title}${CRUMB}${item.title}` : item.title;
  };
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
      })),
    ...(workInbox?.questions ?? []).map((question): InboxRow => {
      const goalTitle = goalTitleOfCard(question.cardId);
      return {
        type: "decide",
        key: `question:${question.cardId}:${question.commentId}`,
        href: href({ name: "card", id: question.cardId }),
        agent: question.agent,
        context: goalTitle ? `${goalTitle}${CRUMB}${question.title}` : question.title,
        text: question.body,
        ask: true,
        at: question.askedAt,
      };
    }),
  ].sort((a, b) => (a.type === "decide" && b.type === "decide" ? a.at - b.at : 0));
  const reviewRows: InboxRow[] = (board?.inbox.review ?? [])
    .map((id) => runs.get(id))
    .filter((run): run is RunCard => run !== undefined)
    .map((run) => ({ type: "review", key: `review:${run.id}`, href: href({ name: "run", id: run.id }), agent: run.agent, card: runRow(run) }));
  const mineRows: InboxRow[] = (board?.inbox.mine ?? []).map((row) => ({
    type: "mine",
    key: `mine:${row.id}`,
    href: href({ name: "item", id: row.id }),
    agent: row.agent,
    title: row.title,
    due: row.due,
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
      };
    });

  const machines = input.devices?.machines ?? board?.machines ?? [];
  const quota = input.quota?.quota ?? board?.quota ?? [];
  const okMachines = machines.filter((machine) => machine.state === "ok");
  const downMachines = machines.filter((machine) => machine.state === "down");
  const notices = board?.notices ?? [];

  const errorSources = new Set<string>();
  for (const view of [board, items, input.devices, input.quota]) for (const error of view?.errors ?? []) errorSources.add(error.source);
  for (const route of input.failed) errorSources.add(route);
  const errors = [...errorSources].map((source) => SOURCE_WORD[source] ?? SOURCE_WORD.detail).filter((word, index, all) => all.indexOf(word) === index);

  const agentCounts: Record<string, number> = {};
  for (const agent of agents) agentCounts[agent.id] = running.filter((card) => card.agent === agent.id).length;

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
    goals,
    cards: cardMap,
    runs,
    runOwner,
    items: itemMap,
    machines,
    devices: { ok: okMachines, down: downMachines },
    quota,
    notices,
    errors,
    today,
    counts: {
      inbox: inboxRows.length,
      running: runningRows.length,
      due: dueRows.length,
      done: done.length,
      goals: goals.length,
      notices: notices.length,
      agents: agentCounts,
      devices: { all: machines.length, ok: okMachines.length, down: downMachines.length },
    },
  };
}

export function agentView(model: Model, agentId: string): AgentView | null {
  const agent = model.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return null;
  const mine = [...model.cards.values()].filter((card) => card.agent === agentId);
  const running = mine.filter((card) => card.state === "in_progress").sort(newestFirst((card) => card.startedAt));
  const review = mine.filter((card) => card.state === "waiting" || card.state === "stopped").sort(newestFirst((card) => card.stateAt));
  const goals = model.goals.filter((goal) => goal.agent === agentId);
  const doneToday = model.done.filter((card) => card.agent === agentId && card.endedAt !== null && localDay(card.endedAt) === model.today);
  return {
    agent,
    running: section("running", W.agentRunning, running),
    review: section("review", W.agentReview, review),
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
