import { expect, test } from "vitest";
import { plainText } from "./plain";

// lina-app#166: history and comment text shaped like the hub's (made up): markdown emphasis around a phrase, and
// entries that are only markers and spaces.

test("emphasis markers go and the words stay", () => {
  expect(plainText("검토 통과 · **설정 파일 옮기기 (메모 이전 건너뜀)**")).toBe("검토 통과 · 설정 파일 옮기기 (메모 이전 건너뜀)");
  expect(plainText("**배포 순서**를 정해 주세요. *짧게* 부탁해요.")).toBe("배포 순서를 정해 주세요. 짧게 부탁해요.");
  expect(plainText("__굵게__ 쓴 말과 ~~지운 말~~")).toBe("굵게 쓴 말과 지운 말");
  expect(plainText("* 첫 항목\n- 둘째 항목")).toBe("첫 항목\n- 둘째 항목");
});

test("an entry of markers and spaces only is empty", () => {
  for (const text of ["** **", "**", "  ", "****\n  \n__ __", "~~"]) expect(plainText(text)).toBe("");
});

test("ids with underscores and words with no markers are left as they are", () => {
  expect(plainText("t_27363156 확인함")).toBe("t_27363156 확인함");
  expect(plainText("첫 화면 문구를 짧게 고쳤어요.")).toBe("첫 화면 문구를 짧게 고쳤어요.");
});

// lina-app#218, #226: plainText takes markers out and nothing else: a list's lead-in line stays its own line, never joined
// to its first item (the sentence rule draws no lead-in), and no line is cut.
test.each([
  ["가짜 결과:", "가짜 결과:"],
  ["가짜 결과:\n\n- 가짜 빌드 통과.", "가짜 결과:\n- 가짜 빌드 통과."],
  ["가짜 결과:\n- 가짜 빌드 통과.\n- 가짜 시험 통과.\n- 가짜 화면 확인.", "가짜 결과:\n- 가짜 빌드 통과.\n- 가짜 시험 통과.\n- 가짜 화면 확인."],
  ["가짜 순서:\n가짜 바닥:\n1) 가짜 스키마.", "가짜 순서:\n가짜 바닥:\n1) 가짜 스키마."],
  ["가짜 주소는 http://fake.example.test 이다", "가짜 주소는 http://fake.example.test 이다"],
])("plainText(%j) keeps every line as written: %j (lina-app#218, #226)", (text, shown) => {
  expect(plainText(text)).toBe(shown);
});
