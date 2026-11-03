import type { WriteResult } from "../data/source";
import { W } from "../words";

export type WriteKind = "comment" | "answer" | "done" | "undo" | "retry";

/** The 409s the client knows by the action that got them (lina#149); any other refusal reads the core's own line. */
const CONFLICT: Partial<Record<WriteKind, string>> = {
  done: W.errOpenTodos,
  undo: W.errUndoExpired,
  answer: W.errNoDecision,
};

export function writeError(kind: WriteKind, result: Extract<WriteResult<unknown>, { ok: false }>): string {
  if (result.status === 409 && CONFLICT[kind]) return CONFLICT[kind];
  return result.detail ?? W.writeFailed;
}
