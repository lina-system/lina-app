import type { WriteResult } from "../data/source";
import { W } from "../words";

export type WriteKind = "comment" | "answer" | "done" | "undo" | "retry" | "read" | "device";

/**
 * Every refusal the core sends (hermes_cli/lina_board_write.py and the `lina work` messages it passes on, in the
 * work record's locale, ko or en) and the one line the screen shows for it.
 */
export const REFUSALS: readonly (readonly [RegExp, string])[] = [
  [/열린 할 일이 남아 있어 완료로 표시하지 않았다|still has open to-dos, so it was not marked done/, W.errOpenTodos],
  [/완료 표시 뒤 10분이 지나 되돌리지 않았다|more than 10 minutes have passed since it was marked done/, W.errUndoExpired],
  [/마지막 기록이 주인의 완료 표시가 아니다|is not the owner's done mark|완료 표시 전 기록을 못 찾았다|record before the done mark/, W.errNotOwnersMark],
  [/주인이 정할 것이 없다|has nothing for the owner to decide/, W.errNoDecision],
  [/는 열린 항목이 아니다|is not an open item|는 내린 항목이다|is a dropped item/, W.errClosed],
  [/^text is required$|^댓글 글이 비었다$|^Comment text is empty$/, W.errNoText],
  [/^text must be 1-\d+ characters after trimming$/, W.errTextLength],
  [/^too many writes/, W.errTooMany],
  [/^no goal or to-do /, W.notFound],
];

/** A 409 the core words in a way this table does not know yet still reads by the action that got it. */
const CONFLICT: Partial<Record<WriteKind, string>> = {
  done: W.errOpenTodos,
  undo: W.errUndoExpired,
  answer: W.errNoDecision,
};

/** A device write's refusal, by status. The core's detail is English and is never shown. 429 here is too many writes. */
function deviceRefusal(status: number): string {
  switch (status) {
    case 403:
      return W.settingsReadOnly;
    case 429:
      return W.errTooMany;
    case 404:
      return W.deviceMissing;
    case 409:
      return W.deviceBusy;
    case 501:
      return W.deviceUnsupported;
    case 502:
      return W.deviceRefused;
    default:
      return W.writeFailed;
  }
}

export function writeError(kind: WriteKind, result: Extract<WriteResult<unknown>, { ok: false }>): string {
  if (kind === "device") return deviceRefusal(result.status);
  if (result.status === 429) return W.errTooMany;
  const known = result.detail ? REFUSALS.find(([pattern]) => pattern.test(result.detail ?? "")) : undefined;
  if (known) return known[1];
  if (result.status === 409 && CONFLICT[kind]) return CONFLICT[kind];
  return result.detail ?? W.writeFailed;
}
