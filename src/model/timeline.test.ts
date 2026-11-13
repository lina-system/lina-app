import { expect, test } from "vitest";
import type { RecordRound } from "../api/client";
import type { ItemDetail } from "../api/client";
import { firstSentence, goalHistory, historyLines, isMachineNotice, outcomeOf } from "./timeline";

const round = (fields: Partial<RecordRound>): RecordRound => ({ run: 1, startedAt: 100, endedAt: null, endKnown: false, startUnknown: false, result: null, verdict: null, stopped: false, rows: [], ...fields });

test("a round's word: the verdict, then its own end, then going only while it holds now, else no end on record", () => {
  expect(outcomeOf(round({ verdict: "accepted", endKnown: true, endedAt: 200 }), false, false, 300)).toBe("accepted");
  expect(outcomeOf(round({ verdict: "rejected", endKnown: true, endedAt: 200 }), false, false, 300)).toBe("rejected");
  expect(outcomeOf(round({ stopped: true, endKnown: true, endedAt: 200 }), true, true, 300)).toBe("stopped");
  expect(outcomeOf(round({ endKnown: true, endedAt: 200 }), true, true, 300)).toBe("ended");
  expect(outcomeOf(round({}), true, true, 300)).toBe("going");
  // Not the newest round, or its run no longer goes, or now is before its start: its end is not on record.
  expect(outcomeOf(round({}), false, true, 300)).toBe("unknown");
  expect(outcomeOf(round({}), true, false, 300)).toBe("unknown");
  expect(outcomeOf(round({}), true, true, 50)).toBe("unknown");
});

test("a history sentence is the first sentence with ids, paths and commands taken out, cut at 60 characters", () => {
  expect(firstSentence("커밋 3f2a1c9 반영했어요. 다음은 표로 바꿉니다")).toBe("커밋 반영했어요.");
  expect(firstSentence("lina-app#128 기준으로 src/app.tsx 정리함\n둘째 줄")).toBe("기준으로 정리함");
  expect(firstSentence("`npm test` 돌려서 통과함! 이어서 배포")).toBe("돌려서 통과함!");
  const long = "가".repeat(80);
  expect(firstSentence(long)).toBe(`${"가".repeat(59)}…`);
  expect([...(firstSentence(long) ?? "")]).toHaveLength(60);
  // Nothing a person can read is left: no sentence, the row says so in its own words.
  expect(firstSentence("https://example.com/a/b deploy.sh --force")).toBeNull();
  expect(firstSentence(null)).toBeNull();
});

/**
 * History lines the real hub's comments produced (lina-app#149, ids in their shape, none real): each one cut inside a
 * word or a number, or a machine notice, or an identifier with nothing around it. Machine notices are no line; every
 * other comment reads one whole sentence or nothing.
 */
const REAL_HISTORY: readonly (readonly [string, string, string | null])[] = [
  ["worker-a", "vs 20 14 my in '—' 24, 14 점검", null],
  ["worker-a", '.5초 무렵 "불러오는 중"이었고…', null],
  ["lina-worker", "[대기 충족] of — 돌렸다.", null],
  ["kanban-dispatcher", "[받음] 1744 대화에 들어감: 21:44 · OT-QAX1113…", null],
  ["worker-a", "장부 G73 / T264.", null],
  ["worker-a", "t_27363156 레스큐 봇", "레스큐 봇"],
  ["worker-a", "rc=1(없음)", null],
  ["worker-a", "[현황]", null],
  ["worker-a", "[받음] 첫 화면 문구를 짧게 고쳤어요.", null],
  ["lina-worker", "작업을 받아 대화에 들어감", null],
  ["worker-a", "G73 장부를 맞추고 T264 할 일을 닫았어요. 이어서 배포", "장부를 맞추고 할 일을 닫았어요."],
];

const IDENTIFIER = /[A-Za-z]+[-_:]?\d|\d+[A-Za-z]|#\d|=|_/;

test.each(REAL_HISTORY)("a real comment by %s, %j, is a whole sentence with no identifier or tag, or no line at all", (author, body, expected) => {
  const line = isMachineNotice(body, author) ? null : firstSentence(body);
  expect(line).toBe(expected);
  if (line === null) return;
  expect(line).not.toMatch(IDENTIFIER);
  expect(line).not.toMatch(/\[[^\]]*\]/);
  // It starts on a letter or a number, and every word in it is a whole word of the comment: nothing cut mid-word.
  expect(line).toMatch(/^[\p{L}\p{N}"'(]/u);
  const words = new Set(body.split(/\s+/).map((word) => word.replace(/[.,!?。:;…]+$/, "")));
  for (const word of line.replace(/…$/, "").split(/\s+/)) expect(words, word).toContain(word.replace(/[.,!?。:;]+$/, ""));
});

test("a long sentence is cut at a word end with …, never inside a word", () => {
  const body = "배포 전에 바뀐 화면 문구를 하나씩 다시 읽어 보고 어색한 곳을 고쳐서 검토 요청을 올렸고 이어서 남은 화면 두 곳을 맞추는 중";
  const line = firstSentence(body) ?? "";
  expect(line.endsWith("…")).toBe(true);
  expect([...line].length).toBeLessThanOrEqual(60);
  expect(body.startsWith(line.slice(0, -1))).toBe(true);
  expect(body[line.length - 1]).toBe(" ");
});

test("history lines read newest first, and a run of entries with nothing left to read is one line with its count", () => {
  const lines = historyLines([
    { at: 100, text: "첫 문장." },
    { at: 400, text: null },
    { at: 300, text: null },
    { at: 500, text: "마지막 문장." },
    { at: 200, text: null },
    { at: 250, text: "중간 문장." },
  ]);
  expect(lines.map((line) => [line.at, line.text, line.folded])).toEqual([
    [500, "마지막 문장.", 0],
    [400, null, 2],
    [250, "중간 문장.", 0],
    [200, null, 1],
    [100, "첫 문장.", 0],
  ]);
});

test("a goal's history: comments, its question, its runs, the merge and the close, one row each in time order", () => {
  const detail = {
    state: "done",
    stateSince: 900,
    ownerDone: null,
    comments: [
      { cid: "c1", by: "owner", at: 200, text: "첫 화면 문구는 짧게 해 주세요. 자세한 건 docs/guide.md 참고", status: "resolved", kind: "comment", replies: [{ by: "ag-1", at: 300, text: "짧게 고쳤어요.", result: null }] },
    ],
    decision: { text: "가이드를 첫 화면에 걸지 결정 필요", kind: "ask", at: 400, answered: true, choices: [], recommended: null, cid: null },
    runs: [{ id: "r1", title: "guide", state: "done", reason: null, startedAt: 450, endedAt: 600 }],
  } as unknown as ItemDetail;
  const rows = goalHistory(detail, [{ at: 700, text: "새 가이드를 문서 사이트에 올림 (3f2a1c9)" }]);
  // Newest first, as every history (lina-app#149).
  expect(rows.map((row) => [row.at, row.kind, row.text])).toEqual([
    [900, "close", "완료"],
    [700, "merge", "새 가이드를 문서 사이트에 올림"],
    [600, "run", "완료"],
    [400, "question", "질문: 가이드를 첫 화면에 걸지 결정 필요"],
    [300, "comment", "짧게 고쳤어요."],
    [200, "comment", "첫 화면 문구는 짧게 해 주세요."],
  ]);
});
