import type { ItemDetail, RecordRound, RecordRow, RunRecord } from "../api/client";
import { STATE_WORD, stateLabel, W } from "../words";
import { foldReason } from "./fold";
import { holds } from "./rounds";

/** How long a history row's sentence may be, in characters, before it is cut with `…` (lina-app#142). */
export const SENTENCE_MAX = 60;

const HANGUL = /[\uac00-\ud7a3]/;

/** Who writes machine notices on a card (the dispatcher's and the worker's receipts): never a history line. */
const MACHINE_AUTHORS = new Set(["kanban-dispatcher", "dispatcher", "lina-worker", "system"]);

/** A machine notice opens with a bracketed tag ([받음], [대기 충족], [현황]). */
const MACHINE_TAG = /^\s*\[[^\]\n]{1,20}\]/;

/**
 * Whether a comment is a machine notice, by its author or its opening tag (lina-app#149): it is no history line. The
 * owner's own comment is never one, even when it opens with a bracketed word such as `[중요]`.
 */
export function isMachineNotice(text: string | null | undefined, author?: string | null): boolean {
  if (author === "owner") return false;
  return (author ? MACHINE_AUTHORS.has(author) : false) || MACHINE_TAG.test(text ?? "");
}

/**
 * An identifier a person does not read: a card, run or to-do id (G73, T264, t_27363156, OT-QAX1113), a key with its
 * value (rc=1), and every kind of raw text the fold rule names but an English word (a path, a command, a hash, an
 * issue number, an address).
 */
function isIdentifier(core: string): boolean {
  if (/^[A-Za-z]{1,3}\d+$/.test(core) || /[A-Za-z][\w]*[-_:][\w-]*\d/.test(core) || /#\d/.test(core) || core.includes("=")) return true;
  const reason = foldReason(core);
  return reason !== null && reason !== "latin" && reason !== "fragment";
}

/**
 * One sentence as a person reads it, or null: its identifiers are left out, and it is dropped whole when it holds an
 * English word, starts inside a word or a number (.5초), or is mostly not Korean, so no word is ever cut or spliced.
 */
function readable(sentence: string): string | null {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (!words.length || /^[.,:;·…—-]/.test(words[0])) return null;
  const kept: string[] = [];
  let removed = false;
  for (const word of words) {
    const core = word.replace(/^[(\["'“‘]+|[)\]"'”’.,!?。:;…]+$/g, "");
    if (!/[\p{L}\p{N}]/u.test(core)) continue;
    if (isIdentifier(core)) {
      removed = true;
      continue;
    }
    if (foldReason(core) === "latin") return null;
    kept.push(word);
  }
  const korean = kept.filter((word) => HANGUL.test(word)).length;
  if (!korean || korean * 2 < kept.length || (removed && kept.length < 2)) return null;
  let shown = kept.join(" ");
  const end = /[.!?。]$/.exec(sentence)?.[0];
  if (end && !shown.endsWith(end)) shown = `${shown.replace(/[,.:;]$/, "")}${end}`;
  return shown;
}

/**
 * The one sentence a history row shows for a longer text: its first sentence a person may read (readable), cut at a
 * word end with `…` when it runs past SENTENCE_MAX characters. Null when nothing a person reads is left.
 */
export function firstSentence(text: string | null | undefined, max = SENTENCE_MAX): string | null {
  const sentences = (text ?? "")
    .split("\n")
    .flatMap((line) => line.trim().split(/(?<=[.!?。])\s+/))
    .filter(Boolean);
  const shown = sentences.map(readable).find((sentence): sentence is string => sentence !== null);
  if (!shown) return null;
  const letters = [...shown];
  if (letters.length <= max) return shown;
  const head = letters.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,.:;]$/, "")}…`;
}

/**
 * History entries newest first (lina-app#149, the one order of every history; of two at the same time, the one
 * recorded later first): an entry with no sentence left (`text` null) is no line of its own, and each run of them is
 * one line with their count (`folded`).
 */
export function historyLines<T extends { readonly at: number; readonly text: string | null }>(entries: readonly T[]): (T & { readonly folded: number })[] {
  const lines: (T & { folded: number })[] = [];
  const order = entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.at - a.entry.at || b.index - a.index);
  for (const { entry } of order) {
    const last = lines.at(-1);
    if (entry.text === null && last && last.text === null) last.folded += 1;
    else lines.push({ ...entry, folded: entry.text === null ? 1 : 0 });
  }
  return lines;
}

/** One event of a goal's history (기록): when, what kind, and the one sentence its row shows. */
export interface HistoryRow {
  readonly at: number;
  readonly kind: "comment" | "question" | "run" | "merge" | "close";
  readonly text: string;
}

/**
 * A goal's history, newest first: each comment and reply (its first sentence), its question, how each of its runs
 * ended, each finished work card's merge line (its evidence) and its close. One row per event, `time · one sentence`
 * (lina-app#123).
 */
export function goalHistory(detail: ItemDetail, evidence: readonly { readonly at: number | null; readonly text: string }[]): HistoryRow[] {
  const rows: { at: number; kind: HistoryRow["kind"]; text: string | null }[] = [];
  for (const comment of detail.comments) {
    if (!isMachineNotice(comment.text, comment.by)) rows.push({ at: comment.at, kind: "comment", text: firstSentence(comment.text) });
    for (const reply of comment.replies) if (!isMachineNotice(reply.text, reply.by)) rows.push({ at: reply.at, kind: "comment", text: firstSentence(reply.text) });
  }
  if (detail.decision?.at) {
    const sentence = firstSentence(detail.decision.text);
    if (sentence) rows.push({ at: detail.decision.at, kind: "question", text: `${detail.decision.kind === "ask" ? W.ask : W.act}: ${sentence}` });
  }
  for (const run of detail.runs) {
    const at = run.endedAt ?? run.startedAt;
    if (at !== null && run.state !== "in_progress" && run.state !== "planned") rows.push({ at, kind: "run", text: stateLabel(run.state, run.reason) });
  }
  for (const entry of evidence) {
    const sentence = firstSentence(entry.text);
    if (entry.at !== null && sentence) rows.push({ at: entry.at, kind: "merge", text: sentence });
  }
  if (detail.state === "done" && detail.stateSince !== null) rows.push({ at: detail.stateSince, kind: "close", text: detail.ownerDone ? W.markedDone : STATE_WORD.done });
  return historyLines(rows).map(({ at, kind, text, folded }) => ({ at, kind, text: text ?? W.foldedRun(folded) }));
}

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
      readonly rows: readonly RecordRow[];
      /** The round's report line; never on a round still going. */
      readonly result: string | null;
    }
  | { readonly type: "comment"; readonly key: string; readonly at: number; readonly rows: readonly RecordRow[] };

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
 * board does not list).
 */
export function timelineBlocks(records: readonly { readonly id: string; readonly record: RunRecord }[], live: (runId: string) => boolean, now: number): TimelineBlock[] {
  // A machine notice is no row; rows read newest first, as every history (lina-app#149).
  const shown = (rows: readonly RecordRow[]) => rows.filter((row) => row.kind !== "comment" || !isMachineNotice(row.text)).sort((a, b) => b.at - a.at);
  const blocks: TimelineBlock[] = [];
  for (const { id, record } of records) {
    record.rounds.forEach((round, index) => {
      const outcome = outcomeOf(round, index === 0, live(id), now);
      // A round stands at the time its head reads: a going round's start, an ended one's end (its start when the end
      // is not on record).
      const at = (outcome === "going" ? (round.startedAt ?? round.endedAt) : (round.endedAt ?? round.startedAt)) ?? round.rows[0]?.at ?? 0;
      blocks.push({
        type: "round",
        key: `${id}:${round.run ?? "x"}:${round.startedAt ?? round.endedAt ?? 0}`,
        runId: id,
        n: round.run ?? record.rounds.length - index,
        at,
        start: round.startedAt,
        end: round.endedAt,
        startUnknown: round.startUnknown,
        outcome,
        rows: shown(round.rows),
        result: outcome === "going" ? null : round.result,
      });
    });
    for (const comment of shown(record.comments)) blocks.push({ type: "comment", key: `${id}:c:${comment.at}`, at: comment.at, rows: [comment] });
  }
  // Comments made one after another between rounds are one 댓글 block.
  const merged: TimelineBlock[] = [];
  for (const block of blocks.sort((a, b) => b.at - a.at)) {
    const last = merged.at(-1);
    if (block.type === "comment" && last?.type === "comment") merged[merged.length - 1] = { ...last, rows: shown([...last.rows, ...block.rows]) };
    else merged.push(block);
  }
  return merged;
}
