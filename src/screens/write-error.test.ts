import { expect, test } from "vitest";
import { W } from "../words";
import { writeError } from "./write-error";

// The core's own refusal lines (hermes_cli/lina_board_write.py, hermes_cli/web_routers/lina_board.py and the
// `lina work` messages in hermes_cli/work/cmd_comments.py with their en text from locale_en.py), as served.
const CORE: readonly (readonly [number, string, string])[] = [
  [409, "G1에 열린 할 일이 남아 있어 완료로 표시하지 않았다: T1, T2 — 함께 닫으려면 --with-open", W.errOpenTodos],
  [409, "G1 still has open to-dos, so it was not marked done: T1, T2 — use --with-open to close them too", W.errOpenTodos],
  [409, "완료 표시 뒤 10분이 지나 되돌리지 않았다 (12분 전). 다시 열려면 work reopen", W.errUndoExpired],
  [409, "Not undone: more than 10 minutes have passed since it was marked done (12m ago). To reopen it, use work reopen", W.errUndoExpired],
  [409, "T3의 마지막 기록이 주인의 완료 표시가 아니다", W.errNotOwnersMark],
  [409, "The last record on T3 is not the owner's done mark", W.errNotOwnersMark],
  [409, "T3의 완료 표시 전 기록을 못 찾았다", W.errNotOwnersMark],
  [409, "T2에 주인이 정할 것이 없다", W.errNoDecision],
  [409, "T2 has nothing for the owner to decide", W.errNoDecision],
  [409, "T3는 열린 항목이 아니다", W.errClosed],
  [409, "T3 is a dropped item", W.errClosed],
  [400, "text is required", W.errNoText],
  [409, "댓글 글이 비었다", W.errNoText],
  [400, "text must be 1-2000 characters after trimming", W.errTextLength],
  [429, "too many writes: 30 a minute per client", W.errTooMany],
  [404, "no goal or to-do T99", W.notFound],
];

test.each(CORE)("the core's %i %s reads as one short line", (status, detail, line) => {
  expect(writeError("comment", { ok: false, status, detail })).toBe(line);
});

test("every refusal line is short: at most six words", () => {
  for (const [, , line] of CORE) expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
});

test("a 429 reads as too many writes whatever its detail; an unknown 409 reads by its action; anything else keeps the core's line", () => {
  expect(writeError("done", { ok: false, status: 429, detail: null })).toBe(W.errTooMany);
  expect(writeError("undo", { ok: false, status: 409, detail: "something new" })).toBe(W.errUndoExpired);
  expect(writeError("read", { ok: false, status: 503, detail: "quota: quota source did not answer" })).toBe("quota: quota source did not answer");
  expect(writeError("comment", { ok: false, status: 0, detail: null })).toBe(W.writeFailed);
});
