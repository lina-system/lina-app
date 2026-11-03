import { expect, test } from "vitest";
import type { CardRow } from "../model";
import { cardTime } from "./parts";

const base: CardRow = { key: "card:x", kind: "card", work: "code", id: "x", href: "#/cards/x", title: null, name: "코드 작업", agent: null, state: "planned", reason: null, startedAt: null, stateAt: 1_000, endedAt: null, totalSeconds: null, now: null, result: null, progress: null, todo: null };

test("a planned card shows no time beside it: no running timer and no age", () => {
  expect(cardTime(base, 1_000 + 30 * 60)).toBe("");
  expect(cardTime({ ...base, startedAt: 500 }, 1_000 + 30 * 60)).toBe("");
  expect(cardTime({ ...base, state: "in_progress", startedAt: 1_000, stateAt: null }, 1_000 + 30 * 60)).toBe("30분째");
});
