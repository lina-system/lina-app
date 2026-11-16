import type { ItemDetail, RecordRound, RecordRow, RunRecord } from "../api/client";
import { STATE_WORD, stateLabel, W } from "../words";
import { historySentences, STATE_ONLY, wholeText } from "./fold";
import { holds } from "./rounds";

/** Who writes machine notices on a card (the dispatcher's and the worker's receipts): never a history line. */
const MACHINE_AUTHORS = new Set(["kanban-dispatcher", "dispatcher", "lina-worker", "system"]);

/** A machine notice opens with a bracketed tag of words alone ([받음], [대기 충족], [현황]). */
const MACHINE_TAG = /^\s*\[[^\]\n\d]{1,20}\]/;

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
  return (author ? MACHINE_AUTHORS.has(author) : false) || MACHINE_TAG.test(text ?? "");
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
      /** The round's report line when it stands whole (wholeText), else the one sentence its line reads (roundSentence); never on a round still going. */
      readonly result: string | null;
      /** How many rounds of this outcome with nothing else in them, one after another, the block stands for (`×n`, lina-app#236). */
      readonly count: number;
    }
  | { readonly type: "comment"; readonly key: string; readonly at: number; readonly rows: readonly TimelineRow[] };

/** A bot's text made as a round ended: the record's note on it, or a comment on the card (criterion 2). */
export interface RoundNote {
  readonly at: number;
  readonly text: string;
  /** The core cut it at its length (a record row): its last piece may be a part of a sentence. */
  readonly cut?: boolean;
}

/** How long after a round's end a note still speaks of it. */
const NOTE_AFTER = 30 * 60;

/**
 * The one sentence a closed round's line reads when its report line does not stand whole (criterion 2): the first whole
 * sentence that says what came of it (historySentences) and that no newer round reads (`used`, filled newest first):
 * its report line's, then its said rows' (tails the core kept of longer texts), then those of the notes made from a
 * minute before its end to half an hour after it, oldest first. Null when none stands: the line reads its outcome alone.
 */
export function roundSentence(round: { readonly result: string | null; readonly said: readonly (string | null)[]; readonly end: number | null }, notes: readonly RoundNote[], used: Set<string>): string | null {
  const end = round.end;
  const near = end === null ? [] : notes.filter((note) => note.at >= end - 60 && note.at <= end + NOTE_AFTER).sort((a, b) => a.at - b.at);
  const sentences = [...historySentences(round.result), ...round.said.flatMap((text) => historySentences(text, { opens: true, ends: true })), ...near.flatMap((note) => historySentences(note.text, { ends: note.cut }))];
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
 * board does not list). `notes` are the bots' comments on the card, which a closed round's line may read (roundSentence).
 */
export function timelineBlocks(records: readonly { readonly id: string; readonly record: RunRecord }[], live: (runId: string) => boolean, now: number, notes: readonly RoundNote[] = []): TimelineBlock[] {
  // A machine notice is no row; rows read newest first, as every history (lina-app#149).
  const shown = <R extends RecordRow>(rows: readonly R[]) => rows.filter((row) => row.kind !== "comment" || !isMachineNotice(row.text)).sort((a, b) => b.at - a.at);
  // A comment row (an agent's note the core cut at 300 characters) and a going round's said row (what its worker says
  // now) are no owner's words: whole by the one gate or folded, never a part (lina-app#230, #236, #241). An ended round's
  // said row is the tail the core kept of a longer text, opening or ending anywhere in it: no unit, so it always folds.
  const gated = (rows: readonly RecordRow[], ended = false): TimelineRow[] =>
    shown(rows).map((row) => (row.kind === "tools" ? { ...row, source: null } : { ...row, text: ended && row.kind === "said" ? null : wholeText(row.text), source: row.text }));
  const blocks: TimelineBlock[] = [];
  // What a closed round whose report line does not stand whole left to read its sentence from, and every note.
  const sources = new Map<TimelineBlock, Parameters<typeof roundSentence>[0]>();
  const every: RoundNote[] = [...notes];
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
      const result = outcome === "going" ? null : wholeText(round.result);
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
        rows: shown([...unread, ...gated(round.rows, outcome !== "going")]),
        result,
        count: 1,
      };
      blocks.push(block);
      if (outcome !== "going" && result === null) sources.set(block, { result: round.result, said: round.rows.filter((row) => row.kind === "said").map((row) => row.text), end: round.endedAt ?? round.startedAt });
    });
    every.push(...record.comments.filter((row) => row.text && !isMachineNotice(row.text)).map((row) => ({ at: row.at, text: row.text ?? "", cut: true })));
    for (const comment of gated(record.comments)) if (first(`comment:${comment.at}:${comment.source}`)) blocks.push({ type: "comment", key: `${id}:c:${comment.at}`, at: comment.at, rows: [comment] });
  }
  // Comments made one after another between rounds are one 댓글 block. A round with nothing drawn in it but the outcome
  // of the round before it is that round's line, counted (lina-app#153, #236: `검토 통과 ×n` at the newest time); what it
  // folds joins that round's rows, so its folded line holds it (lina-app#241).
  const merged: TimelineBlock[] = [];
  const used = new Set<string>();
  const read = blocks.sort((a, b) => b.at - a.at).map((block) => {
    const source = sources.get(block);
    const sentence = source ? roundSentence(source, every, used) : null;
    return sentence && block.type === "round" ? { ...block, result: sentence } : block;
  });
  for (const block of read) {
    const last = merged.at(-1);
    const nothingDrawn = block.rows.every((row) => row.text === null && row.kind !== "tools");
    if (block.type === "comment" && last?.type === "comment") merged[merged.length - 1] = { ...last, rows: shown([...last.rows, ...block.rows]) };
    else if (block.type === "round" && last?.type === "round" && nothingDrawn && !block.result && block.outcome === last.outcome) merged[merged.length - 1] = { ...last, count: last.count + 1, rows: [...last.rows, ...block.rows] };
    else merged.push(block);
  }
  return merged;
}
