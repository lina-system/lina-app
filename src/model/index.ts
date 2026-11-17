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
  PowerView,
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
import { BANNED_WORDS, CRUMB, KIND_TITLE, ROUND9_WORD, SEP, SOURCE_WORD, STATE_WORD, STOP_WAIT, STOP_WORD, W, reasonWord, stateLabel } from "../words";
import { href } from "../router";
import { clockAt } from "../time";
import { checksView, type ChecksView } from "./checks";
import { foldReason, holdsRefsOnly, sentenceMayShow, unitMayShow, unitOf, withoutLatin, withoutRefs } from "./fold";
import { cardKind, type CardKind } from "./kind";
import { ocxView, usageViews, type OcxView, type UsageRangeView } from "./usage";

export interface ModelInput {
  readonly board?: BoardSnapshot;
  readonly items?: ItemList;
  readonly goals?: GoalList;
  readonly cards?: WorkCardList;
  /** When the cards list was received; `elapsedSeconds` counts from here. */
  readonly cardsAt?: number;
  /** Every finished card the core holds and whether `cards` holds them all (lina-app#186); absent: it holds them all. */
  readonly finished?: { readonly total: number; readonly all: boolean };
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

/**
 * A cards-list row as the core will serve it: `goalTitle` (lina#666) and a stopped row's short `ask` (lina#690) are
 * optional until every core sends them.
 */
export type CardSummary = WorkCardSummary & { readonly goalTitle?: string | null; readonly ask?: string | null; readonly waitUntil?: number | null };

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
  /** The people list says the agent has a picture (`avatar: true`, lina#738); its mark draws it over the letter. */
  readonly avatar: boolean;
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
  /**
   * The name in colour. The title order (lina-app#122): its goal's title (the card's own `goalTitle` first, lina-app#134); else a work card's checked title, or its own
   * title until that exists when it may be drawn (cardTitle), a run's checked title, then its own name; else its
   * to-do's title; else its card's title. A lone stopped run whose only name is in Latin reads 이름 없는 실행. Null when
   * none may be drawn: the card is still a row (lina-app#225), named by its kind of work, a finished one in 완료's line
   * of the cards nothing names.
   */
  readonly title: string | null;
  /** The card's own title, the one its page's head shows, before its goal's title is put first: null when none may be drawn. */
  readonly own: string | null;
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
   * the core does not say who (lina#629): the line is then grey. `owner` is true when the owner has to act: those rows
   * come first in the stopped group. `retry` is true when running it again can clear the stop (not when it waits on
   * an answer or a review, lina-app#134): only then does the row offer 다시 시도. Null for any other state.
   */
  readonly stop?: { readonly words: string; readonly known: boolean; readonly owner: boolean; readonly retry: boolean; readonly reason?: StopReasonText | null } | null;
  /**
   * A stopped card's ask from the core (lina#690) as its own line under the title. Null on every list row since
   * lina-app#156: the ask is said after the stop's words (`stop.words`), or names the row when nothing else does.
   */
  readonly ask?: string | null;
  /** The card's own name with its references cut (its title as workCardRow reads it), when that may be drawn: what tells rows of one goal apart. */
  readonly ownName?: string | null;
  /**
   * The row's second line in its group (lina-app#148, #152): the card's own name whenever it differs from the row's
   * title (its goal's); null when it has none that may be drawn. Never a time.
   */
  readonly sub?: string | null;
  /**
   * When the row last moved, as a clock time in its time slot instead of how long ago: set only when another row of its
   * group still reads the same lines (lina-app#152), so the second line is never a bare time.
   */
  readonly when?: string | null;
  /** The card lives on a board the core only reads (lina#481): no write control is drawn for it. */
  readonly readOnly?: boolean;
  /** A finished group's line standing for this many cards whose lines read the same (lina-app#168); absent for one. */
  readonly repeat?: number;
  /** The title the core names the card's goal by (its `goalTitle`, else its work goal's): what links it to a record goal of that title (goalFold). */
  readonly goalTitle?: string | null;
  /** The cards such a line stands for, newest first, the line's own card first (lina-app#171); absent for one. */
  readonly fold?: readonly CardRow[];
  /**
   * A stopped work card whose comments hold the owner's 다시 시도 since its last beat (lina-app#208): the request still
   * stands, on any page. Null while its detail, which holds the comments, is not read; absent on every other row.
   */
  readonly asked?: boolean | null;
}

/**
 * A stop reason longer than its row says (lina-app#171): the words before it (`결정 대기`) and all of it, for the detail,
 * where the row cuts it at a word. `folded` when the one gate does not pass it: the detail draws one folded line that
 * opens to it as written (lina-app#241). Absent when the row says the whole reason.
 */
export interface StopReasonText {
  readonly lead: string;
  readonly text: string;
  readonly folded: boolean;
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
  /** The listed work cards running for the goal (goalFold). */
  readonly runningCards: readonly CardRow[];
  readonly runningCount: number;
  /** Every to-do of the goal is done, whoever owns it (the check box marks the whole goal). */
  readonly allDone: boolean;
  /**
   * The one line a goal says when its record disagrees with itself (lina-app#237): closed with its own to-do count open,
   * or planned while every card linked to it is finished. The record's state and count stay as they are; null otherwise.
   */
  readonly why: string | null;
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
  /** Null while the page holds only the newest finished cards (lina-app#186): no count from a list not read. */
  readonly doneToday: Section<CardRow> | null;
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
  /** The inbox's 검토 필요 and 내 할 일, as their own groups on the home. */
  readonly review: Section<InboxRow>;
  readonly mine: Section<InboxRow>;
  /** The running cards (진행 중); with none, its head alone says 0 when anything is stopped or planned (lina-app#148). */
  readonly active: Section<CardRow>;
  /** Cards not started yet (예정), under the running ones, newest first (lina-app#148). */
  readonly planned: Section<CardRow>;
  /** The stopped cards, their own group under the running one (중단됨), the owner's first: the red number, as the sidebar. */
  readonly stopped: Section<CardRow>;
  /** Waiting cards the 검토 필요 group does not already hold. */
  readonly waiting: Section<CardRow>;
  /**
   * 완료 (lina-app#186): the finished lines the page read, the last 24 hours first, each part newest first. Its count is
   * cards (lina-app#225): the cards its lines stand for (cardCount) and the finished cards not read yet, the same
   * collapsed and opened. It is drawn, and the sidebar's `counts.done` is it, only once every finished card is read
   * (lina-app#242).
   */
  readonly finished: Section<CardRow>;
}

const HANGUL = /\p{Script=Hangul}/u;

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
  /** Finished cards the core holds that the page has not read (each may be a row: the fold counts them), and whether it read them all. */
  readonly finished: { readonly more: number; readonly all: boolean };
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
  /** The hub's power equipment; null when the core serves no power section. */
  readonly power: PowerView | null;
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
  /** The moment the model was built: a row's second line names its day and time from here. */
  readonly now: number;
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
 * The title a work card may draw: its checked title, or its own title when there is none or the one rule refuses the
 * checked one (sentenceMayShow, lina-app#222), with its card and goal ids, issue references and hashes cut, but only
 * while what is left passes that rule (cleanTitle). Null means nothing may be drawn, so the goal's title or the kind of
 * work stands in. A stopped card has no exception to the rule (lina-app#152); the last argument is kept for the callers
 * that pass it.
 */
export function cardTitle(checked: string | null, own: string | null, _stopped = false): string | null {
  if (checked !== null && sentenceMayShow(checked)) return checked;
  return own === null ? null : cleanTitle(own);
}

/**
 * A title with its ids, references and hashes cut (withoutRefs), when what is left passes the one rule every drawn
 * sentence passes (sentenceMayShow, lina-app#156, #222): one with no Hangul, a Latin word, a product name or a round
 * label in it is not. A worker run's page also lets a name in Latin alone through when it holds no raw text (`latin`); no
 * row does.
 */
function cleanTitle(title: string, latin = false): string | null {
  const cut = withoutRefs(title);
  return cut && (sentenceMayShow(cut) || (latin && mayDraw(cut, true))) ? cut : null;
}

/**
 * A title the row rule refuses, read by its Hangul words (lina-app#214): its refs and Latin words cut (withoutLatin),
 * read when at least four Hangul letters are left and what is left passes the one rule (sentenceMayShow, lina-app#222).
 * A record goal's or to-do's title reads so (foldTitle), so 제목 없음 holds only what nothing names. A finished card's
 * row never does (workTitle as written, lina-app#231); stopped, running and planned rows and an agent's ask keep the row
 * rule.
 */
function finishedTitle(title: string | null): string | null {
  const cut = title ? withoutLatin(withoutRefs(title)) : "";
  return (cut.match(/\p{Script=Hangul}/gu) ?? []).length >= 4 && sentenceMayShow(cut) ? cut : null;
}

/** A bracket and the space before it: removed from a title only when what it holds is refs alone (holdsRefsOnly). */
const BRACKET = /\s*[([]([^()[\]]*)[)\]]/g;

/** A text exactly as written, less only a bracket that holds nothing but refs, ids or hashes and the space before it. */
function asWritten(text: string): string {
  return text
    .replace(BRACKET, (bracket, inner: string) => (holdsRefsOnly(inner) ? "" : bracket))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A sentence exactly as written (lina-app#231, asWritten), null when anything else would have to be cut for it to pass
 * the one rule (sentenceMayShow): a Latin word, a ref or a hash outside a ref-only bracket, or the debris a cut would
 * leave. A goal's and a card's 끝 조건 read so.
 */
export function wholeTitle(title: string | null | undefined): string | null {
  const whole = title ? asWritten(title) : "";
  return whole && withoutRefs(whole) === whole && sentenceMayShow(whole) ? whole : null;
}

/** Three Latin words or more in a row: an English phrase, not a product or tool name in a Korean title. */
const LATIN_RUN = /(?<![\w.\-/])[A-Za-z][\w.\-/]*(?:[\s,:·]+[A-Za-z][\w.\-/]*){2,}/;

/**
 * The title a stopped, planned or running card's row draws (lina-app#156, #225): the core's title with only what is
 * internal cut (issue and pull request references, hashes, ids, code names and the bracket that held only them,
 * withoutRefs), product and tool names and short abbreviations kept. Null only when no Hangul is left, a run of three
 * Latin words or more is, or raw text such as a path or a command is (foldReason). Not the sentence rule: a title is no
 * sentence. A finished card's row reads the same rule `whole` (lina-app#231): as written (asWritten), never cut, so a
 * title with anything internal outside a ref-only bracket is null and counted in 완료's grey line, never drawn with a hole.
 */
export function workTitle(title: string | null | undefined, whole = false): string | null {
  const text = title ? (whole ? asWritten(title) : withoutRefs(title)) : "";
  return text && (!whole || withoutRefs(text) === text) && HANGUL.test(text) && !LATIN_RUN.test(text) && mayDraw(text, true) ? text : null;
}

/** A work card's own name on its row and its detail head alike: its checked title, else its own (workTitle, whole when finished). */
export function ownTitle(card: { readonly state: WorkState; readonly title: string; readonly plain: { readonly title: string | null } }): string | null {
  const whole = card.state === "done";
  return workTitle(card.plain.title, whole) ?? workTitle(card.title, whole);
}

/**
 * A record goal's or to-do's title as a row draws it (cleanTitle), else by its Hangul words (finishedTitle, lina-app#222),
 * for the panes that draw a title or a line of their own (the goals, a decision's context).
 */
export function foldTitle(title: string | null | undefined): string | null {
  return title ? (cleanTitle(title) ?? finishedTitle(title)) : null;
}

/**
 * A goal's or to-do's name as its 결정 필요 row and its detail head read it, in every state (lina-app#157, #170): its
 * goal's title, then its own, each by the row title rule (foldTitle), so a name with a Latin word in it reads as on its
 * 내 할 일 row. Empty when neither may be drawn.
 */
export function itemContext(items: ReadonlyMap<string, ItemSummary>, item: Pick<ItemSummary, "title" | "parent">): string {
  const parent = item.parent ? items.get(item.parent) : undefined;
  return [parent?.kind === "goal" ? parent.title : null, item.title].map(foldTitle).filter(Boolean).join(CRUMB);
}

/** A stopped card's ask as a row says it: the title rule, and no word the screens never use (lina-app#156). */
function askLine(text: string | null | undefined): string | null {
  const cut = text ? cleanTitle(text) : null;
  return cut && !BANNED_WORDS.some((word) => cut.includes(word)) ? cut : null;
}

/** The ask without a trailing repeat of the status word said before it (`확인 필요 · … 확인 필요`); null when nothing is left. */
function withoutRepeat(ask: string, words: string): string | null {
  const last = words.split(SEP).at(-1)?.trim();
  const left = last && ask.replace(/[.。!]+$/, "").endsWith(last) ? ask.replace(/[.。!]+$/, "").slice(0, -last.length).replace(/[\s·,:;-]+$/, "") : ask;
  return left || null;
}

function mayDraw(title: string, latin = false): boolean {
  const reason = foldReason(title);
  return reason === null || (latin && reason === "latin");
}

/**
 * A line from an agent the row draws under its title (a stopped card's ask, a card question's context): the raw-text
 * rule and the one rule every drawn sentence passes (sentenceMayShow, lina-app#222), and no word the screens never use
 * (lina-app#148). Null draws no line.
 */
export function plainLine(text: string | null | undefined): string | null {
  return text && mayDraw(text) && sentenceMayShow(text) && !BANNED_WORDS.some((word) => text.includes(word)) ? text : null;
}

/** How many letters of a stop reason a row says after its words, so its state line stays two lines at 390 (lina-app#171). */
export const ROW_REASON_MAX = 30;

/** A text cut at a word end to at most `max` letters with `…`, its line breaks read as spaces; whole when it fits. */
export function cutAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const letters = [...flat];
  if (letters.length <= max) return flat;
  const head = letters.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s.,:;·]+$/, "")}…`;
}

/** A text the core cut itself: it ends in a fold marker. */
const CUT_END = /(?:…|\.\.\.)\s*$/;

/** A text that is one identifier and nothing else (`initial_status`): a word of the core's, no reason a bot wrote. */
const IDENTIFIER = /^[\w.-]+$/;

/**
 * The whole reason the core keeps for a stop (the inbox's `blockReason`, lina-app#171), the typed field a bot wrote for
 * the owner, never cut (lina-app#241): its unit (unitOf) when the one gate passes it (unitMayShow), else all of it as
 * written and `folded`, one line that opens to it. Null when there is none or it is one of the core's identifiers.
 */
export function stopReasonText(text: string | null | undefined): { readonly text: string; readonly folded: boolean } | null {
  const whole = text?.trim();
  if (!whole || IDENTIFIER.test(whole)) return null;
  const unit = unitOf(whole);
  return unitMayShow(unit) ? { text: unit, folded: false } : { text: whole, folded: true };
}

/** The time a row last moved: its end, its start or its state's. */
const movedAt = (row: CardRow) => row.endedAt ?? row.startedAt ?? row.stateAt;

/**
 * One group's rows, each told apart from the others (lina-app#148, #152): line 1 is the goal's title (or the card's own
 * when it has no goal), line 2 the card's own name whenever it differs from line 1. Rows that still read the same say
 * when they last moved as a clock time in their time slot (`when`); line 2 is never a bare time, and the kind of work
 * is never a row's words (lina-app#122). A line 1 several rows share (a goal's title over its cards) tells none of them
 * apart (lina-app#242): such a row with a name of its own leads with it, the goal's title its line 2, unless `lead` is
 * off (완료, whose rows of one title are one line, collapsed). A line 1 the same screen draws in another group
 * (`elsewhere`: a goal's title over a stopped card and over its finished ones) is shared the same way, so a title is one
 * group's line 1 on the screen and no card leaves its group. A row never leads with an own name another open group
 * draws (`taken`); a finished line it meets gives way instead (buildModel).
 */
export function apart(rows: readonly CardRow[], now: number, lead = true, elsewhere: readonly string[] = [], taken: readonly string[] = []): CardRow[] {
  // Line 1 by the title order (the goal's title first), read from `title`, which apart never changes: so rows already
  // apart read the same when a list of some of them is told apart again (an agent's, a goal's).
  const first = (row: CardRow) => row.title ?? row.name;
  const shared = new Map<string, number>();
  for (const line of [...rows.map(first), ...elsewhere]) shared.set(line, (shared.get(line) ?? 0) + 1);
  const drawn = new Set(taken);
  const named = rows.map((row) => {
    const own = row.ownName && row.ownName !== first(row) ? row.ownName : null;
    return lead && own && !drawn.has(own) && (shared.get(first(row)) ?? 0) > 1 ? { ...row, name: own, sub: first(row), when: null } : { ...row, name: first(row), sub: own, when: null };
  });
  const key = (row: CardRow) => [row.name, row.sub ?? "", row.stop?.words ?? ""].join("\n");
  const seen = new Map<string, number>();
  for (const row of named) seen.set(key(row), (seen.get(key(row)) ?? 0) + 1);
  return named.map((row) => {
    const at = movedAt(row);
    return (seen.get(key(row)) ?? 0) > 1 && at !== null ? { ...row, when: clockAt(at, now) } : row;
  });
}

/**
 * A finished group's lines (lina-app#168): cards whose titles read the same (the hub's titles that differ only by a hash
 * or a number the screen cuts, and the cards a goal's title names first, lina-app#237) are one line, the newest of them,
 * which it opens, with how many it stands for (`repeat`); its second line is their own name only while they share it.
 * The cards nothing names are one such line too (lina-app#225), named for what it holds and how many, never by a kind
 * word (lina-app#231); that line opens its own address, in `scope`, the list it is drawn in (lina-app#244). The rows come
 * newest first; the group head counts the cards (cardCount).
 */
function collapsed(rows: readonly CardRow[], scope: { readonly agent?: string; readonly goal?: string } = {}): CardRow[] {
  const lines = new Map<string, CardRow>();
  for (const row of rows) {
    const key = row.title === null ? "" : row.name;
    const first = lines.get(key);
    lines.set(key, first ? { ...first, sub: first.sub === row.sub ? first.sub : null, repeat: (first.repeat ?? 1) + 1, fold: [...(first.fold ?? [first]), row] } : { ...row, when: null });
  }
  const unnamed = lines.get("");
  if (unnamed) lines.set("", { ...unnamed, name: W.untitledCount(unnamed.repeat ?? 1), sub: null, ...(unnamed.fold ? { href: href({ name: "group", id: unnamed.id, ...scope }) } : {}) });
  return [...lines.values()];
}

/**
 * Finished cards as the lines they are listed in (lina-app#168, #179, #186): the last 24 hours first, then the older
 * ones, collapsed as one list, so a line never shows twice. The work tab's 완료 group and the 완료 screen list these.
 */
function doneLines(done: readonly CardRow[], now: number, agent?: string): CardRow[] {
  const recent = done.filter((card) => card.endedAt !== null && now - card.endedAt < RECENT_SECONDS);
  return collapsed([...recent, ...done.filter((card) => !recent.includes(card))], agent ? { agent } : {});
}

/** The one naming rule: that title, else the kind of work (코드 작업, 문서 작업, 조사, 기기 작업). */
export function cardName(title: string | null, work: CardKind): string {
  return cardTitle(title, null) ?? KIND_TITLE[work];
}

function workCardRow(card: WorkCardSummary, detail: WorkCardDetail | undefined, receivedAt: number, cardRuns: readonly RunCard[]): CardRow {
  const runs = detail?.runs ?? [];
  // The list row's own times first (lina#577); a core without them leaves them out, and the detail's runs stand in.
  const lastBeat = card.lastHeartbeatAt ?? maxOf(runs.map((run) => run.lastHeartbeatAt));
  const ended = card.endedAt ?? maxOf(runs.map((run) => run.endedAt));
  const base = receivedAt - card.elapsedSeconds;
  // A card with no checked title is named by its own title when that may be drawn; its kind is read from that same
  // text, so a card showing its own title is not guessed as code when it is a documents card.
  // Every card reads its titles by the row title rule, a finished one as written (ownTitle, lina-app#231).
  const title = ownTitle(card);
  const work = cardKind(title ?? "", cardRuns);
  return {
    key: `card:${card.id}`,
    kind: "card",
    work,
    id: card.id,
    href: href({ name: "card", id: card.id }),
    title,
    own: title,
    ownName: title,
    name: title ?? KIND_TITLE[work],
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
    todo: cardRuns.map((run) => run.todo).find((todo): todo is string => Boolean(todo)) ?? null,
    readOnly: card.readOnly === true,
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
    own: run.plain.title,
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
/** The stopped group's order: rows that wait on the owner first, then the newest stop. */
const stoppedOrder = (a: CardRow, b: CardRow) => Number(Boolean(b.stop?.owner)) - Number(Boolean(a.stop?.owner)) || newestFirst((card) => card.stateAt)(a, b);

/**
 * Whether a card's comment is the owner's 다시 시도 (lina-app#208): the request's one trace in the core's record, read
 * by its row and by its detail, which never counts it as a decision (lina-app#211).
 */
export function isRetryRequest(comment: Pick<WorkCardDetail["comments"][number], "author" | "body">, ownerId: string | undefined): boolean {
  return (comment.author === "owner" || comment.author === ownerId) && comment.body === W.retryText;
}

export function buildModel(input: ModelInput, now: number): Model {
  const { board, items, cards, inbox: workInbox } = input;
  const today = localDay(now);

  const agents: Agent[] = (items?.agents ?? []).map((person, index) => ({
    id: person.id,
    name: person.name,
    letter: Array.from(person.name)[0]?.toUpperCase() ?? "",
    // Optional in the core's contract and not in the copied schema until lina#738 lands: read only when present.
    avatar: "avatar" in person && person.avatar === true,
    index,
    href: href({ name: "agent", id: person.id }),
  }));
  const names = new Map<string, string>(agents.map((agent) => [agent.id, agent.name]));
  if (items?.owner) names.set(items.owner.id, items.owner.name);
  const itemMap = new Map<string, ItemSummary>((items?.items ?? []).map((item) => [item.id, item]));

  // A run belongs to the card that started it: the board says so on the run (`card`, the id the cards list serves,
  // whether or not the list holds that card), and an opened card's detail lists its worker runs.
  const runOwner = new Map<string, string>();
  for (const run of board?.cards ?? []) if (run.card) runOwner.set(run.id, run.card);
  for (const detail of Object.values(input.cardDetails)) {
    for (const run of detail.workerRuns) runOwner.set(run.id, detail.id);
  }
  const runs = new Map<string, RunCard>((board?.cards ?? []).map((run) => [run.id, run]));
  // A card's runs: the ones its opened detail lists, then the ones the board says it started.
  const runsOf = (cardId: string): RunCard[] =>
    [...new Set([...(input.cardDetails[cardId]?.workerRuns ?? []).map((worker) => worker.id), ...(board?.cards ?? []).filter((run) => runOwner.get(run.id) === cardId).map((run) => run.id)])]
      .map((id) => runs.get(id))
      .filter((run): run is RunCard => run !== undefined);
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
  // An unchecked title (a row's own, its to-do's, its goal's) names a row with its ids cut, only when what is left
  // passes the raw-text rule (lina-app#152).
  const plainName = (title: string | null | undefined, latin = false) => (title ? cleanTitle(title, latin) : null);
  // A name only the Latin-word exception lets a lone stopped run draw, with no Korean in it: an internal name.
  const internal = (title: string | null | undefined) => Boolean(title) && plainName(title) === null && plainName(title, true) !== null && !HANGUL.test(title ?? "");
  // What the core says about a stop (lina#629); absent and null both mean it does not say. `waitUntil` (epoch seconds)
  // is when a time wait ends, read only when the core sends it (lina-app#160).
  type StopFacts = { readonly waitingOn?: string | null; readonly retry?: string | null; readonly waitUntil?: number | null };
  const contextRow = (row: CardRow, goal: string | null, fallback: string | null, isRun: boolean, facts: StopFacts): CardRow => {
    // The goal names the row first (lina-app#122); the kind of work is the icon only, never the title. With no title
    // at all the row is not drawn (lina-app#124); its own page still says 제목 없음.
    const title = goal ?? row.title ?? fallback;
    return { ...row, title, name: title ?? W.untitled, stop: row.state === "stopped" ? stopWords(row.reason, isRun, facts) : null };
  };
  const stopWords = (reason: string | null, isRun: boolean, { waitingOn, retry, waitUntil }: StopFacts): NonNullable<CardRow["stop"]> => {
    // Why it waits, never on whom: no person's name in the state line (lina-app#156). The reason decides the word first,
    // whoever has to act (lina-app#160): a gate, a budget or a run the core gave up on is not a bare 확인 필요.
    const scheduled = retry === "scheduled";
    const timed = reason === "hold" && scheduled ? (typeof waitUntil === "number" ? STOP_WORD.timeWaitUntil(clockAt(waitUntil, now)) : STOP_WORD.timeWait) : null;
    const why = timed ?? (reason && Object.hasOwn(STOP_WORD.why, reason) ? STOP_WORD.why[reason] : null);
    // A stop that waits on an answer, a review or another to-do does not clear by running again, nor does one the core
    // already runs again by itself: no 다시 시도.
    const again = !scheduled && reason !== "blocked_by_item";
    const answer = { words: (reason && STOP_WAIT[reason]) || W.needsCheck, known: true, owner: true, retry: false };
    if (waitingOn === "owner") return why ? { words: why, known: true, owner: true, retry: again } : answer;
    // An agent that starts another run by itself is no reviewer: the retry words below say so.
    if (waitingOn?.startsWith("agent:") && !scheduled) {
      const agent = agents.find((each) => each.id === waitingOn.slice(6) || each.name === waitingOn.slice(6));
      return { words: agent ? `${agent.name} ${W.waitReview}` : W.waitReview, known: true, owner: false, retry: false };
    }
    if (reason === "decision" || reason === "feedback") return answer;
    if (reason === "review") return { words: W.waitReview, known: true, owner: false, retry: false };
    const word = why ?? reasonWord(reason);
    // A wait that wakes by itself (a time, another to-do) already says it goes on; any other says it will be tried again.
    if (scheduled) return { words: [word, reason === "hold" || reason === "blocked_by_item" ? null : W.retryScheduled].filter(Boolean).join(SEP), known: true, owner: false, retry: false };
    // A failed run still listed has no later run of its to-do: nobody tried it again.
    if (retry === "none" || (isRun && (reason === "failed" || reason === "rejected"))) return { words: [word, W.notRetried].filter(Boolean).join(SEP), known: true, owner: false, retry: again };
    return { words: word ?? STOP_WORD.none, known: false, owner: false, retry: again };
  };
  // A stopped row's words with its reason (lina-app#171): cut at a word on the row, and in the detail the inbox's whole
  // reason whenever it keeps one the row does not say whole (lina-app#241), folded when the one gate does not pass it; a
  // stop that waits on the owner's decision or feedback with no reason at all says so instead of leaving a gap.
  const stopWithReason = (stop: NonNullable<CardRow["stop"]>, reasonKey: string | null, reason: string | null, whole: ReturnType<typeof stopReasonText>): NonNullable<CardRow["stop"]> => {
    if (reason === null && whole === null) return reasonKey && STOP_WAIT[reasonKey] ? { ...stop, words: [stop.words, ROUND9_WORD.noReasonRecord].join(SEP) } : stop;
    const short = reason === null ? null : cutAtWord(reason.replace(CUT_END, ""), ROW_REASON_MAX);
    const words = [stop.words, short].filter(Boolean).join(SEP);
    const detail = whole && whole.text !== short ? whole : reason !== null && short !== reason ? { text: reason, folded: false } : null;
    return detail ? { ...stop, words, reason: { lead: stop.words, ...detail } } : { ...stop, words };
  };
  // The owner's 다시 시도 on a card is a comment on it (the core keeps no other trace): one newer than the stop still stands.
  const retryAsked = (detail: WorkCardDetail | undefined, stoppedAt: number | null): boolean | null =>
    detail ? detail.comments.some((comment) => isRetryRequest(comment, items?.owner?.id) && (stoppedAt === null || comment.createdAt > stoppedAt)) : null;
  // The title of a to-do in the work record (never a goal: a goal names a row last), when it may be drawn.
  const todoName = (ids: readonly (string | null)[], read: (title: string) => string | null = plainName) =>
    ids.map((id) => (id ? itemMap.get(id) : undefined)).map((item) => (item && item.kind !== "goal" ? read(item.title) : null)).find(Boolean) ?? null;
  const runListRow = (run: RunCard): CardRow => {
    const owner = runOwner.get(run.id);
    const ownerCard = owner ? (cards?.cards ?? []).find((card) => card.id === owner) : undefined;
    const cardTitleText = ownerCard ? cardTitle(ownerCard.plain.title, ownerCard.title) : null;
    // Its goal's title, then its checked title, its own name, its to-do's title and its card's title. A stopped run with
    // no card or goal is no row (lina-app#141); on its own page a Latin word alone does not hide its own or its to-do's
    // title, but a name in Latin alone is an internal one (lina-app#134): it is never drawn, and the page reads 이름 없는 실행.
    const lone = run.state === "stopped" && !owner && runGoal(run) === undefined;
    const todo = run.todo ? itemMap.get(run.todo) : undefined;
    const todoTitle = todo && todo.kind !== "goal" ? todo.title : null;
    const named = (title: string | null | undefined) => (internal(title) ? null : plainName(title, lone));
    const unnamed = lone && (internal(run.title) || internal(todoTitle)) ? W.unnamedRun : null;
    return contextRow(runRow(run), plainName(runGoal(run)?.title), named(run.title) ?? named(todoTitle) ?? cardTitleText ?? unnamed, true, run);
  };

  // Only work cards are rows (lina-app#141): a worker run shows inside its card, goal or to-do, and a run with none of
  // them is not listed at all. Stopped work whose goal is done needs nobody and is not listed.
  const isEnded = (card: { id: string; state: WorkState }) => card.state === "stopped" && cardGoal.get(card.id)?.state === "done";
  const everyCard: { row: CardRow; listed: boolean }[] = [
    ...(cards?.cards ?? []).map((card) => {
      const cardRuns = runsOf(card.id);
      // Its goal's title (the one the core puts on the row first), then its own names (workCardRow), then the to-do
      // its runs take on; a finished card's each as written (lina-app#231).
      const goalName = (title: string | null | undefined) => workTitle(title, card.state === "done");
      const fallback = todoName(
        cardRuns.map((run) => run.todo),
        card.state === "done" ? goalName : plainName,
      );
      const goal = goalName((card as CardSummary).goalTitle) ?? goalName(cardGoal.get(card.id)?.title);
      const row = { ...contextRow(workCardRow(card, input.cardDetails[card.id], receivedAt, cardRuns), goal, fallback, false, card), goalTitle: (card as CardSummary).goalTitle ?? cardGoal.get(card.id)?.title ?? null };
      // Every card is a row (lina-app#225). One nothing else names is named by its ask (a stopped card's, lina-app#156),
      // then, unless it is finished, by the Hangul words of its own title (lina-app#214); the ask is said after the stop's
      // words, unless it already names the row. With none, it reads its kind of work, and a finished one, which no cut
      // ever names (lina-app#231), is counted in 완료's one line of the cards nothing names (collapsed), never 제목 없음.
      const ask = card.state === "stopped" ? askLine((card as CardSummary).ask) : null;
      const title = row.title ?? ask ?? (card.state === "done" ? null : finishedTitle(card.title));
      // An ask that ends in the status word before it says that word once (lina-app#160).
      const said = ask !== null && ask !== title ? withoutRepeat(ask, row.stop?.words ?? "") : null;
      // The whole reason the inbox keeps (lina-app#171): the core cuts its ask at a length, so a cut ask reads from it.
      const whole = card.state === "stopped" ? stopReasonText(workInbox?.blocked.find((entry) => entry.cardId === card.id)?.blockReason) : null;
      const drawn = whole && !whole.folded ? whole.text : null;
      const reason = said !== null && CUT_END.test(said) ? (drawn ?? said) : (said ?? drawn);
      // An ask that names the row is its reason already; the detail still shows the inbox's whole reason under it.
      const stop = row.stop ? (ask !== null && ask === title ? (whole ? { ...row.stop, reason: { lead: row.stop.words, ...whole } } : row.stop) : stopWithReason(row.stop, row.reason, reason, whole)) : row.stop;
      return { row: { ...row, title, name: title ?? (card.state === "done" ? W.cards : KIND_TITLE[row.work]), stop, ask: null, ...(card.state === "stopped" ? { asked: retryAsked(input.cardDetails[card.id], row.stateAt) } : {}) }, listed: !isEnded(card) };
    }),
    ...(board?.cards ?? []).map((run) => ({ row: runListRow(run), listed: false })),
  ];
  // The lookup keeps every card and run (a goal's page and a run page link to them); the lists leave out ended work
  // and worker runs (lina-app#141), and drop no card for its title (lina-app#225).
  const allCards: CardRow[] = everyCard.filter((each) => each.listed).map((each) => each.row);
  // One state per id (lina-app#152): a worker run the hub serves under its card's own id never stands in for the card,
  // so the row, its detail head and its goal all read the card's kanban status.
  const cardMap = new Map<string, CardRow>();
  for (const { row } of everyCard) if (!cardMap.has(row.id)) cardMap.set(row.id, row);
  const unlisted = new Set(everyCard.filter((each) => !allCards.includes(each.row) && cardMap.get(each.row.id) === each.row).map((each) => each.row.id));

  // Each group's rows are told apart within it (apart); a part of a group (recent, older) keeps its rows apart too. An
  // open group's rows are told apart from the work tab's other groups too, 완료's lines among them, so no title is two
  // groups' line 1; a finished card whose line 1 an open row still draws then leads with its own name, the title its
  // line 2, or with none is counted in the grey line. Every card stays in its group, which its head and the sidebar count.
  // The open groups are told apart in one pass: a title any other group draws is shared, and a row leads with its own
  // name only when no other open group draws it, by the names the groups before it draw in the end and the titles of
  // those after it, so promoting a name never makes a line 1 two groups share.
  const finishedRows = apart(allCards.filter((card) => card.state === "done").sort(newestFirst((card) => card.endedAt)), now, false);
  const open = [
    allCards.filter((card) => card.state === "stopped").sort(stoppedOrder),
    allCards.filter((card) => card.state === "in_progress").sort(newestFirst((card) => card.startedAt)),
    allCards.filter((card) => card.state === "planned").sort(newestFirst((card) => card.stateAt)),
    allCards.filter((card) => card.state === "waiting").sort(newestFirst((card) => card.stateAt)),
  ];
  const finishedLines = doneLines(finishedRows, now)
    .filter((line) => line.title !== null)
    .map((line) => line.name);
  const resolved: CardRow[][] = [];
  for (const [index, rows] of open.entries()) {
    const titles = (groups: readonly CardRow[][]) => groups.flatMap((other) => other.map((card) => card.title ?? card.name));
    const taken = [...resolved.flat().map((row) => row.name), ...titles(open.slice(index + 1))];
    resolved.push(apart(rows, now, true, [...finishedLines, ...titles(open.filter((other) => other !== rows))], taken));
  }
  const [stopped, running, planned, waiting] = resolved;
  const openLines = new Set([stopped, running, planned, waiting].flat().map((row) => row.name));
  const done = finishedRows.map((row) => {
    if (row.title === null || !openLines.has(row.name)) return row;
    return row.ownName && row.ownName !== row.name && !openLines.has(row.ownName) ? { ...row, name: row.ownName, sub: row.name } : { ...row, title: null };
  });
  const finished = doneLines(done, now);
  const runningSections = [section("stopped", "", stopped), section("running", "", running)];
  // One unit for 완료 (lina-app#225): cards, the ones read and the ones the core holds (lina#729) that the page has not
  // read, so opening the fold never changes the number.
  const readDone = (cards?.cards ?? []).filter((card) => card.state === "done").length;
  const unreadDone = Math.max(0, (input.finished?.total ?? readDone) - readDone);
  const finishedCount = done.length + unreadDone;

  // Inbox: decisions (oldest first), finished runs waiting on the owner, then the owner's own to-dos.
  const goalTitleOfCard = (cardId: string) => input.goals?.goals.find((goal) => goal.workCards.some((card) => card.id === cardId))?.title;
  // A card's question names its goal, then the card by its own name (checked title, or its own title when that may be
  // drawn), not by the goal-first row title; the same words twice show once.
  const ownCardName = (cardId: string) => {
    const card = cards?.cards.find((each) => each.id === cardId);
    return (card ? cardTitle(card.plain.title, card.title) : null) ?? cardMap.get(cardId)?.name;
  };
  const questionContext = (cardId: string) =>
    [goalTitleOfCard(cardId), ownCardName(cardId)]
      .map(plainLine)
      .filter((part, index, all) => part && all.indexOf(part) === index)
      .join(CRUMB);
  const contextOf = (target: string) => {
    const item = itemMap.get(target);
    return item ? itemContext(itemMap, item) : "";
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
        context: itemMap.has(row.target) ? contextOf(row.target) : (plainLine(row.title) ?? ""),
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
  // Finished work waiting for the owner's review: work cards whose run waits for review, whoever owns them and whether
  // or not they have a to-do. A worker run the core lists for review is not a row (lina-app#141): it shows in its to-do.
  const reviewRows: InboxRow[] = waiting
    .filter((card) => card.reason === "review")
    .map((card): InboxRow => ({ type: "review", key: `review:${card.id}`, href: card.href, agent: card.agent, card }));
  // An owner to-do that an open decision targets by its id is that decision's: it shows once, as the decision. Only
  // an explicit id link counts, never similar text. The inbox, the sidebar and the bell read this same set.
  const decided = new Set((board?.inbox.decide ?? []).filter((row) => !row.answered).map((row) => row.target));
  const listed = new Set((board?.inbox.mine ?? []).map((row) => row.id));
  const mineSource = (board?.inbox.mine ?? []).filter((row) => !decided.has(row.id));
  for (const { row, index } of [...(input.pending?.held ?? [])].sort((a, b) => a.index - b.index)) if (!mineSource.some((each) => each.id === row.id)) mineSource.splice(Math.min(index, mineSource.length), 0, row);
  // The owner's to-dos by when they are due (lina-app#198): dated ones first, the earliest date first (overdue, then
  // today, then later), then the undated; of the same date, or both undated, the newest record first. The core lists
  // its waiting ones last, a to-do due today among them; a row held for its toast keeps its place by the same rule.
  const createdAt = (id: string) => itemMap.get(id)?.createdAt ?? 0;
  mineSource.sort((a, b) => (a.due === b.due ? createdAt(b.id) - createdAt(a.id) : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1));
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

  const parts = { cards: cardMap, unlisted, runs, runOwner, items: itemMap };
  const goals: GoalRow[] = (items?.items ?? [])
    .filter((item) => item.kind === "goal")
    .map((goal) => {
      const runningTodos = (items?.items ?? []).filter((item) => item.kind === "todo" && item.parent === goal.id && todoState(parts, item).state === "in_progress");
      const todos = goalTodos(goal);
      // The goal list reads the work tab's fold of its cards, as its page head does (lina-app#168).
      const fold = goalFold(parts, goal, []);
      const why =
        fold.state === "done" && todos.total > todos.done
          ? W.todosLeft(todos.total - todos.done)
          : fold.state === "planned" && fold.cards.length > 0 && fold.cards.every((card) => card.state === "done")
            ? W.workDone(fold.cards.length)
            : null;
      return {
        id: goal.id,
        href: href({ name: "goal", id: goal.id }),
        title: goal.title,
        agent: goal.agent,
        state: fold.state,
        reason: fold.reason,
        stateSince: fold.stateSince,
        doneCondition: goal.doneCondition,
        todosDone: todos.done,
        todosTotal: todos.total,
        runningTodos,
        runningCards: fold.running,
        runningCount: Math.max(runningTodos.length, fold.running.length),
        allDone: todos.total > 0 && todos.done === todos.total,
        why,
      };
    });

  const machines = input.devices?.machines ?? board?.machines ?? [];
  const person = input.devices?.person ?? [];
  const power = input.devices?.power ?? null;
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
    finished: { more: unreadDone, all: input.finished?.all ?? true },
    home: {
      decisions: inboxSections[0].count,
      review: inboxSections[1],
      mine: inboxSections[2],
      active: section("active", W.agentRunning, running),
      planned: section("planned", STATE_WORD.planned, planned),
      stopped: section("stopped", STATE_WORD.stopped, stopped),
      waiting: section("waiting", STATE_WORD.waiting, waiting.filter((card) => !reviewRows.some((row) => row.type === "review" && row.card.id === card.id))),
      finished: { ...section("finished", W.done, finished), count: finishedCount },
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
    power,
    devices: { ok: okMachines, warn: warnMachines, down: downMachines },
    quota,
    quotaMissing,
    usage,
    ocx,
    checks,
    notices,
    errors,
    today,
    now,
    counts: {
      inbox: inboxRows.length,
      running: running.length,
      stopped: stopped.length,
      due: dueRows.length,
      // No number while only the first page is read (lina-app#242): the core counts its total apart from the cards its
      // full read sends, so it is no sum of lines.
      done: (input.finished?.all ?? true) ? finishedCount : 0,
      goals: goals.length,
      notices: notices.length,
      unread: (board?.counts.unread ?? allNotices.filter((notice) => !notice.read).length) - hiddenUnread,
      agents: agentCounts,
      devices: { all: machines.length, ok: okMachines.length, warn: warnMachines.length, down: downMachines.length },
    },
  };
}

/**
 * A goal's to-dos, done and all: the core's count of the to-dos its page lists, every agent's and the ones closed long
 * ago that the item list no longer serves. The one count its rows, the 대화 card's band and every goal list read
 * (lina-app#175).
 */
export function goalTodos(goal: Pick<ItemSummary, "todos">): { readonly done: number; readonly total: number } {
  return { done: goal.todos?.done ?? 0, total: goal.todos?.total ?? 0 };
}

/** The latest moment one of these cards moved: started, changed state or ended. The one definition every view uses. */
export function latestActivity(cards: Iterable<CardRow>): number | null {
  return maxOf([...cards].flatMap((card) => [card.startedAt, card.stateAt, card.endedAt]));
}

/** 완료, for every agent or for one: its lines (doneLines); the filter's counts and the list are this one list. */
export function doneFor(model: Model, agentId?: string): readonly CardRow[] {
  return doneLines(agentId ? model.done.filter((card) => card.agent === agentId) : model.done, model.now, agentId);
}

/** The cards some lines stand for, a `×n` line counting n (lina-app#225): what every 완료 number counts. */
export function cardCount(lines: readonly CardRow[]): number {
  return lines.reduce((sum, line) => sum + (line.repeat ?? 1), 0);
}

/** A goal's or to-do's state line (lina-app#179): its fold, or while a decision on it is open, that wait since it was asked. */
export interface ItemLine {
  readonly state: WorkState;
  readonly reason: string | null;
  readonly since: number | null;
  /** `since` is when the open decision was asked, not when the state moved. */
  readonly asked: boolean;
  /** Open (not done) and due before today, in any state (lina-app#221, #225): it reads 지남 (itemWords). */
  readonly overdue: boolean;
}

/**
 * The one state line of a goal or to-do (lina-app#179), in 수신함's row, its head and its goal's 할 일 alike: its fold
 * (todoState, goalState), and while a decision on it is open, the time since the question was asked (the time its 수신함 row
 * reads, its record's question when no row lists it yet), with the decision's wait as its reason when the record gives
 * none (the item list serves the to-do a decision waits on with no reason). An open one due before today is overdue,
 * waiting or not (lina-app#225).
 */
export function itemLine(model: Pick<Model, "inbox" | "today">, id: string, fold: { readonly state: WorkState; readonly reason: string | null; readonly stateSince: number | null }, decision?: ItemDetail["decision"], due: string | null = null): ItemLine {
  const row = model.inbox.rows.find((each) => each.type === "decide" && each.target.kind === "item" && each.target.id === id);
  const asked = row?.type === "decide" ? row.at : decision && !decision.answered ? decision.at : null;
  const overdue = fold.state !== "done" && due !== null && due < model.today;
  if (asked) return { state: fold.state, reason: fold.reason ?? "decision", since: asked, asked: true, overdue };
  return { state: fold.state, reason: fold.reason, since: fold.stateSince, asked: false, overdue };
}

/**
 * The words of a goal's or to-do's state line: its state label, and 지남 after it when it is overdue; a planned one reads
 * 지남 alone, never 예정 (lina-app#221), any other keeps its word (`피드백 대기 · 지남`, lina-app#225).
 */
export function itemWords(line: ItemLine): string {
  if (!line.overdue) return stateLabel(line.state, line.reason);
  return line.state === "planned" ? W.dueOverdue : [stateLabel(line.state, line.reason), W.dueOverdue].join(SEP);
}

/** A goal's or to-do's state line by its id, from the lists (its row's fold): what 수신함's decision row says; null when unlisted. */
export function itemLineOf(model: Model, id: string): ItemLine | null {
  const due = model.items.get(id)?.due ?? null;
  const goal = model.goals.find((each) => each.id === id);
  if (goal) return itemLine(model, id, goal, undefined, due);
  const item = model.items.get(id);
  return item ? itemLine(model, id, todoState(model, item), undefined, due) : null;
}

export function agentView(model: Model, agentId: string): AgentView | null {
  const agent = model.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return null;
  const mine = [...model.cards.values()].filter((card) => card.agent === agentId && !model.unlisted.has(card.id));
  // The rows 진행 중인 작업 lists and the sidebar counts for this agent (lina-app#179).
  const running = model.running.rows.filter((card) => card.agent === agentId);
  const review = mine.filter((card) => card.state === "waiting").sort(newestFirst((card) => card.stateAt));
  const planned = mine.filter((card) => card.state === "planned").sort(newestFirst((card) => card.stateAt));
  // An agent's goals: the ones it owns and the ones holding its to-dos, another agent's included. The dial and its
  // number are the goal's own (goalTodos), the to-dos its page lists (lina-app#175); the running number counts only
  // this agent's.
  const goals = model.goals
    .map((goal) => {
      const todos = [...model.items.values()].filter((item) => item.kind === "todo" && item.parent === goal.id && item.agent === agentId);
      const runningTodos = todos.filter((todo) => todoState(model, todo).state === "in_progress");
      const runningCards = goal.runningCards.filter((card) => card.agent === agentId);
      return { goal, holds: todos.length > 0, row: { ...goal, runningTodos, runningCards, runningCount: Math.max(runningTodos.length, runningCards.length) } };
    })
    .filter(({ goal, holds }) => goal.agent === agentId || holds)
    .map(({ row }) => row);
  const doneToday = model.finished.all ? model.done.filter((card) => card.agent === agentId && card.endedAt !== null && localDay(card.endedAt) === model.today) : null;
  return {
    agent,
    latest: latestActivity(mine),
    running: section("running", W.agentRunning, apart(running, model.now)),
    review: section("review", W.agentReview, apart(review, model.now)),
    planned: section("planned", STATE_WORD.planned, apart(planned, model.now)),
    goals: section("goals", W.agentGoals, goals),
    doneToday: doneToday && section("done", W.done, doneToday),
  };
}

/**
 * A goal's work cards (kanban goal cards excluded) and the evidence that closed it. Its finished cards nothing names are
 * one line, as in 완료 (collapsed, lina-app#242), where the first of them stood: never rows named by the kind word.
 */
export function goalCards(model: Model, detail: ItemDetail, goals: GoalList | undefined): { cards: Section<CardRow>; evidence: { key: string; text: string; at: number | null }[] } {
  const goalCardIds = new Set((goals?.goals ?? []).map((goal) => goal.id));
  // Its detail's cards, then the ones the work tab's fold links to it (lina-app#170): the same rows both tabs show.
  const ids = [...new Set([...detail.workCards.filter((id) => !goalCardIds.has(id)), ...linkedCards(model, goalIds(model, detail.id), [], detail.title).map((card) => card.id)])];
  const cards = apart(
    ids.map((id) => model.cards.get(id)).filter((card): card is CardRow => card !== undefined),
    model.now,
  );
  const unnamed = cards.filter((card) => card.state === "done" && card.title === null);
  const grey = unnamed.length ? collapsed([...unnamed].sort(newestFirst((card) => card.endedAt)), { goal: detail.id })[0] : null;
  const rows = grey ? cards.flatMap((card) => (card === unnamed[0] ? [grey] : unnamed.includes(card) ? [] : [card])) : cards;
  const linked = new Set(detail.workCards);
  const evidence = (goals?.goals ?? [])
    .flatMap((goal) => goal.evidence)
    .filter((entry) => linked.has(entry.cardId) && entry.summary)
    .map((entry) => ({ key: entry.cardId, text: entry.summary ?? "", at: entry.completedAt }));
  return { cards: section("cards", W.cards, rows), evidence };
}

type GoalFacts = { readonly id: string; readonly title?: string; readonly state: WorkState; readonly reason: string | null; readonly stateSince: number | null };
type FoldParts = Pick<Model, "cards" | "unlisted" | "runs" | "runOwner" | "items">;

/** A goal's id and its to-dos' ids: the record ids its cards' runs may take on. */
function goalIds(parts: Pick<Model, "items">, goalId: string): ReadonlySet<string> {
  return new Set([goalId, ...[...parts.items.values()].filter((item) => item.parent === goalId).map((item) => item.id)]);
}

/**
 * The listed work cards linked to record ids: `cardIds` (a detail's work cards), the cards whose runs take on one of
 * `ids`, and the cards the core names the goal titled `goalTitle` as theirs (`goalTitle`, the name the work tab puts
 * on their rows first; the hub links its cards no other way, lina-app#170).
 */
function linkedCards(parts: FoldParts, ids: ReadonlySet<string>, cardIds: readonly string[], goalTitle: string | null | undefined): CardRow[] {
  const byRuns = [...parts.runs.values()]
    .filter((run) => run.todo !== null && ids.has(run.todo))
    .map((run) => parts.runOwner.get(run.id))
    .filter((id): id is string => id !== undefined);
  const byTitle = goalTitle ? [...parts.cards.values()].filter((card) => card.goalTitle === goalTitle).map((card) => card.id) : [];
  return [...new Set([...cardIds, ...byRuns, ...byTitle])].map((id) => parts.cards.get(id)).filter((card): card is CardRow => card !== undefined && !parts.unlisted.has(card.id));
}

/**
 * A goal's state as the work tab folds its cards (lina-app#148, #168, #170): the one derivation its page head (opened
 * from 작업 and from 대화) and its rows in the goal lists read. Its cards are the ones linkedCards finds for the goal and
 * its to-dos; the fold is foldState's.
 */
function goalFold(parts: FoldParts, goal: GoalFacts, cardIds: readonly string[]): GoalFacts & { readonly running: readonly CardRow[]; readonly cards: readonly CardRow[] } {
  const cards = linkedCards(parts, goalIds(parts, goal.id), cardIds, goal.title);
  return { ...foldState(goal, cards), cards };
}

/**
 * A to-do's state as the work tab folds the cards its runs take it on in (lina-app#170), the rule its goal follows: the
 * goal page's and the conversation goal view's 할 일 lines and the to-do's own head read it.
 */
export function todoState(parts: FoldParts, todo: GoalFacts): { state: WorkState; reason: string | null; stateSince: number | null } {
  const { state, reason, stateSince } = foldState(todo, linkedCards(parts, new Set([todo.id]), [], null));
  return { state, reason, stateSince };
}

/**
 * A goal's or to-do's state folded from its cards: done stays done; a stopped card makes it 중단됨 since its latest
 * stop; a running card 진행 중 since the first of them started; otherwise the record's own state.
 */
function foldState(goal: GoalFacts, cards: readonly CardRow[]): GoalFacts & { readonly running: readonly CardRow[] } {
  const stopped = cards.filter((card) => card.state === "stopped");
  const running = cards.filter((card) => card.state === "in_progress");
  const facts = { id: goal.id, state: goal.state, reason: goal.reason, stateSince: goal.stateSince };
  if (goal.state === "done") return { ...facts, running };
  if (stopped.length) return { ...facts, state: "stopped", reason: null, stateSince: maxOf(stopped.map((card) => card.stateAt)), running };
  const started = running.map((card) => card.startedAt).filter((at): at is number => at !== null);
  if (running.length) return { ...facts, state: "in_progress", reason: null, stateSince: started.length ? Math.min(...started) : goal.stateSince, running };
  return { ...facts, running };
}

/** A goal page's head state (goalFold): its cards are the ones its detail links, a linked work goal standing for its cards. */
export function goalState(model: Model, detail: Pick<ItemDetail, "id" | "title" | "state" | "reason" | "stateSince" | "workCards">, goals: GoalList | undefined): { state: WorkState; reason: string | null; stateSince: number | null } {
  const workGoals = new Map((goals?.goals ?? []).map((goal) => [goal.id, goal]));
  const ids = detail.workCards.flatMap((id) => workGoals.get(id)?.workCards.map((card) => card.id) ?? [id]);
  const { state, reason, stateSince } = goalFold(model, detail, ids);
  return { state, reason, stateSince };
}

export function quotaHasData(view: QuotaView | undefined): boolean {
  return Boolean(view && view.quota.length);
}
