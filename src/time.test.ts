import { expect, test } from "vitest";
import { ago, clockAt, dateClock, timesInText, until } from "./time";

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

test("a round's time carries its day when that is not today: 어제 for yesterday, the date before that", () => {
  const now = new Date(2026, 10, 4, 0, 20).getTime() / 1000;
  expect(clockAt(new Date(2026, 10, 4, 0, 4).getTime() / 1000, now)).toBe("00:04");
  expect(clockAt(new Date(2026, 10, 3, 23, 41).getTime() / 1000, now)).toBe("어제 23:41");
  expect(clockAt(new Date(2026, 10, 1, 9, 10).getTime() / 1000, now)).toBe("11월 1일 09:10");
});

test("an ISO time written inside a text reads as the screens write a time: its date and time of day (lina-app#207)", () => {
  expect(dateClock(new Date(2026, 10, 16, 3, 30).getTime() / 1000)).toBe("11월 16일 03:30");
  // No offset: the device's own time, as written.
  expect(timesInText("안전망 =2026-11-16T03:30")).toBe("안전망 11월 16일 03:30");
  expect(timesInText("백업 2026-11-16T00:30:15 기준")).toBe("백업 11월 16일 00:30 기준");
  // An offset or Z: that instant on the device's clock.
  expect(timesInText("안전망 =2026-11-16T03:30+09:00")).toBe(`안전망 ${dateClock(Date.UTC(2026, 10, 15, 18, 30) / 1000)}`);
  expect(timesInText("백업 2026-11-16T00:30Z")).toBe(`백업 ${dateClock(Date.UTC(2026, 10, 16, 0, 30) / 1000)}`);
  // A key still there keeps its =; a date alone and text with no time stay as they are.
  expect(timesInText("UNTIL=2026-11-16T00:30")).toBe("UNTIL=11월 16일 00:30");
  expect(timesInText("2026-11-16 배포")).toBe("2026-11-16 배포");
  expect(timesInText("a=b 그대로")).toBe("a=b 그대로");
});
