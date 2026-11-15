import { expect, test, type Page } from "@playwright/test";
import { agentTalkPath, EVENTS_PATH, routePath, USAGE_RANGES, type ItemSummary, type RouteName } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";

// lina-app#167: UI QA round 8. The hub's titles, done conditions and decision questions run long (a done condition up
// to 90 characters), so the synthetic scene is served through the core's client API with every title, question and done
// condition made as long, in made-up words. At 1280 the 대화 goal pane is about 320 px and a list beside an open detail
// about 380 px: nothing there is cut. At 390 the 대화 field bar is opaque and the 대화 list has the 메뉴 the other tabs have.
test.use({ serviceWorkers: "block" });
const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];
const DETAIL_ROUTES: readonly RouteName[] = ["item", "goal", "card"];
const LONGER = " 그리고 휴대폰 폭과 넓은 창에서 같은 순서로 다시 확인하기";
/** Where one line is the design and the rest is a tap away (talk-tab.md): an agent row's last message. */
const ONE_LINE_BY_DESIGN = ".talk-preview";
const LONG_KEYS = new Set(["title", "text", "doneCondition", "goalTitle"]);

/** Every title, question and done condition in a read made as long as the hub's. */
function lengthen(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lengthen);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, LONG_KEYS.has(key) && typeof field === "string" && field.length > 3 ? `${field}${LONGER}` : lengthen(field)]));
}

/** The hub's runner-sync check as it served it (lina-app#160): its Korean line is the longest the 점검 panel draws. */
const RUNNER_SYNC =
  'hold: dsh on hub 0.2.2-rc.1 (trial): trial: ACP error: Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Mo';

async function serveCore(page: Page): Promise<void> {
  const at = Math.floor(Date.now() / 1000) - 20 * 60;
  const scene = new SyntheticSource().scene;
  const checks = { ...scene.checks, checks: [{ name: "runner-sync", ok: false, line: RUNNER_SYNC, at, staleAfter: 172800, stale: false, state: "failing" as const, file: "runner-sync.json" }, ...scene.checks.checks] };
  const source = new SyntheticSource({ scene: { ...scene, checks } });
  const items = source.scene.items.items as ItemSummary[];
  const first = items.find((item) => item.kind === "goal" && item.agent === "ag-1")!;
  for (let index = 0; index < 6; index += 1) items.push({ ...first, id: `GX${index + 1}`, title: `문서 사이트 첫 화면 손보기 ${index + 1}단계`, due: null });
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), lengthen(result.data));
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind === "data") bodies.set(routePath("usage", range), result.data);
  }
  const history = await source.agentTalkHistory("ag-1");
  if (history.kind !== "data") throw new Error("no synthetic history");
  const said = history.data.messages;
  const turns = { ...history.data, messages: Array.from({ length: 12 }, (_, index) => ({ ...said[index % said.length] })) };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    if (url.pathname === agentTalkPath("ag-1")) return route.fulfill({ json: turns });
    if (url.pathname.startsWith("/api/lina/agents/")) return route.fulfill({ json: { agent: "", session_id: null, messages: [] } });
    for (const name of DETAIL_ROUTES) {
      const prefix = routePath(name, "");
      const id = url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : "";
      if (!id || id.includes("/")) continue;
      const result = await source.read(name, id);
      if (result.kind === "data") return route.fulfill({ json: lengthen(result.data) });
    }
    const body = bodies.get(path) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket((url) => url.pathname === EVENTS_PATH, (socket) => socket.send(JSON.stringify({ cursor: "c1", events: [] })));
}

/**
 * Elements that hide text past their box: overflow hidden or clipped, holding more than they show, with a text line
 * running past the box (a list's 100vw divider is trimmed by its list on purpose and is not text).
 */
async function cutText(page: Page): Promise<string[]> {
  return page.evaluate((ONE_LINE) =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !element.closest(".visually-hidden") && !element.closest(ONE_LINE) && element.getClientRects().length > 0)
      .filter((element) => {
        const style = getComputedStyle(element);
        const hides = (value: string) => value === "hidden" || value === "clip";
        const wide = hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
        const tall = hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        if (!wide && !tall) return false;
        const box = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || (node.parentElement && getComputedStyle(node.parentElement).visibility === "hidden")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) if ((wide && rect.right > box.right + 1) || (tall && rect.bottom > box.bottom + 1)) return true;
        }
        return false;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}: ${element.textContent?.slice(0, 40)}`),
    ONE_LINE_BY_DESIGN,
  );
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  await expect(page.getByTestId("detail-loading")).toHaveCount(0);
}

test.describe("at 1280", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "wide layout only");

  test("nothing is cut in the 대화 goal pane", async ({ page }, info) => {
    await serveCore(page);
    await page.goto("/app/#/talk/ag-1");
    await expect(page.getByTestId("agent-card").locator(".goal-row").first()).toBeVisible();
    await settled(page);
    await page.screenshot({ path: info.outputPath("talk-1280.png") });
    expect(await cutText(page)).toEqual([]);
  });

  test("nothing is cut in 수신함 beside an open decision", async ({ page }, info) => {
    await serveCore(page);
    await page.goto("/app/#/inbox");
    const decisions = page.getByRole("list", { name: "결정 필요" });
    await decisions.getByRole("link").first().click();
    await expect(page.getByTestId("detail-pane")).toBeVisible();
    await settled(page);
    await page.screenshot({ path: info.outputPath("inbox-open-1280.png") });
    expect(await cutText(page)).toEqual([]);
  });

  test("nothing is cut in 작업 lists beside an open detail", async ({ page }, info) => {
    await serveCore(page);
    const cut: string[] = [];
    for (const [list, hash] of [
      ["home", "#/"],
      ["goals", "#/goals"],
      ["due", "#/due"],
      ["running", "#/running"],
    ] as const) {
      await page.goto(`/app/${hash}`);
      await page.locator(".list-pane").locator("a[href^='#/cards/'], a[href^='#/items/'], a[href^='#/goals/']").first().click();
      await expect(page.getByTestId("detail-pane")).toBeVisible();
      await settled(page);
      await page.screenshot({ path: info.outputPath(`${list}-open-1280.png`) });
      cut.push(...(await cutText(page)).map((line) => `${list}: ${line}`));
    }
    expect(cut).toEqual([]);
  });
});

test.describe("at 390", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");
  test.use({ colorScheme: "dark" });

  test("the 대화 field bar is opaque over the turns, with the goal list open", async ({ page }, info) => {
    await serveCore(page);
    await page.goto("/app/#/talk/ag-1");
    await expect(page.getByTestId("talk-mine").first()).toBeVisible();
    await page.getByTestId("agent-card").getByRole("button").first().click();
    // No line under the field any more (lina-app#187): the field itself is what a turn scrolled under must not cover.
    const why = page.getByTestId("agent-talk").getByRole("textbox", { name: "메시지" });
    await expect(why).toBeVisible();
    await page.screenshot({ path: info.outputPath("talk-composer-390.png") });
    const form = page.locator(".agent-talk-form");
    expect(await form.evaluate((bar) => getComputedStyle(bar).backgroundColor)).not.toMatch(/rgba\(.*, 0(\.\d+)?\)|transparent/);
    // Whatever scroll the turns are at, the field's middle and both ends of its line are the field.
    for (const at of ["start", "end"] as const) {
      await page.locator(".phone-main").evaluate((main, end) => (main.scrollTop = end === "end" ? main.scrollHeight : 0), at);
      const hit = await why.evaluate((line) => {
        const rect = line.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        return [
          [rect.left + rect.width / 2, middle],
          [rect.left + rect.height / 2, middle],
          [rect.right - rect.height / 2, middle],
        ].every(([x, y]) => {
          const element = document.elementFromPoint(x, y);
          return element !== null && line.contains(element);
        });
      });
      expect(hit, at).toBe(true);
    }
  });

  test("the 점검 lines are not cut", async ({ page }, info) => {
    await serveCore(page);
    await page.goto("/app/#/status");
    const checks = page.getByRole("list", { name: "점검" });
    await expect(checks.getByText("실행기 업데이트 보류 · DeepSeek · API 키 없음")).toBeVisible();
    await settled(page);
    await checks.screenshot({ path: info.outputPath("status-checks-390.png") });
    expect(await cutText(page)).toEqual([]);
  });

  test("the 대화 list has the 메뉴 the 작업 tab has", async ({ page }, info) => {
    await serveCore(page);
    await page.goto("/app/#/");
    await expect(page.getByRole("button", { name: "메뉴" })).toBeVisible();
    await page.goto("/app/#/talk");
    await expect(page.getByTestId("talk-agents")).toBeVisible();
    await page.screenshot({ path: info.outputPath("talk-list-390.png") });
    await page.getByRole("button", { name: "메뉴" }).click();
    const menu = page.getByRole("dialog", { name: "메뉴" });
    await expect(menu.getByTestId("nav-inbox")).toBeVisible();
    await page.screenshot({ path: info.outputPath("talk-menu-open-390.png") });
    await menu.getByTestId("nav-inbox").click();
    await expect(page).toHaveURL(/#\/inbox$/);
  });
});
