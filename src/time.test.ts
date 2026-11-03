import { expect, test } from "vitest";
import { ago, until } from "./time";

test("how long ago reads 방금 under a minute, then minutes, then hours", () => {
  expect(ago(0)).toBe("방금");
  expect(ago(59)).toBe("방금");
  expect(ago(60)).toBe("1분 전");
  expect(ago(59 * 60)).toBe("59분 전");
  expect(ago(60 * 60)).toBe("1시간 전");
});

test("a reset reads in hours under a day and in days at or over a day", () => {
  expect(until(10 * 60)).toBe("1시간 후");
  expect(until(3 * 3600 - 5)).toBe("3시간 후");
  expect(until(24 * 3600 - 1)).toBe("24시간 후");
  expect(until(24 * 3600)).toBe("1일 후");
  expect(until(2 * 86400 - 30)).toBe("2일 후");
  expect(until(12 * 86400)).toBe("12일 후");
});
