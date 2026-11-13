import { expect, test } from "vitest";
import { W } from "../words";
import { stopReason } from "./stop-reason";

const stop = (words: string, owner = false, known = true) => ({ words, known, owner, retry: false });

test.each([
  ["waits on the owner's decision", { state: "stopped", reason: "decision", stop: stop("준 확인 필요", true) }, { word: "준 확인 필요", ask: W.answerField }],
  ["waits on the owner's feedback", { state: "stopped", reason: "feedback", stop: stop("준 확인 필요", true) }, { word: "준 확인 필요", ask: W.answerField }],
  ["waits on an agent's review", { state: "stopped", reason: null, stop: stop("서윤 검토 대기") }, { word: "서윤 검토 대기" }],
  ["not tried again", { state: "stopped", reason: "unresponsive", stop: stop("응답 없음 · 다시 시도 안 함") }, { word: "응답 없음 · 다시 시도 안 함" }],
  ["tried again later", { state: "stopped", reason: "budget", stop: stop("다시 시도 예정") }, { word: "다시 시도 예정" }],
  ["the core does not say who", { state: "stopped", reason: "unresponsive", stop: stop("응답 없음", false, false) }, { word: "응답 없음" }],
  ["no row words, the reason alone", { state: "stopped", reason: "failed" }, { word: "실패" }],
  ["an unknown reason", { state: "stopped", reason: "cancelled" }, { word: "" }],
  ["not stopped", { state: "waiting", reason: "review" }, { word: "검토 필요" }],
] as const)("a stop that %s reads the same words on its row and its detail", (_kind, card, expected) => {
  expect(stopReason(card)).toEqual(expected);
});
