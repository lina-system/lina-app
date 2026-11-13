import type { ItemDetail, RecordRound, RecordRow, RunRecord } from "../api/client";
import { STATE_WORD, stateLabel, W } from "../words";
import { foldReason } from "./fold";
import { holds } from "./rounds";

/** How long a history row's sentence may be, in characters, before it is cut with `…` (lina-app#142). */
export const SENTENCE_MAX = 60;

const HANGUL = /[\uac00-\ud7a3]/;

/**
 * The one sentence a history row shows for a longer text: its first sentence, with every word that would show raw
 * text (an id, a hash, a path, a command, an address, an English word) taken out, cut at SENTENCE_MAX characters.
 * Null when nothing a person reads is left.
 */
export function firstSentence(text: string | null | undefined, max = SENTENCE_MAX): string | null {
  const line = (text ?? "").split("\n").map((each) => each.trim()).find(Boolean) ?? "";
  const sentence = /^.*?[.!?。](?=\s|$)/.exec(line)?.[0] ?? line;
  const kept = sentence.split(/\s+/).filter((word) => {
    const core = word.replace(/^[(\["']+|[)\]"'.,!?。:;]+$/g, "");
    if (!core) return false;
    const reason = foldReason(core);
    return reason === null || reason === "fragment";
  });
  let shown = kept.join(" ");
  const end = /[.!?。]$/.exec(sentence)?.[0];
  if (end && !shown.endsWith(end)) shown = `${shown.replace(/[,.:;]$/, "")}${end}`;
  if (!HANGUL.test(shown)) return null;
  const letters = [...shown];
  return letters.length > max ? `${letters.slice(0, max - 1).join("")}…` : shown;
}

/** One event of a goal's history (기록): when, what kind, and the one sentence its row shows. */
export interface HistoryRow {
  readonly at: number;
  readonly kind: "comment" | "question" | "run" | "merge" | "close";
  readonly text: string;
}

/**
 * A goal's history, oldest first: each comment and reply (its first sentence), its question, how each of its runs
 * ended, each finished work card's merge line (its evidence) and its close. One row per event, `time · one sentence`
 * (lina-app#123).
 */
export function goalHistory(detail: ItemDetail, evidence: readonly { readonly at: number | null; readonly text: string }[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const comment of detail.comments) {
    rows.push({ at: comment.at, kind: "comment", text: firstSentence(comment.text) ?? W.folded });
    for (const reply of comment.replies) rows.push({ at: reply.at, kind: "comment", text: firstSentence(reply.text) ?? W.folded });
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
  return rows.sort((a, b) => a.at - b.at);
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
 * The timeline of one or more worker runs' records: one block per round and one per comment made while no round
 * was going, newest first. `live` says whether a run is still going (its own state, or its card's for a run the
 * board does not list).
 */
export function timelineBlocks(records: readonly { readonly id: string; readonly record: RunRecord }[], live: (runId: string) => boolean, now: number): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const { id, record } of records) {
    record.rounds.forEach((round, index) => {
      const outcome = outcomeOf(round, index === 0, live(id), now);
      blocks.push({
        type: "round",
        key: `${id}:${round.run ?? "x"}:${round.startedAt ?? round.endedAt ?? 0}`,
        runId: id,
        n: round.run ?? record.rounds.length - index,
        at: round.startedAt ?? round.endedAt ?? round.rows[0]?.at ?? 0,
        start: round.startedAt,
        end: round.endedAt,
        startUnknown: round.startUnknown,
        outcome,
        rows: round.rows,
        result: outcome === "going" ? null : round.result,
      });
    });
    for (const comment of record.comments) blocks.push({ type: "comment", key: `${id}:c:${comment.at}`, at: comment.at, rows: [comment] });
  }
  return blocks.sort((a, b) => b.at - a.at);
}
