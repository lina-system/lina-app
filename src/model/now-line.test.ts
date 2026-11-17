import { expect, test } from "vitest";
import { cardNow } from "./index";
import { nowMayShow, nowSentenceOf } from "./fold";
import { botSentence, isMachineNotice } from "./timeline";

// G138: the one sentence of what a card does now, its gate and where it is read from.

const at = (minutes: number) => 1_800_000_000 - minutes * 60;
const comment = (author: string, body: string, minutes: number) => ({ author, body, createdAt: at(minutes) });

test("the gate of what a card does now takes label letters and common abbreviations, never a ref, a path, a code name or English", () => {
  for (const sentence of ["묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다.", "PR 두 개를 나눠 올리는 중", "CI 결과를 기다리는 중", "일꾼 셋을 기다림"]) expect(nowMayShow(sentence), sentence).toBe(true);
  for (const sentence of ["lina#12를 고치는 중", "#12 뒤 정리를 하는 중", "src/model/fold.ts를 고치는 중", "fake_card_s5를 기다리는 중", "t_ab12cd34 결과를 기다리는 중", "Running npm test in packages", "npm 시험을 돌리는 중", "S2 판을 다시 읽는 중", "https 주소를 여는 중", "`npm test`를 돌리는 중", "a1b2c3d 커밋을 다시 보는 중"])
    expect(nowMayShow(sentence), sentence).toBe(false);
});

test("a bot's text says what it does now in its first sentence the gate passes, less its stamp; a state word alone says none", () => {
  expect(nowSentenceOf("[가짜 보고 17:24] 묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다. 셋이 끝나면 한 판으로 모은다.")).toBe("묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다.");
  expect(nowSentenceOf("fake#631 뒤 정리를 기다린다. 가짜 표를 다시 그리는 중이다.")).toBe("가짜 표를 다시 그리는 중이다.");
  expect(nowSentenceOf("Merged via fake#12.")).toBeNull();
  expect(nowSentenceOf("진행 중")).toBeNull();
});

test("an English worker hand-out line is a machine notice, as a receipt is; an English report of the work is not", () => {
  expect(isMachineNotice("Assigned worker w-4601 to run 1 (lane A)", "ag-1")).toBe(true);
  expect(isMachineNotice("Dispatched 3 workers for lanes A, B and C", "ag-1")).toBe(true);
  expect(isMachineNotice("[받음] 가짜 묶음을 넘겨받음", "ag-1")).toBe(true);
  expect(isMachineNotice("Fake review merged via fake#12.", "ag-1")).toBe(false);
  expect(isMachineNotice("일꾼 셋에 맡김 (assigned to workers)", "ag-1")).toBe(false);
  // The owner's words are never a notice, whatever they say.
  expect(isMachineNotice("Assigned worker w-1 to run 1", "owner")).toBe(false);
});

test("the newest bot comment speaks for the work: the owner's comments, notices and hand-out lines after it do not", () => {
  const comments = [
    comment("owner", "A부터 먼저 봐 줘", 60),
    comment("ag-1", "[가짜 보고 17:24] 묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다.", 34),
    comment("ag-1", "Assigned worker w-4603 to run 3 (lane C)", 33),
    comment("lina-worker", "[받음] 가짜 묶음을 넘겨받음", 32),
    comment("owner", "좋아", 31),
  ];
  expect(botSentence(comments)).toBe("묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다.");
  // Only the owner's: none. A newest one with no sentence that may show: none, never an older one.
  expect(botSentence([comment("owner", "A부터 먼저 봐 줘", 5)])).toBeNull();
  expect(botSentence([comment("ag-1", "가짜 첫 판을 올리는 중", 20), comment("ag-1", "lina#12와 src/a.ts를 손보는 중", 10)])).toBeNull();
});

test("what a card does now reads the core's now line, then the newest bot comment, then why it waits; a stopped card's why stays its head's", () => {
  const plain = (now: string | null) => ({ title: null, now, result: null });
  const going = { state: "in_progress" as const, plain: plain(null) };
  expect(cardNow({ ...going, plain: plain("요약을 붙이는 중") }, [comment("ag-1", "묶음 A·B·C를 맡겼다.", 1)], null)).toEqual({ text: "요약을 붙이는 중", from: "plain" });
  expect(cardNow(going, [comment("ag-1", "묶음 A·B·C를 맡겼다.", 1)], "가짜 일꾼 셋을 기다림")).toEqual({ text: "묶음 A·B·C를 맡겼다.", from: "comment" });
  expect(cardNow({ state: "waiting", plain: plain(null), ask: "가짜 일꾼 셋의 결과를 기다림" }, [comment("owner", "A부터 먼저 봐 줘", 1)], null)).toEqual({ text: "가짜 일꾼 셋의 결과를 기다림", from: "reason" });
  expect(cardNow(going, [], "initial_status")).toBeNull();
  expect(cardNow({ state: "stopped", plain: plain(null), ask: "가짜 일꾼 셋을 기다림" }, [], null)).toBeNull();
  expect(cardNow({ state: "done", plain: plain("요약을 붙이는 중") }, [], null)).toBeNull();
});
