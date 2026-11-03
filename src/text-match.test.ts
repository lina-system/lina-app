import { expect, test } from "vitest";
import { containsText } from "./text-match";

test("a label is matched as text, its regex characters included", () => {
  const label = "배포 (금요일?) 3.5 * 2 \\ 끝";
  expect(containsText(label)(`민 · ${label} · 질문`)).toBe(true);
  expect(containsText("(금요일?)")("배포 (금요일?) 3.5")).toBe(true);
  expect(containsText("3.5")("335")).toBe(false);
  expect(containsText("요일?")("요일")).toBe(false);
  expect(containsText("2 *")("2 ")).toBe(false);
  expect(containsText("\\ 끝")("\\ 끝")).toBe(true);
  expect(containsText("\\ 끝")(" 끝")).toBe(false);
});
