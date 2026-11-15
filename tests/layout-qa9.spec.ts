import { expect, test, type Page } from "@playwright/test";
import { EVENTS_PATH, routePath, USAGE_RANGES, type RouteName } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";

// lina-app#172: UI QA round 9. The hub's done conditions run up to 90 characters, so the synthetic scene is served
// through the core's client API with every goal title and done condition made as long, in made-up words. At 390 a goal's
// condition wraps (lina-app#167) and the driver's row check must agree that nothing is cut; 상태 has the 메뉴 the other
// tabs have.
test.use({ serviceWorkers: "block", colorScheme: "dark" });
test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");

const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];
const LONGER = " 그리고 휴대폰 폭과 넓은 창에서 같은 순서로 다시 확인하기";
const LONG_KEYS = new Set(["title", "doneCondition"]);
const VERIFY = "../.agents/skills/verify-lina-app/scripts/verify.mjs";

function lengthen(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lengthen);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, LONG_KEYS.has(key) && typeof field === "string" && field.length > 3 ? `${field}${LONGER}` : lengthen(field)]));
}

async function serveCore(page: Page): Promise<void> {
  const source = new SyntheticSource();
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), lengthen(result.data));
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind === "data") bodies.set(routePath("usage", range), result.data);
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    const body = bodies.get(`${url.pathname}${url.search}`) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket((url) => url.pathname === EVENTS_PATH, (socket) => socket.send(JSON.stringify({ cursor: "c1", events: [] })));
}

async function rowLines(page: Page): Promise<string[]> {
  const driver = (await import(VERIFY)) as { rowLines: (page: Page) => Promise<string[]> };
  return driver.rowLines(page);
}

test("a goal's wrapped done condition is no defect for the driver, and a cut one still is", async ({ page }, info) => {
  await serveCore(page);
  await page.goto("/app/#/goals");
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  const conditions = page.locator(".goal-row .sub");
  await expect(conditions.first()).toBeVisible();
  const lines = await conditions.evaluateAll((all) => all.map((sub) => sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight)));
  expect(Math.max(...lines)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("goals-wrapped-390.png") });
  expect(await rowLines(page)).toEqual([]);
  await conditions.first().evaluate((sub) => Object.assign((sub as HTMLElement).style, { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }));
  expect((await rowLines(page)).filter((line) => line.endsWith("(cut)"))).toHaveLength(1);
});

test("상태 opens the 메뉴 the other tabs have, and 설정 is in it", async ({ page }, info) => {
  await serveCore(page);
  await page.goto("/app/#/status");
  await expect(page.getByRole("list", { name: "기기", exact: true })).toBeVisible();
  const menuButton = page.getByRole("button", { name: "메뉴" });
  await expect(menuButton).toBeVisible();
  const box = await menuButton.boundingBox();
  expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath("status-head-390.png") });
  await menuButton.click();
  const menu = page.getByRole("dialog", { name: "메뉴" });
  await expect(menu.getByTestId("nav-inbox")).toBeVisible();
  await expect(menu.getByTestId("nav-settings")).toBeVisible();
  await page.screenshot({ path: info.outputPath("status-menu-390.png") });
  await menu.getByTestId("nav-settings").getByRole("link").click();
  await expect(page).toHaveURL(/#\/settings$/);
});
