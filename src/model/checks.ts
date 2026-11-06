import type { StatusCheck, StatusChecks } from "../api/client";

/** A check that has something to say: failing, stale or an unreadable file. */
export type OpenCheckState = Exclude<StatusCheck["state"], "ok">;

export interface OpenCheck {
  readonly key: string;
  readonly name: string;
  readonly line: string;
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
    open.push({ key: `${check.file}:${index}`, name: check.name, line: check.line, state: check.state, at: check.at });
  }
  return { open, ok, total: (view?.checks ?? []).length };
}
