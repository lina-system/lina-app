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
