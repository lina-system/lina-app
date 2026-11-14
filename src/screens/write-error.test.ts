import { expect, test } from "vitest";
import { HttpSource } from "../data/http-source";
import { W } from "../words";
import { talkError } from "./talk";
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
  // A new to-do (POST /api/lina/work/items) takes 1-25 characters: the line reads the core's own number (lina-app#154).
  [400, "text must be 1-25 characters after trimming", W.errTextMax(25)],
  [429, "too many writes: 30 a minute per client", W.errTooMany],
  [404, "no goal or to-do T99", W.notFound],
];

test.each(CORE)("the core's %i %s reads as one short line", (status, detail, line) => {
  expect(writeError("comment", { ok: false, status, detail })).toBe(line);
});

test("every refusal line is short: at most six words", () => {
  for (const [, , line] of CORE) expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
});

test("a 429 reads as too many writes whatever its detail; an unknown 409 reads by its action; anything else reads one neutral line, never the core's text (lina-app#154)", () => {
  expect(writeError("done", { ok: false, status: 429, detail: null })).toBe(W.errTooMany);
  expect(writeError("undo", { ok: false, status: 409, detail: "something new" })).toBe(W.errUndoExpired);
  expect(writeError("read", { ok: false, status: 503, detail: "quota: quota source did not answer" })).toBe("저장하지 못함 · 다시 시도");
  expect(writeError("comment", { ok: false, status: 400, detail: "due must be YYYY-MM-DD, not 12월 1일" })).toBe("저장하지 못함 · 다시 시도");
  expect(writeError("comment", { ok: false, status: 409, detail: "기록이 읽기 전용이다" })).toBe("저장하지 못함 · 다시 시도");
  expect(writeError("comment", { ok: false, status: 0, detail: null })).toBe(W.writeFailed);
});

test("a device refusal reads by status and never shows the core's line", () => {
  expect(writeError("device", { ok: false, status: 403, detail: "not the owner's device" })).toBe(W.settingsReadOnly);
  expect(writeError("device", { ok: false, status: 429, detail: "not the owner's device" })).toBe(W.errTooMany);
  expect(writeError("device", { ok: false, status: 404, detail: "no such device" })).toBe(W.deviceMissing);
  expect(writeError("device", { ok: false, status: 409, detail: "sign-in already running" })).toBe(W.deviceBusy);
  expect(writeError("device", { ok: false, status: 501, detail: "sign-in is not on this core yet" })).toBe(W.deviceUnsupported);
  expect(writeError("device", { ok: false, status: 502, detail: "the node refused" })).toBe(W.deviceRefused);
  expect(writeError("device", { ok: false, status: 400, detail: "service must be worker or ocx" })).toBe(W.writeFailed);
  expect(writeError("device", { ok: false, status: 500, detail: null })).toBe(W.writeFailed);
  expect(writeError("comment", { ok: false, status: 429, detail: "not the owner's device" })).toBe(W.errTooMany);
});

/**
 * Refused turns as the core passes them on (lina-app#158): `no_owning_agent` is the core's own and comes only from a
 * to-do's conversation; in an agent window a 409 is the agent gateway's (an OpenAI-style error, its code a name such as
 * `admission_conflict` or null), and a busy gateway answers 429. The messages are made up.
 */
const REFUSED_TURNS: readonly (readonly [string, number, string, string])[] = [
  ["the core's no owning agent", 409, JSON.stringify({ error: { code: "no_owning_agent", message: "no agent owns T9" } }), W.talkNoAgent],
  ["the gateway's admission conflict", 409, JSON.stringify({ error: { message: "a turn is already running in this conversation", type: "invalid_request_error", param: null, code: "admission_conflict" } }), W.talkBusy],
  ["a gateway 409 with no code", 409, JSON.stringify({ error: { message: "conflict", type: "invalid_request_error", param: null, code: null } }), W.talkBusy],
  ["a 409 with no body", 409, "", W.talkBusy],
  ["the gateway's rate limit", 429, JSON.stringify({ error: { message: "too many runs at once", type: "rate_limit_error", param: null, code: "rate_limit_exceeded" } }), W.talkBusy],
  ["a 429 in plain text", 429, "gateway busy", W.talkBusy],
  ["a gateway 500", 500, JSON.stringify({ error: { message: "internal error", type: "server_error", param: null, code: null } }), W.saveFailed],
  ["a 400 the window does not know", 400, JSON.stringify({ error: { message: "bad request", type: "invalid_request_error", param: "message", code: "invalid_value" } }), W.saveFailed],
];

test.each(REFUSED_TURNS)("a refused turn, %s (%i), reads by the body's code, not by the status alone", async (_name, status, body, line) => {
  const source = new HttpSource({ fetch: (async () => new Response(body || null, { status })) as typeof fetch, token: "token-a" });
  const result = await source.agentTalk("ag-x", { message: "가짜 메시지" });
  if (result.ok) throw new Error("not refused");
  expect(talkError(result)).toBe(line);
});
