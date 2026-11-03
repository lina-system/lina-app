import type { WriteResult } from "../data/source";
import { W } from "../words";

export type WriteKind = "comment";

/** The one line under a control after a refused write: the core's `detail`, or 보내지 못함 when there is none. */
export function writeError(_kind: WriteKind, result: Extract<WriteResult<unknown>, { ok: false }>): string {
  return result.detail ?? W.writeFailed;
}
