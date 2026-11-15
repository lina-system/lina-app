import { expect, test, type Page } from "@playwright/test";
import { agentTalkPath, EVENTS_PATH, routePath, USAGE_RANGES, type ItemSummary, type RouteName } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";
import { stripTop } from "./strip";

// lina-app#162: an agent with 28 goals, read through the core's client API (not `?source=synthetic`) in the shapes the
// synthetic scene serves, the way the live hub answers. The first agent's two goals get 26 more, each a made-up title.
const GOAL_ROWS = 28;
// The app's service worker would fetch past page.route once it takes the page.
test.use({ serviceWorkers: "block" });
const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];

async function serveCore(page: Page): Promise<void> {
  const source = new SyntheticSource();
  const items = source.scene.items.items as ItemSummary[];
  const first = items.find((item) => item.kind === "goal" && item.agent === "ag-1")!;
  const mine = items.filter((item) => item.kind === "goal" && item.agent === "ag-1").length;
  for (let index = 0; index < GOAL_ROWS - mine; index += 1) {
    const words = ["검토 목록 정리", "배포 순서 맞추기", "문서 사이트 첫 화면 손보기", "알림 문구 다듬기와 설정 화면의 남은 항목 옮기기"];
    items.push({ ...first, id: `GX${index + 1}`, title: `${words[index % words.length]} ${index + 1}단계`, state: index % 3 ? "in_progress" : "waiting", reason: index % 3 ? null : "review", due: null });
  }
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), result.data);
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind === "data") bodies.set(routePath("usage", range), result.data);
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    if (url.pathname === agentTalkPath("ag-1")) return route.fulfill({ json: { agent: "ag-1", session_id: null, messages: [] } });
    if (url.pathname.startsWith("/api/lina/agents/")) return route.fulfill({ json: { agent: "", session_id: null, messages: [] } });
    const body = bodies.get(path) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket((url) => url.pathname === EVENTS_PATH, (socket) => socket.send(JSON.stringify({ cursor: "c1", events: [] })));
}

test("on a phone the 28 goals of an open card scroll in their own region, which ends above the field and the strip", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await serveCore(page);
  await page.goto("/app/#/talk/ag-1");
  await expect(page.getByTestId("agent-talk")).toBeVisible();
  const card = page.getByTestId("agent-card");
  await card.getByRole("button").first().click();
  await expect(card.locator(".goal-row")).toHaveCount(GOAL_ROWS);
  const region = card.locator(".agent-card-body");
  const sizes = await region.evaluate((body) => ({ overflow: getComputedStyle(body).overflowY, scroll: body.scrollHeight, client: body.clientHeight }));
  expect(["auto", "scroll"]).toContain(sizes.overflow);
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  const bottom = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
  const box = (await region.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(await bottom(".agent-talk-form"));
  expect(box.y + box.height).toBeLessThanOrEqual(await stripTop(page));
  // Scrolled to its end inside the region, the screen not moved: the last row is the element at its centre.
  await region.evaluate((body) => (body.scrollTop = body.scrollHeight));
  expect(await page.locator(".phone-main").evaluate((main) => main.scrollTop)).toBe(0);
  const last = card.locator(".goal-row").last();
  const hit = async () =>
    last.evaluate((row) => {
      const rect = row.getBoundingClientRect();
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return at !== null && row.contains(at);
    });
  expect(await hit()).toBe(true);
  // A row brought into view the way a focus move does lands the same way.
  await region.evaluate((body) => (body.scrollTop = 0));
  await last.evaluate((row) => row.scrollIntoView({ block: "end" }));
  expect(await hit()).toBe(true);
  await page.screenshot({ path: info.outputPath("talk-goals-390.png") });
});
