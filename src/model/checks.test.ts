import { expect, test } from "vitest";
import type { StatusCheck, StatusChecks } from "../api/client";
import { checksView } from "./checks";

// The fold rule reads the core's state, never `ok` alone: stale wins over a passing check, and an error row is open.
const check = (name: string, state: StatusCheck["state"], at = 100): StatusCheck => ({
  name,
  ok: state === "ok",
  line: `${name} line`,
  at,
  staleAfter: 60,
  stale: state === "stale",
  state,
  file: `${name}.json`,
});

const view = (checks: StatusCheck[]): StatusChecks => ({ version: 1, at: 1_000, checks });

test("all checks passing fold into one count and leave no open row", () => {
  expect(checksView(view([check("a", "ok"), check("b", "ok")]))).toEqual({ open: [], ok: 2, total: 2 });
});

test("mixed checks keep only the failing and stale ones open, in the core's order", () => {
  const folded = checksView(view([check("a", "ok"), check("b", "failing"), check("c", "ok"), check("d", "stale"), check("e", "ok")]));
  expect(folded.ok).toBe(3);
  expect(folded.total).toBe(5);
  expect(folded.open.map((row) => [row.name, row.line, row.state, row.at])).toEqual([
    ["b", "b line", "failing", 100],
    ["d", "d line", "stale", 100],
  ]);
});

test("no checks at all is an empty panel, not a count of zero", () => {
  expect(checksView(undefined)).toEqual({ open: [], ok: 0, total: 0 });
  expect(checksView(view([]))).toEqual({ open: [], ok: 0, total: 0 });
});

test("an unreadable check is open and counts against nothing passing", () => {
  const folded = checksView(view([check("a", "ok"), check("b", "error")]));
  expect(folded).toMatchObject({ ok: 1, total: 2 });
  expect(folded.open).toEqual([{ key: "b.json:1", name: "b", line: "b line", state: "error", at: 100 }]);
});
