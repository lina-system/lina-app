import type { RecordRound, RecordRow, RunRecord } from "../api/client";
import { holds } from "./rounds";

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
