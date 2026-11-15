import { expect, test } from "vitest";
import type { UsageRow } from "../api/client";
import { generateScene, SYNTHETIC_SEED } from "../fixtures/synthetic";
import { W } from "../words";
import { ocxView, usageRangeView, usageViews } from "./usage";

const NOW = 1_793_700_000;
const scene = generateScene(SYNTHETIC_SEED, { now: NOW });

test("tokens read 만 from ten thousand and 억 from a hundred million, grouped digits under that", () => {
  expect(W.tokens(12_480)).toBe("1.2만");
  expect(W.tokens(340_000_000)).toBe("3.4억");
  expect(W.tokens(8_640)).toBe("8,640");
  expect(W.tokens(10_000)).toBe("1만");
  expect(W.tokens(420_000)).toBe("42만");
  expect(W.tokens(0)).toBe("0");
});

test("a cost keeps two decimals under $100 and drops them from it, rounding the last one", () => {
  expect(W.cost(3.456)).toBe("$3.46");
  expect(W.cost(0.5)).toBe("$0.50");
  expect(W.cost(99.99)).toBe("$99.99");
  expect(W.cost(99.996)).toBe("$100");
  expect(W.cost(128.4)).toBe("$128");
  expect(W.cost(null)).toBe("—");
});

test("each range keeps the costliest five rows, a row OCX priced none of last", () => {
  const base = { requests: 1, tokens: { total: 1000, input: 1000, output: 0, cacheRead: 0 } };
  const row = (model: string, costUsd: number | null): UsageRow => ({ ...base, model, provider: "openai", costUsd });
  const view = usageRangeView({
    version: 1,
    at: NOW,
    range: "today",
    generatedAt: NOW,
    requests: 6,
    tokens: base.tokens,
    costUsd: 15,
    byModel: [row("a", 1), row("b", null), row("c", 5), row("d", 4), row("e", 3), row("f", 2)],
    byProvider: [],
    byAccount: [],
    byMachine: [],
  });
  expect(view?.models.map((line) => line.name)).toEqual(["c", "d", "e", "f", "a"]);
});

// lina-app#178: the hub serves byModel and byMachine per account, so one model or machine comes back more than once.
test("rows of one model or one machine read as one line, their costs and tokens added, ranked by the sum", () => {
  const tokens = (total: number) => ({ total, input: total, output: 0, cacheRead: 0 });
  const model = (name: string, costUsd: number | null, total: number, account: string): UsageRow => ({ requests: 1, tokens: tokens(total), model: name, provider: "anthropic", account, costUsd });
  const machine = (name: string, costUsd: number | null, total: number): UsageRow => ({ requests: 1, tokens: tokens(total), machine: name, costUsd });
  const view = usageRangeView({
    version: 1,
    at: NOW,
    range: "today",
    generatedAt: NOW,
    requests: 9,
    tokens: tokens(0),
    costUsd: 9,
    byModel: [model("b", 1.5, 100, "x1"), model("a", 1.2, 300, "x1"), model("c", 1.1, 10, "x1"), model("d", 1, 10, "x1"), model("e", 0.9, 10, "x1"), model("a", 0.9, 200, "x2"), model("f", 0.8, 10, "x1"), model("g", null, 5, "x1"), model("g", null, 7, "x2")],
    byProvider: [],
    byAccount: [],
    byMachine: [machine("m1", 0.5, 40), machine("m2", 0.7, 50), machine("m1", 0.4, 60), machine("m3", null, 1), machine("m3", 0.2, 2)],
  });
  expect(view?.models).toEqual([
    { name: "a", cost: expect.closeTo(2.1), tokens: 500 },
    { name: "b", cost: 1.5, tokens: 100 },
    { name: "c", cost: 1.1, tokens: 10 },
    { name: "d", cost: 1, tokens: 10 },
    { name: "e", cost: 0.9, tokens: 10 },
  ]);
  expect(view?.machines).toEqual([
    { name: "m1", cost: expect.closeTo(0.9), tokens: 100 },
    { name: "m2", cost: 0.7, tokens: 50 },
    { name: "m3", cost: 0.2, tokens: 3 },
  ]);
  // A model OCX priced none of in every row stays unpriced.
  const unpriced = usageRangeView({ ...scene.usage.today, byModel: [model("g", null, 5, "x1"), model("g", null, 7, "x2")] });
  expect(unpriced?.models).toEqual([{ name: "g", cost: null, tokens: 12 }]);
});

test("the scene's three ranges come back in the screen's order", () => {
  const ranges = usageViews(scene.usage);
  expect(ranges.map((view) => view.range)).toEqual(["today", "7d", "30d"]);
  expect(ranges[0]).toMatchObject({ cost: 3.42, tokens: 12_480 });
  expect(ranges[1]).toMatchObject({ cost: 18.4, tokens: 86_400 });
  expect(usageViews(undefined)).toEqual([]);
});

test("OCX's view names only the links that are down, by the 기기 panel's own machine names", () => {
  const down = scene.devices.machines.find((machine) => machine.state === "down")?.name;
  expect(ocxView(scene.modelsState)).toEqual({ enabled: 3, down: [down] });
  const allOk = { ...scene.modelsState, machines: scene.modelsState.machines.map((link) => ({ ...link, ok: true })) };
  expect(ocxView(allOk)).toEqual({ enabled: 3, down: [] });
  expect(ocxView(undefined)).toBeNull();
});
