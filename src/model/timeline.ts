import type { ItemDetail, PlainHistoryLine, RecordRound, RecordRow, RunRecord } from "../api/client";
import { STATE_WORD, stateLabel, W } from "../words";
import { historySentences, nowMayShow, STATE_ONLY, wholeText } from "./fold";
import { holds } from "./rounds";

/** Who writes machine notices on a card (the dispatcher's and the worker's receipts): never a history line. */
const MACHINE_AUTHORS = new Set(["kanban-dispatcher", "dispatcher", "lina-worker", "system"]);

/** A machine notice opens with a bracketed tag of words alone ([받음], [대기 충족], [현황]). */
const MACHINE_TAG = /^\s*\[[^\]\n\d]{1,20}\]/;

/**
 * A worker hand-out line a bot writes in English (G138): no Hangul, a hand-out verb (assigned, dispatched, claimed, spawned,
 * handed off) and a worker, run or task in it. It names who took the work, never what it is: a machine notice.
 */
const HANDOUT = /^(?![\s\S]*\p{Script=Hangul})(?=[\s\S]*\b(?:assign(?:ed|ing)?|dispatch(?:ed|ing)?|claim(?:ed|ing)?|spawn(?:ed|ing)?|hand(?:ed|ing)?\s+(?:off|over))\b)(?=[\s\S]*\b(?:workers?|runs?|tasks?)\b)/iu;

/**
 * Whether the owner wrote a comment, by its author alone (lina-app#226): `owner`, what the core writes for a comment made
 * in the app, or the owner's id (`items.owner.id`). Never read from the words.
 */
export function ownerWrote(author: string | null | undefined, owner?: string | null): boolean {
  return author === "owner" || (Boolean(owner) && author === owner);
}

/**
 * Whether a comment is a machine notice, by its author or its opening tag (lina-app#149): it is no history line. The
 * owner's own comment is never one, even when it opens with a bracketed word such as `[중요]`.
 */
export function isMachineNotice(text: string | null | undefined, author?: string | null, owner?: string | null): boolean {
  if (ownerWrote(author, owner)) return false;
  return (author ? MACHINE_AUTHORS.has(author) : false) || MACHINE_TAG.test(text ?? "") || HANDOUT.test(text ?? "");
}

/** A comment's history line (lina-app#236): the owner's words as saved (lina-app#226), a bot's whole text or none (wholeText). */
export function commentLine(text: string, author: string | null | undefined, owner?: string | null): string | null {
  if (ownerWrote(author, owner)) return text.trim() ? text : null;
  return wholeText(text);
}

/**
 * History entries newest first (lina-app#149, the one order of every history; of two at the same time, the one
 * recorded later first): an entry with no line of its own (`text` null) folds, and each run of them is one line with
 * their count (`folded`) that holds them (`held`, newest first: the line opens to them, lina-app#241). A state word alone
 * that follows the same state word is one line with the newest time and their `count` (lina-app#236, drawn `×n`); an
 * entry that carries its own count adds it.
 */
export function historyLines<T extends { readonly at: number; readonly text: string | null; readonly count?: number }>(entries: readonly T[]): (T & { readonly folded: number; readonly count: number; readonly held: readonly T[] })[] {
  const lines: (T & { folded: number; count: number; held: T[] })[] = [];
  const order = entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.at - a.entry.at || b.index - a.index);
  for (const { entry } of order) {
    const last = lines.at(-1);
    const count = entry.count ?? 1;
    if (entry.text === null && last && last.text === null) {
      last.folded += 1;
      last.held.push(entry);
    } else if (entry.text !== null && STATE_ONLY.has(entry.text) && last?.text === entry.text) last.count += count;
    else lines.push({ ...entry, folded: entry.text === null ? 1 : 0, count, held: entry.text === null ? [entry] : [] });
  }
  return lines;
}

/**
 * A work card's comments as history lines, newest first: a machine notice is no line, the owner's comment is its words
 * as saved, a bot's its whole text or none (commentLine, lina-app#236), and a run of comments with none is one 접힌 댓글
 * line (lina-app#149, #153, #226). A text drawn more than once is one line at its newest time with its `count`
 * (lina-app#230), so the folded lines around a repeat it took away read as one.
 */
export function commentHistory<T extends { readonly at: number; readonly author: string | null; readonly body: string | null }>(comments: readonly T[], owner?: string | null): (T & { readonly text: string | null; readonly count: number; readonly folded: number; readonly held: readonly (T & { readonly text: string | null })[] })[] {
  const lines = comments.filter((comment) => !isMachineNotice(comment.body, comment.author, owner)).map((comment) => ({ ...comment, text: commentLine(comment.body ?? "", comment.author, owner) }));
  // A state word alone is an event, no sentence: historyLines counts one that repeats the line before it.
  const sentence = (text: string | null): text is string => text !== null && !STATE_ONLY.has(text);
  const newest = new Map<string, (typeof lines)[number]>();
  for (const line of lines) if (sentence(line.text) && line.at >= (newest.get(line.text)?.at ?? -Infinity)) newest.set(line.text, line);
  return historyLines(lines.filter((line) => !sentence(line.text) || newest.get(line.text) === line).map((line) => ({ ...line, count: sentence(line.text) ? lines.filter((other) => other.text === line.text).length : 1 })));
}

/**
 * The owner's answer to an item's decision once it is answered: the newest comment of kind `answer` made at or after
 * the question (lina-app#153). Null while the decision is open, or when its answer is not among the comments.
 */
export function answerOf(detail: Pick<ItemDetail, "decision" | "comments">): { readonly at: number; readonly text: string } | null {
  const decision = detail.decision;
  if (!decision?.answered) return null;
  const answers = detail.comments.filter((comment) => comment.kind === "answer" && (decision.cid ? comment.cid === decision.cid : comment.at >= (decision.at ?? 0)));
  const answer = answers.sort((a, b) => b.at - a.at)[0];
  return answer ? { at: answer.at, text: answer.text } : null;
}

/**
 * An item's decision as history, from its typed fields: when it was asked (its kind word, and its text when it stands
 * whole: wholeText, lina-app#236) and when the owner answered it.
 */
export function decisionHistory(detail: Pick<ItemDetail, "decision" | "comments">): { at: number; kind: "question"; text: string }[] {
  const decision = detail.decision;
  if (!decision) return [];
  const word = decision.kind === "ask" ? W.ask : W.act;
  const rows: { at: number; kind: "question"; text: string }[] = [];
  const whole = wholeText(decision.text);
  if (decision.at) rows.push({ at: decision.at, kind: "question", text: whole ? `${word}: ${whole}` : word });
  const answer = answerOf(detail);
  if (answer) rows.push({ at: answer.at, kind: "question", text: W.answeredWhat(word) });
  return rows;
}

/** A text a folded line holds, to open as written (lina-app#241): when (if known), who wrote it (none for a record row) and all of it. */
export interface HeldText {
  readonly at: number | null;
  readonly by: string | null;
  readonly text: string;
}

/** One event of a goal's history (기록): when, what kind, the one sentence its row shows, and what a folded row holds. */
export interface HistoryRow {
  readonly at: number;
  readonly kind: "comment" | "question" | "run" | "merge" | "close";
  readonly text: string;
  readonly held: readonly HeldText[];
}

/**
 * A goal's history, newest first: each comment and reply (the owner's as saved, a bot's whole or folded: commentLine),
 * its question, how each of its runs ended, each finished work card's merge line (its evidence, whole or none) and its
 * close. One row per event, `time · one line` (lina-app#123, #226, #236); state words that follow each other are one row with `×n`.
 */
export function goalHistory(detail: ItemDetail, evidence: readonly { readonly at: number | null; readonly text: string }[], owner?: string | null): HistoryRow[] {
  const rows: { at: number; kind: HistoryRow["kind"]; text: string | null; by?: string | null; source?: string }[] = [];
  for (const comment of detail.comments) {
    if (!isMachineNotice(comment.text, comment.by, owner)) rows.push({ at: comment.at, kind: "comment", text: commentLine(comment.text, comment.by, owner), by: comment.by, source: comment.text });
    for (const reply of comment.replies) if (!isMachineNotice(reply.text, reply.by, owner)) rows.push({ at: reply.at, kind: "comment", text: commentLine(reply.text, reply.by, owner), by: reply.by, source: reply.text });
  }
  rows.push(...decisionHistory(detail));
  for (const run of detail.runs) {
    const at = run.endedAt ?? run.startedAt;
    if (at !== null && run.state !== "in_progress" && run.state !== "planned") rows.push({ at, kind: "run", text: stateLabel(run.state, run.reason) });
  }
  for (const entry of evidence) {
    const whole = wholeText(entry.text);
    if (entry.at !== null && whole) rows.push({ at: entry.at, kind: "merge", text: whole });
  }
  if (detail.state === "done" && detail.stateSince !== null) rows.push({ at: detail.stateSince, kind: "close", text: detail.ownerDone ? W.markedDone : STATE_WORD.done });
  return historyLines(rows).map(({ at, kind, text, folded, count, held }) => ({
    at,
    kind,
    text: text === null ? W.foldedRun(folded) : count > 1 ? `${text} ${W.repeated(count)}` : text,
    held: held.map((row) => ({ at: row.at, by: row.by ?? null, text: row.source ?? "" })),
  }));
}

/**
 * A record row as the timeline draws it (lina-app#241): `text` is its unit when it stands whole by the one gate (wholeText),
 * else null and it folds; `source` is what the record holds, which the fold opens to as written.
 */
export type TimelineRow = RecordRow & { readonly source: string | null };

/** How a round ended, as one word on its head (W.outcome). */
export type Outcome = "accepted" | "rejected" | "stopped" | "ended" | "unknown" | "going";

export type TimelineBlock =
  | {
      readonly type: "round";
      readonly key: string;
      /** The id of the run whose record holds the round. */
      readonly runId: string;
      /** The round's number in its job: its own when on record, else its place counted from the oldest. */
      readonly n: number;
      readonly at: number;
      readonly start: number | null;
      readonly end: number | null;
      readonly startUnknown: boolean;
      readonly outcome: Outcome;
      /** Its rows, newest first: a report line that does not stand whole is a folded row of its own at the round's end. */
      readonly rows: readonly TimelineRow[];
      /** The round's report line when it stands on its line (roundResult), else the one sentence of its own it reads (roundSentence); on a round still going, what the card does now (cardNow, G138). */
      readonly result: string | null;
      /** How many rounds of this outcome with nothing else in them, one after another, the block stands for (`×n`, lina-app#236). */
      readonly count: number;
    }
  | { readonly type: "comment"; readonly key: string; readonly at: number; readonly rows: readonly TimelineRow[] };

/**
 * A closed round's report line as the sentence after its verdict (lina-app#269): whole (wholeText) and one the card's now
 * line would pass (nowMayShow), else null and it folds.
 */
export function roundResult(text: string | null | undefined): string | null {
  const whole = wholeText(text);
  return whole && nowMayShow(whole) ? whole : null;
}

/**
 * The one sentence a closed round's line reads when its report line does not stand on it (roundResult, criterion 2): the
 * first sentence of the round's own that says what came of it (historySentences) and that no newer round reads (`used`,
 * filled newest first): its report line's, then its said rows' (tails the core kept of longer texts). A comment on the
 * card is never one (lina-app#269): it is another event than the verdict, and stays in the 댓글 box. Null when none
 * stands: the line reads its outcome alone.
 */
export function roundSentence(round: { readonly result: string | null; readonly said: readonly (string | null)[] }, used: Set<string>): string | null {
  const sentences = [...historySentences(round.result), ...round.said.flatMap((text) => historySentences(text, { opens: true, ends: true }))];
  const sentence = sentences.find((each) => !used.has(each)) ?? null;
  if (sentence) used.add(sentence);
  return sentence;
}

/**
 * One round's word. A verdict first (검토 통과, 검토 반려), then its own end (작업 중단, 작업 마침); a round with no
 * end on record is going only when it is its run's newest round, the run is live and now falls inside it (the one
 * round boundary, holds); otherwise its end is not on record (완료 기록 없음).
 */
export function outcomeOf(round: RecordRound, newest: boolean, live: boolean, now: number): Outcome {
  if (round.verdict === "accepted") return "accepted";
  if (round.verdict === "rejected") return "rejected";
  if (round.stopped) return "stopped";
  if (round.endKnown) return "ended";
  if (newest && live && round.startedAt !== null && holds({ start: round.startedAt, end: round.endedAt }, now)) return "going";
  return "unknown";
}

/**
 * The timeline of one or more worker runs' records: one block per round and one per run of comments made while no
 * round was going, newest first, their rows newest first too. `live` says whether a run is still going (its own state, or its card's for a run the
 * board does not list). `doing` is the one sentence of what the card does now (cardNow): a going round's line reads it, and
 * its tool steps are then no row. A tool step is never a line of its own (G138): with no such sentence it folds with the
 * rows that do not stand whole, and the fold opens to its count. `comments: false` leaves out the comment blocks (a card
 * draws them in its own 댓글 box) before rounds are counted, so the rounds around one still read as one line (lina-app#269).
 */
export function timelineBlocks(records: readonly { readonly id: string; readonly record: RunRecord }[], live: (runId: string) => boolean, now: number, { doing = null, comments = true }: { readonly doing?: string | null; readonly comments?: boolean } = {}): TimelineBlock[] {
  // A machine notice is no row; rows read newest first, as every history (lina-app#149).
  const shown = <R extends RecordRow>(rows: readonly R[]) => rows.filter((row) => row.kind !== "comment" || !isMachineNotice(row.text)).sort((a, b) => b.at - a.at);
  // A comment row (an agent's note the core cut at 300 characters) and a going round's said row (what its worker says
  // now) are no owner's words: whole by the one gate or folded, never a part (lina-app#230, #236, #241). An ended round's
  // said row is the tail the core kept of a longer text, opening or ending anywhere in it: no unit, so it always folds.
  const gated = (rows: readonly RecordRow[], ended = false): TimelineRow[] =>
    shown(rows).map((row) => (row.kind === "tools" ? { ...row, text: null, source: W.toolSteps(row.count) } : { ...row, text: ended && row.kind === "said" ? null : wholeText(row.text), source: row.text }));
  const blocks: TimelineBlock[] = [];
  // What a closed round whose report line does not stand whole left to read its sentence from.
  const sources = new Map<TimelineBlock, Parameters<typeof roundSentence>[0]>();
  // A card's worker runs may each serve the card's one record: a round or a comment read twice is drawn once
  // (lina-app#153).
  const seen = new Set<string>();
  const first = (key: string) => !seen.has(key) && Boolean(seen.add(key));
  for (const { id, record } of records) {
    record.rounds.forEach((round, index) => {
      if (!first(`round:${round.run}:${round.startedAt}:${round.endedAt}`)) return;
      const outcome = outcomeOf(round, index === 0, live(id), now);
      // A round stands at the time its head reads: a going round's start, an ended one's end (its start when the end
      // is not on record).
      const at = (outcome === "going" ? (round.startedAt ?? round.endedAt) : (round.endedAt ?? round.startedAt)) ?? round.rows[0]?.at ?? 0;
      const result = outcome === "going" ? doing : roundResult(round.result);
      // A going round that reads what the card does now needs no count of its tool steps.
      const rows = outcome === "going" && doing ? round.rows.filter((row) => row.kind !== "tools") : round.rows;
      // A report line that does not stand whole is folded at the round's end, never lost (lina-app#241).
      const unread: TimelineRow[] = outcome !== "going" && result === null && round.result?.trim() ? [{ at, kind: "said", text: null, count: 1, source: round.result }] : [];
      const block: TimelineBlock = {
        type: "round",
        key: `${id}:${round.run ?? "x"}:${round.startedAt ?? round.endedAt ?? 0}`,
        runId: id,
        n: round.run ?? record.rounds.length - index,
        at,
        start: round.startedAt,
        end: round.endedAt,
        startUnknown: round.startUnknown,
        outcome,
        rows: shown([...unread, ...gated(rows, outcome !== "going")]),
        result,
        count: 1,
      };
      blocks.push(block);
      if (outcome !== "going" && result === null) sources.set(block, { result: round.result, said: round.rows.filter((row) => row.kind === "said").map((row) => row.text) });
    });
    if (comments) for (const comment of gated(record.comments)) if (first(`comment:${comment.at}:${comment.source}`)) blocks.push({ type: "comment", key: `${id}:c:${comment.at}`, at: comment.at, rows: [comment] });
  }
  // Comments made one after another between rounds are one 댓글 block. A round with nothing drawn in it but its outcome,
  // after a round of the same outcome with nothing drawn either, is that round's line, counted (lina-app#153, #236, #269:
  // `검토를 통과했다 ×n` at the newest time); a line with a sentence or another outcome is never in the count. What it folds
  // joins that round's rows, so its folded line holds it (lina-app#241).
  const merged: TimelineBlock[] = [];
  const used = new Set<string>();
  const read = blocks.sort((a, b) => b.at - a.at).map((block) => {
    const source = sources.get(block);
    const sentence = source ? roundSentence(source, used) : null;
    return sentence && block.type === "round" ? { ...block, result: sentence } : block;
  });
  const bare = (block: TimelineBlock) => block.type === "round" && !block.result && block.rows.every((row) => row.text === null);
  for (const block of read) {
    const last = merged.at(-1);
    if (block.type === "comment" && last?.type === "comment") merged[merged.length - 1] = { ...last, rows: shown([...last.rows, ...block.rows]) };
    else if (block.type === "round" && last?.type === "round" && bare(block) && bare(last) && block.outcome === last.outcome) merged[merged.length - 1] = { ...last, count: last.count + 1, rows: [...last.rows, ...block.rows] };
    else merged.push(block);
  }
  return merged;
}

/** A closed round's verdict as a small mark beside a card's history line (G138): its outcome, how many rounds it stands for, and the first round's run, number and time for its link. */
export interface HistoryMark {
  readonly outcome: Exclude<Outcome, "going">;
  readonly count: number;
  readonly runId: string;
  readonly n: number;
  readonly at: number;
}

/** One line of a card's history (G138): the time its step started and the one sentence of what it did, with the verdicts of the rounds that ended in it. */
export interface CardHistoryLine {
  readonly at: number;
  readonly text: string;
  readonly marks: readonly HistoryMark[];
}

/**
 * A card's history as its 기록 reads it (G138, lina-app#269): one line per step the core served (`plain.history`), newest
 * first, `time · what it did`. A sentence the card's now line would not pass (nowMayShow) is no line and folds; the same
 * sentence twice in a row is one line at its newest time. A closed round's verdict is no line: it is a mark beside the
 * line whose step held the round's end (the newest line that started at or before it, so the step just before when none
 * held it), and one with no such line folds. A missing or empty history has no line, so the old record folds whole
 * with its verdicts.
 */
export function cardHistory(history: readonly PlainHistoryLine[] | null | undefined, records: readonly { readonly id: string; readonly record: RunRecord }[], live: (runId: string) => boolean, now: number): { lines: CardHistoryLine[]; folded: TimelineRow[] } {
  const folded: TimelineRow[] = [];
  const lines: { at: number; from: number; text: string; marks: HistoryMark[] }[] = [];
  const steps = (history ?? []).map((step, index) => ({ step, index })).sort((a, b) => b.step.at - a.step.at || a.index - b.index);
  for (const { step } of steps) {
    const text = step.text.trim();
    const last = lines.at(-1);
    if (!nowMayShow(text)) folded.push({ at: step.at, kind: "said", text: null, count: 1, source: step.text });
    else if (last?.text === text) last.from = step.at;
    else lines.push({ at: step.at, from: step.at, text, marks: [] });
  }
  const seen = new Set<string>();
  // With no line, the old record folds whole and holds its rounds' verdicts itself.
  if (lines.length) for (const { id, record } of records)
    record.rounds.forEach((round, index) => {
      const outcome = outcomeOf(round, index === 0, live(id), now);
      const end = round.endedAt ?? round.startedAt;
      if (outcome === "going" || end === null || seen.has(`${round.run}:${round.startedAt}:${round.endedAt}`)) return;
      seen.add(`${round.run}:${round.startedAt}:${round.endedAt}`);
      const line = lines.find((each) => each.from <= end);
      if (!line) {
        folded.push({ at: end, kind: "said", text: null, count: 1, source: W.outcomeSaid[outcome] });
        return;
      }
      const same = line.marks.findIndex((mark) => mark.outcome === outcome);
      const mark = { outcome, count: 1, runId: id, n: round.run ?? record.rounds.length - index, at: end };
      if (same < 0) line.marks.push(mark);
      else line.marks[same] = { ...line.marks[same], count: line.marks[same].count + 1 };
    });
  return { lines: lines.map(({ at, text, marks }) => ({ at, text, marks })), folded: folded.sort((a, b) => b.at - a.at) };
}
