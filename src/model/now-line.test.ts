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

test("a now or history line with a change number, an address or the hub machine's old name is refused, as the core's check_now (G138)", () => {
  // The core brief's own sentences; the owner's Korean machine names and a dated or counted number pass.
  for (const line of ["34·36·37·39번 변경을 메인에 합침", "주문 기능을 마지막 44번 변경까지 메인에 합침", "허브맥 접속이 끊겨 일을 쉬고 재로그인을 기다림", "허브 맥 재부팅 시험 승인을 기다리는 중", "변경 12를 되돌림", "커밋 3을 다시 읽음", "가짜 기기 10.0.0.1에 다시 접속함"])
    expect(nowMayShow(line), line).toBe(false);
  for (const line of ["리나맥 관리자 실행과 권한 허용을 기다리는 중", "리나허브 오씨엑스 홈을 한 번 재시작하고 준비 상태 확인함", "옛 허브 맥 폐기 확정을 반영함", "11-10·11-11·11-17 계획 수치를 정정했다", "5개 항목을 확인함"])
    expect(nowMayShow(line), line).toBe(true);
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
