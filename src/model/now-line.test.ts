import { expect, test } from "vitest";
import { cardNow } from "./index";
import { nowMayShow } from "./fold";
import { isMachineNotice } from "./timeline";

// G138: a card's top line is the core's now line when it passes the 40-letter gate, else what its state says it waits for,
// else none; never a bot's comment.

const plain = (now: string | null) => ({ title: null, now, result: null });
const going = { state: "in_progress" as const, plain: plain(null), reason: null };

test("the core's now line stands only as one sentence of 40 letters or fewer with no id, ref, path or English word", () => {
  for (const line of ["변경마다 한 줄 요약을 붙이는 중", "가짜 목록 셋을 차례로 맞추는 중", "가".repeat(40)]) expect(nowMayShow(line), line).toBe(true);
  for (const line of ["가".repeat(41), "목록을 맞췄다. 이제 표를 그리는 중", "목록을 맞추는 중\n표를 그리는 중", "t_ab12cd34 결과를 기다리는 중", "w-4603 결과를 기다리는 중", "lina#12를 고치는 중", "#12 뒤 정리를 하는 중", "문서/목록을 고치는 중", "src/a.ts를 고치는 중", "npm 시험을 돌리는 중", "Running npm test", ""])
    expect(nowMayShow(line), line).toBe(false);
});

test("a card's top line reads the core's now line first, else the wait its state says, else none", () => {
  expect(cardNow({ ...going, plain: plain("가짜 목록 셋을 차례로 맞추는 중") })).toEqual({ text: "가짜 목록 셋을 차례로 맞추는 중", from: "plain" });
  // Over 40 letters: no now line, so the state's words.
  expect(cardNow({ state: "waiting", plain: plain("가".repeat(41)), reason: "review" })).toEqual({ text: "검토를 기다리는 중", from: "state" });
  // The owner's answer: a question in the work inbox, or the core saying so.
  expect(cardNow(going, true)).toEqual({ text: "결정 대기", from: "state" });
  expect(cardNow({ state: "waiting", plain: plain(null), reason: "feedback", waitingOn: "owner" })).toEqual({ text: "피드백 대기", from: "state" });
  expect(cardNow({ state: "waiting", plain: plain(null), reason: "blocked_by_item" })?.text).toBe("다른 일을 기다리는 중");
  expect(cardNow({ state: "waiting", plain: plain(null), reason: "gate" })?.text).toBe("검사를 기다리는 중");
  expect(cardNow({ state: "waiting", plain: plain(null), reason: null, waitingOn: "agent:ag-2" })?.text).toBe("다른 에이전트를 기다리는 중");
  expect(cardNow({ state: "waiting", plain: plain(null), reason: "hold", retry: "scheduled" })?.text).toBe("정한 시각을 기다리는 중");
  // What it waits for is not said: no line, never a guess.
  expect(cardNow(going)).toBeNull();
  expect(cardNow({ state: "waiting", plain: plain(null), reason: "decision", waitingOn: null })).toBeNull();
  // A stopped card's wait is its head's; a finished one has none.
  expect(cardNow({ state: "stopped", plain: plain(null), reason: "decision", waitingOn: "owner" })).toBeNull();
  expect(cardNow({ state: "stopped", plain: plain("가짜 기기를 다시 잇는 중"), reason: "feedback" })).toEqual({ text: "가짜 기기를 다시 잇는 중", from: "plain" });
  expect(cardNow({ state: "done", plain: plain("가짜 목록 셋을 차례로 맞추는 중"), reason: null })).toBeNull();
});

test("an English worker hand-out line is a machine notice, as a receipt is; an English report of the work is not", () => {
  expect(isMachineNotice("Assigned worker w-4601 to run 1 (lane A)", "ag-1")).toBe(true);
  expect(isMachineNotice("Dispatched 3 workers for lanes A, B and C", "ag-1")).toBe(true);
  expect(isMachineNotice("[받음] 가짜 묶음을 넘겨받음", "ag-1")).toBe(true);
  expect(isMachineNotice("Fake review merged via fake#12.", "ag-1")).toBe(false);
  expect(isMachineNotice("가짜 묶음을 맡김 (assigned to workers)", "ag-1")).toBe(false);
  expect(isMachineNotice("Assigned worker w-1 to run 1", "owner")).toBe(false);
});
