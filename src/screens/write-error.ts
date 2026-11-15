import type { WriteResult } from "../data/source";
import { W } from "../words";

export type WriteKind = "comment" | "answer" | "done" | "undo" | "retry" | "read" | "device";

/**
 * A text the writing guide refuses (lina-app#183). `lina work` ends that refusal with `Guide: <path> · work fields
 * <field>` (ko `가이드: …`) and the core's 400 carries that last line; the rules it hit (`Rule hit: <rule> …`, ko
 * `걸린 규칙: …`) are read only when the detail carries them. The app never judges the text itself, so its line cannot
 * drift from the core's rules; with no rule named it reads every rule.
 */
const GUIDE = /(?:^|\n)\s*(?:Guide|가이드): .* · work fields (.+)$/;
const RULE_HIT = /(?:Rule hit|걸린 규칙): (.+)/g;
/** The core's rule names (hermes_cli/work/writing_fields.py, en and ko) and the word the line uses for each. */
const GUIDE_RULES: readonly (readonly [RegExp, string])[] = [
  [/^(?:issue or PR number|task id|이슈·PR 번호|작업 번호)/, W.guideRule.number],
  [/^(?:command or option|명령과 옵션)/, W.guideRule.command],
  [/^(?:path|경로)/, W.guideRule.path],
  [/^(?:internal name|내부 이름)/, W.guideRule.internalName],
  [/^(?:parentheses|괄호)/, W.guideRule.parentheses],
  [/^(?:leading tag|앞머리 꼬리표)/, W.guideRule.tag],
  [/^(?:device name|기기 이름)/, W.guideRule.device],
];

function guideRefusal(detail: string): string {
  const field = GUIDE.exec(detail)?.[1] ?? "";
  const subject = /title|제목|목표 이름/.test(field) ? W.guideTitle : W.guideText;
  const rules = [...detail.matchAll(RULE_HIT)].flatMap(([, hit]) => GUIDE_RULES.filter(([rule]) => rule.test(hit)).map(([, word]) => word));
  return rules.length ? W.errGuide([...new Set(rules)].join(", "), subject) : W.errGuideAny(subject);
}

/**
 * Every refusal the core sends (hermes_cli/lina_board_write.py and the `lina work` messages it passes on, in the
 * work record's locale, ko or en) and the one line the screen shows for it, or the function that reads it.
 */
export const REFUSALS: readonly (readonly [RegExp, string | ((detail: string) => string)])[] = [
  [GUIDE, guideRefusal],
  [/열린 할 일이 남아 있어 완료로 표시하지 않았다|still has open to-dos, so it was not marked done/, W.errOpenTodos],
  [/완료 표시 뒤 10분이 지나 되돌리지 않았다|more than 10 minutes have passed since it was marked done/, W.errUndoExpired],
  [/마지막 기록이 주인의 완료 표시가 아니다|is not the owner's done mark|완료 표시 전 기록을 못 찾았다|record before the done mark/, W.errNotOwnersMark],
  [/주인이 정할 것이 없다|has nothing for the owner to decide/, W.errNoDecision],
  [/는 열린 항목이 아니다|is not an open item|는 내린 항목이다|is a dropped item/, W.errClosed],
  [/^text is required$|^댓글 글이 비었다$|^Comment text is empty$/, W.errNoText],
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

/** A text over the route's limit: a comment takes 2000 characters, a new to-do 25 (lina-app#154). The line names the core's number. */
const TEXT_LIMIT = /^text must be 1-(\d+) characters after trimming$/;

export function writeError(kind: WriteKind, result: Extract<WriteResult<unknown>, { ok: false }>): string {
  if (kind === "device") return deviceRefusal(result.status);
  if (result.status === 429) return W.errTooMany;
  const limit = TEXT_LIMIT.exec(result.detail ?? "");
  if (limit) return W.errTextMax(Number(limit[1]));
  const known = result.detail ? REFUSALS.find(([pattern]) => pattern.test(result.detail ?? "")) : undefined;
  if (known) return typeof known[1] === "string" ? known[1] : known[1](result.detail ?? "");
  if (result.status === 409 && CONFLICT[kind]) return CONFLICT[kind];
  // The core's own words are English or internal: a refusal this table does not know reads one neutral line (lina-app#154).
  return result.detail ? W.saveFailed : W.writeFailed;
}
