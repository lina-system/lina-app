import { expect, test } from "vitest";
import type { RecordRound } from "../api/client";
import type { ItemDetail } from "../api/client";
import { firstSentence, goalHistory, outcomeOf } from "./timeline";

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
  expect(rows.map((row) => [row.at, row.kind, row.text])).toEqual([
    [200, "comment", "첫 화면 문구는 짧게 해 주세요."],
    [300, "comment", "짧게 고쳤어요."],
    [400, "question", "질문: 가이드를 첫 화면에 걸지 결정 필요"],
    [600, "run", "완료"],
    [700, "merge", "새 가이드를 문서 사이트에 올림"],
    [900, "close", "완료"],
  ]);
});
