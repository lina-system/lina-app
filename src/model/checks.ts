import type { StatusCheck, StatusChecks } from "../api/client";
import { CHECK_LINE, CHECK_OUTCOME_LINE, type CheckOutcome, SEP, W } from "../words";

/** A check that has something to say: failing, stale or an unreadable file. */
export type OpenCheckState = Exclude<StatusCheck["state"], "ok">;

export interface OpenCheck {
  readonly key: string;
  readonly name: string;
  readonly line: string;
  /** What the row reads: `<name> · <line>` when the line is Korean, else one Korean line by id and outcome. */
  readonly title: string;
  /** The core's own line when it is not Korean, folded behind 자세히; null when the title already says it. */
  readonly original: string | null;
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

const count = (line: string, mark: string) => line.split(mark).length - 1;

/**
 * The core cuts an engine's error at a fixed length, which can end inside a word (`(the web Mo`, lina-app#150). A line
 * left with a bracket or a quote open was cut: it keeps its whole words and ends in one ellipsis.
 */
function wholeWords(line: string): string {
  const cut = count(line, "(") > count(line, ")") || count(line, "[") > count(line, "]") || count(line, '"') % 2 === 1;
  const end = line.trimEnd().lastIndexOf(" ");
  return cut && end > 0 ? W.cutShort(line.slice(0, end)) : line;
}

/** A Korean line reads as written. Any other line (an engine's English error) reads one plain Korean line instead. */
function plainLine(check: StatusCheck): Pick<OpenCheck, "title" | "original"> {
  if (HANGUL.test(check.line)) return { title: [check.name, check.line].filter(Boolean).join(SEP), original: null };
  const outcome = outcomeOf(check);
  const original = check.line.trim() ? wholeWords(check.line) : null;
  if (Object.hasOwn(CHECK_LINE, check.name)) return { title: CHECK_LINE[check.name][outcome], original };
  const line = CHECK_OUTCOME_LINE[outcome];
  return { title: HANGUL.test(check.name) ? `${check.name}${SEP}${line}` : line, original };
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
    open.push({ key: `${check.file}:${index}`, name: check.name, line: check.line, ...plainLine(check), state: check.state, at: check.at });
  }
  return { open, ok, total: (view?.checks ?? []).length };
}
