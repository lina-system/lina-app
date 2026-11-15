import type { StatusCheck, StatusChecks } from "../api/client";
import { CHECK_LINE, CHECK_OUTCOME_LINE, type CheckOutcome, glossaryKnows, glossaryToolName, SEP, STATUS_WORD } from "../words";

/** A check that has something to say: failing, stale or an unreadable file. */
export type OpenCheckState = Exclude<StatusCheck["state"], "ok">;

export interface OpenCheck {
  readonly key: string;
  readonly name: string;
  readonly line: string;
  /**
   * What the row reads: `<name> · <line>` when the line is Korean, else one Korean line by id and outcome, then the tool
   * the line names and why, when it says them (lina-app#160).
   */
  readonly title: string;
  readonly state: OpenCheckState;
  /** When the check last wrote, so the screen can say how long ago. */
  readonly at: number;
}

/** The checks panel's fold rule: failing, stale and error checks stay open, one row each; the rest is one count. */
export interface ChecksView {
  readonly open: readonly OpenCheck[];
  readonly ok: number;
  readonly total: number;
}

const HANGUL = /[\uac00-\ud7a3]/;

/** The line's own `ok:`, `hold:` or `fail:` when it starts with one, else the check's ok. */
function outcomeOf(check: StatusCheck): CheckOutcome {
  const said = /^\s*(ok|hold|fail)\b/i.exec(check.line)?.[1]?.toLowerCase();
  return said === "ok" || said === "hold" || said === "fail" ? said : check.ok ? "ok" : "fail";
}

/** The tool an engine's line names (`hold: <tool> on <node> …`), when the glossary knows it; and why it failed (lina-app#160). */
function lineDetail(line: string): string[] {
  const tool = /^\s*(?:ok|hold|fail)\s*:\s*([\w.-]+)\s+on\s/i.exec(line)?.[1];
  const cause = STATUS_WORD.checkCause.find(([rule]) => rule.test(line))?.[1];
  return [tool && glossaryKnows(tool) ? glossaryToolName(tool) : null, cause ?? null].filter((part): part is string => Boolean(part));
}

/**
 * A Korean line reads as written. Any other line (an engine's English error) reads one plain Korean line instead, and
 * the line itself is never shown (lina-app#178): every Korean part it yields is already in that one line.
 */
function plainLine(check: StatusCheck): string {
  if (HANGUL.test(check.line)) return [check.name, check.line].filter(Boolean).join(SEP);
  const outcome = outcomeOf(check);
  const detail = lineDetail(check.line);
  if (Object.hasOwn(CHECK_LINE, check.name)) return [CHECK_LINE[check.name][outcome], ...detail].join(SEP);
  const line = CHECK_OUTCOME_LINE[outcome];
  return [...(HANGUL.test(check.name) ? [check.name] : []), line, ...detail].join(SEP);
}

/**
 * A check says nothing while it is fine: only `state !== "ok"` stays open (a failing check, a stale one and a file
 * that could not be read all count as not ok), and every other check folds into `정상 n`.
 */
export function checksView(view: StatusChecks | undefined): ChecksView {
  const open: OpenCheck[] = [];
  let ok = 0;
  for (const [index, check] of (view?.checks ?? []).entries()) {
    if (check.state === "ok") {
      ok += 1;
      continue;
    }
    open.push({ key: `${check.file}:${index}`, name: check.name, line: check.line, title: plainLine(check), state: check.state, at: check.at });
  }
  return { open, ok, total: (view?.checks ?? []).length };
}
