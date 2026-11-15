import { expect, test, type Page } from "@playwright/test";
import { EVENTS_PATH, routePath, USAGE_RANGES, type RouteName, type UsageRow, type UsageView } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";

// lina-app#178: UI QA round 11. The hub's usage route serves its byModel and byMachine rows per account, so one model
// or machine comes back up to four times with different costs and tokens; and a check's line is an engine's English
// error. The synthetic scene is served through the core's client API in that shape, in made-up names, dark only.
test.use({ serviceWorkers: "block" });
const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];
/** How many account rows each range splits one model or machine into: today 2, 7 days 3, 30 days 4 (the hub's most). */
const SPLIT: Readonly<Record<string, number>> = { today: 2, "7d": 3, "30d": 4 };
const RANGE_WORD: Readonly<Record<string, string>> = { today: "오늘", "7d": "7일", "30d": "30일" };
/** An engine's English error, as a check's line comes from the hub; invented names. */
const ENGLISH_LINE = "hold: tool on node 0.2.2-rc.1 (trial): trial: ACP error: Internal error: turn failed: fake-route: no API key";
/** Product names and short abbreviations a Korean line may keep. */
const KEPT = /DeepSeek|OCX|API|PR|QA/g;

/** One row cut into `parts` account rows, the earlier ones larger, that add up to it again. */
function split(row: UsageRow, parts: number, index: number): UsageRow[] {
  const share = (value: number, part: number) => Math.floor((value * (parts - part)) / ((parts * (parts + 1)) / 2));
  const rows = Array.from({ length: parts }, (_, part) => {
    const input = share(row.tokens.input, part);
    const output = share(row.tokens.output, part);
    const cacheRead = share(row.tokens.cacheRead, part);
    return { ...row, account: `fake-account-${index}-${part}`, requests: 1, costUsd: row.costUsd === null ? null : Math.round(row.costUsd * 100 * ((parts - part) / ((parts * (parts + 1)) / 2))) / 100, tokens: { total: input + output + cacheRead, input, output, cacheRead } };
  });
  // The last row takes what the rounding left, so the rows add up to the original row exactly.
  const last = rows[parts - 1];
  const sum = (pick: (each: UsageRow) => number) => rows.slice(0, -1).reduce((total, each) => total + pick(each), 0);
  const input = row.tokens.input - sum((each) => each.tokens.input);
  const output = row.tokens.output - sum((each) => each.tokens.output);
  const cacheRead = row.tokens.cacheRead - sum((each) => each.tokens.cacheRead);
  rows[parts - 1] = { ...last, costUsd: row.costUsd === null ? null : Math.round((row.costUsd - sum((each) => each.costUsd ?? 0)) * 100) / 100, tokens: { total: input + output + cacheRead, input, output, cacheRead } };
  return rows;
}

/** The range as the hub serves it: each row split per account, the accounts of one model interleaved with the others. */
function perAccount(view: UsageView): UsageView {
  const parts = SPLIT[view.range];
  const spread = (rows: readonly UsageRow[]) => {
    const pieces = rows.map((row, index) => split(row, parts, index));
    return Array.from({ length: parts }, (_, part) => pieces.map((each) => each[part])).flat();
  };
  return { ...view, byModel: spread(view.byModel), byMachine: spread(view.byMachine) };
}

async function serveCore(page: Page, served: Map<string, UsageView>): Promise<void> {
  const at = Math.floor(Date.now() / 1000) - 20 * 60;
  const scene = new SyntheticSource().scene;
  const checks = { ...scene.checks, checks: [{ name: "fake-check", ok: false, line: ENGLISH_LINE, at, staleAfter: 3600, stale: false, state: "failing" as const, file: "fake-check.json" }, ...scene.checks.checks] };
  const source = new SyntheticSource({ scene: { ...scene, checks } });
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), result.data);
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind !== "data") continue;
    const view = perAccount(result.data as UsageView);
    served.set(range, view);
    bodies.set(routePath("usage", range), view);
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    const body = bodies.get(`${url.pathname}${url.search}`) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket((url) => url.pathname === EVENTS_PATH, (socket) => socket.send(JSON.stringify({ cursor: "c1", events: [] })));
}

/** What the panel should read for one list: one line per name, its rows' costs added, costliest first. */
function merged(rows: readonly UsageRow[], nameOf: (row: UsageRow) => string | null | undefined): Map<string, number> {
  const costs = new Map<string, number>();
  for (const row of rows) {
    const name = nameOf(row);
    if (name) costs.set(name, (costs.get(name) ?? 0) + (row.costUsd ?? 0));
  }
  return costs;
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "wide", "dark only: the phone and the wide window are driven dark");
  await page.emulateMedia({ colorScheme: "dark" });
});

test("the usage panel draws one line per model and machine, each the sum of its account rows", async ({ page }, info) => {
  const served = new Map<string, UsageView>();
  await serveCore(page, served);
  await page.goto("/app/#/status");
  const panel = page.getByTestId("section-usage");
  await expect(panel.locator(".usage-row").first()).toBeVisible();
  const width = page.viewportSize()?.width ?? 0;
  for (const range of USAGE_RANGES) {
    await panel.getByRole("button", { name: RANGE_WORD[range] }).click();
    await expect(panel.getByRole("button", { name: RANGE_WORD[range] })).toHaveAttribute("aria-pressed", "true");
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: info.outputPath(`usage-${range}-${width}.png`) });
    const view = served.get(range) as UsageView;
    const lists = panel.locator("ul");
    for (const [index, costs] of [merged(view.byModel, (row) => row.model), merged(view.byMachine, (row) => row.machine)].entries()) {
      const lines = await lists.nth(index).locator(".usage-row .title").allTextContents();
      const names = lines.map((line) => line.split(" · ")[0]);
      expect(new Set(names).size, `${range}: ${lines.join(" | ")}`).toBe(names.length);
      const expected = [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      expect(names).toEqual(expected.map(([name]) => name));
      for (const [line, [, cost]] of lines.map((line, at) => [line, expected[at]] as const)) expect(line.split(" · ")[1]).toBe(`$${cost.toFixed(2)}`);
    }
  }
});

test("a check whose line is English reads its Korean line only, with no 자세히", async ({ page }, info) => {
  await serveCore(page, new Map());
  await page.goto("/app/#/status");
  const checks = page.getByRole("list", { name: "점검" });
  await expect(checks.locator(".status-check-row").first()).toBeVisible();
  await checks.scrollIntoViewIfNeeded();
  await page.getByTestId("section-usage").locator("..").screenshot({ path: info.outputPath(`checks-${page.viewportSize()?.width ?? 0}.png`) });
  await expect(checks.getByText("자세히")).toHaveCount(0);
  await expect(checks.locator("details")).toHaveCount(0);
  const text = (await checks.textContent()) ?? "";
  expect(text.replace(KEPT, "")).not.toMatch(/[A-Za-z]/);
});
