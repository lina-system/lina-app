import { expect, test } from "vitest";
import { ago, duration, total, until } from "./time";
import * as words from "./words";

// The phrases the owner's table rules out (lina-app#92, #123, #125), as they can appear inside a longer line.
const BANNED = [...words.BANNED_WORDS, "준 기다림", "멈춤", "막힘", "끝", "샌 것", "심박", "작업 마침", "소식이 끊김", "오래됨", "검토 반려", "OCX", /\d+\s*(?:분|시간|일)째/];
const ARGS: unknown[][] = [[3, 2, 1, 0], ["가", "나", "다"], [3, ["가"]], ["가", 3], [3, "가"]];

/** Every string a value of words.ts can give: its own text, each field, and each function's line over sample arguments. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function")
    return ARGS.flatMap((args) => {
      try {
        return strings(value(...args));
      } catch {
        return [];
      }
    });
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("words.ts and the time line builders carry no banned phrase", () => {
  const { BANNED_WORDS: _list, ...shown } = words;
  const lines = [...strings(shown), ...[30, 59 * 60, 3 * 3600, 2 * 86400].flatMap((seconds) => [duration(seconds), ago(seconds), total(seconds), until(seconds)])];
  expect(lines.length).toBeGreaterThan(300);
  const found = lines.filter((line) => BANNED.some((word) => (typeof word === "string" ? line.includes(word) : word.test(line))));
  expect([...new Set(found)]).toEqual([]);
});

test("a running row counts from its start with words from the table: 시작 n분 전", () => {
  expect(duration(30)).toBe("시작 1분 전");
  expect(duration(12 * 60)).toBe("시작 12분 전");
  expect(duration(3 * 3600 + 5)).toBe("시작 3시간 전");
  expect(duration(2 * 86400)).toBe("시작 2일 전");
});
