import { expect, test, type Page } from "@playwright/test";
import { agentTalkPath, EVENTS_PATH, routePath, USAGE_RANGES, type RouteName, type UsageView } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";
import { LONG_TALK_TURNS, longTalk } from "./long-talk";

// lina-app#206: UI QA round 15, layout only. The core's client API (not `?source=synthetic`) serves the synthetic scene
// with a first agent whose app conversation is as long as the live hub's (tests/long-talk.ts) and a model row as long
// as the hub's: a provider/model id, no price (`—`) and a four-digit token count. Invented names.
test.use({ serviceWorkers: "block" });
const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];
/** A model id the shape of the hub's (`provider/name-size`), longer than the one the QA round found cut. */
const LONG_MODEL = "fake-provider/fake-embedding-model-8b";
const LONG_MODEL_TOKENS = "토큰 6,005";

async function serveCore(page: Page): Promise<void> {
  const source = new SyntheticSource();
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), result.data);
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind !== "data") continue;
    const view = result.data as UsageView;
    const row = { requests: 3, tokens: { total: 6005, input: 6005, output: 0, cacheRead: 0 }, costUsd: null, model: LONG_MODEL, provider: "fake-provider", account: "fake-account", machine: "fake-machine" };
    bodies.set(routePath("usage", range), { ...view, byModel: [...view.byModel, row] });
  }
  const history = longTalk("ag-1", Math.floor(Date.now() / 1000));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    if (url.pathname === agentTalkPath("ag-1")) return route.fulfill({ json: history });
    if (url.pathname.startsWith("/api/lina/agents/") && url.pathname.endsWith("/talk")) return route.fulfill({ json: { agent: "", session_id: null, messages: [] } });
    const body = bodies.get(`${url.pathname}${url.search}`) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket((url) => url.pathname === EVENTS_PATH, (socket) => socket.send(JSON.stringify({ cursor: "c1", events: [] })));
}

async function open(page: Page, hash: string): Promise<void> {
  await serveCore(page);
  await page.goto(`/app/${hash}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("");
}

/** The strip's box against the bar's bottom edge, and whether the strip is what the page draws at its toggle's centre. */
async function strip(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".navbar")!.getBoundingClientRect();
    const card = document.querySelector("[data-testid=agent-card]")!.getBoundingClientRect();
    const toggle = document.querySelector("[data-testid=agent-card] .agent-card-toggle")!;
    const box = toggle.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    // The gap between the bar's edge and the strip: nothing of the conversation shows through it.
    const gap = document.elementFromPoint(box.left + 4, bar.bottom + 2);
    return { gap: card.top - bar.bottom, top: card.top, bottom: card.bottom, onTop: Boolean(hit && toggle.contains(hit)), gapClear: !gap?.closest(".agent-talk-turns") };
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`phone ${colorScheme}`, () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");
    test.use({ colorScheme });

    test("a conversation three screens long keeps the 에이전트 · 목표 n strip under the bar, scrolled down and up", async ({ page }, info) => {
      await open(page, "#/talk/ag-1");
      await expect(page.getByTestId("talk-reply")).toHaveCount(LONG_TALK_TURNS);
      const main = page.locator(".phone-main");
      const size = await main.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight, top: element.scrollTop }));
      expect(size.scroll, "the conversation is at least three screens").toBeGreaterThanOrEqual(3 * size.client);
      // The window opens at the end of the conversation, the strip there under the bar.
      await expect.poll(() => main.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
      const where: Record<string, Awaited<ReturnType<typeof strip>>> = {};
      where.end = await strip(page);
      await page.screenshot({ path: info.outputPath(`strip-end-390-${colorScheme}.png`) });
      for (const [name, at] of [
        ["middle", 0.5],
        ["top", 0],
      ] as const) {
        await main.evaluate((element, share) => element.scrollTo(0, (element.scrollHeight - element.clientHeight) * share), at);
        where[name] = await strip(page);
      }
      await page.screenshot({ path: info.outputPath(`strip-top-390-${colorScheme}.png`) });
      // Back down to the end, then one scroll up as a thumb does it.
      await main.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await page.mouse.move(195, 500);
      await page.mouse.wheel(0, -200);
      await expect.poll(() => main.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeGreaterThan(100);
      where.up = await strip(page);
      await main.evaluate((element) => element.scrollTo(0, (element.scrollHeight - element.clientHeight) * 0.5));
      await page.screenshot({ path: info.outputPath(`strip-middle-390-${colorScheme}.png`) });
      for (const [name, look] of Object.entries(where)) {
        expect(look.onTop, `${name}: the strip is what the page draws at its centre`).toBe(true);
        expect(look.gap, `${name}: the strip stands under the bar's edge`).toBeGreaterThanOrEqual(8);
        expect(look.gap, `${name}: the strip stands under the bar's edge`).toBeLessThanOrEqual(12);
        expect(look.gapClear, `${name}: the conversation shows between the bar and the strip`).toBe(true);
      }
      // Opened mid-conversation, its goals show under its toggle, which stays where it was.
      await page.getByTestId("agent-card").getByRole("button").first().click();
      await expect(page.getByTestId("agent-card").locator("[data-testid=section-goals] [data-testid=row]").first()).toBeVisible();
      const opened = await strip(page);
      expect(opened.onTop).toBe(true);
      expect(Math.abs(opened.top - where.up.top)).toBeLessThan(1);
    });

    for (const width of [390, 360]) {
      test(`at ${width} no figure of a model row is cut`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 844 });
        await open(page, "#/status");
        const panel = page.getByTestId("section-usage");
        await expect(panel.locator(".usage-row").first()).toBeVisible();
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: info.outputPath(`usage-${width}-${colorScheme}.png`) });
        for (const range of USAGE_RANGES) {
          await panel.getByRole("button", { name: { today: "오늘", "7d": "7일", "30d": "30일" }[range] }).click();
          const rows = await panel.locator(".usage-row .title").evaluateAll((titles) =>
            titles.map((title) => {
              const box = title.getBoundingClientRect();
              const text = title.textContent ?? "";
              // Each figure (the cost, then the tokens) is laid out whole inside the line's box, on one line.
              const figures = text.split(" · ").slice(1).map((figure) => {
                const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
                const range = document.createRange();
                let seen = 0;
                const start = text.lastIndexOf(figure);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                  const length = node.textContent?.length ?? 0;
                  if (start >= seen && start < seen + length) range.setStart(node, start - seen);
                  if (start + figure.length > seen && start + figure.length <= seen + length) range.setEnd(node, start + figure.length - seen);
                  seen += length;
                }
                const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
                return { figure, inside: rects.every((rect) => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5), lines: new Set(rects.map((rect) => Math.round(rect.top))).size };
              });
              return { text, clipped: title.scrollWidth > title.clientWidth + 1 || getComputedStyle(title).textOverflow === "ellipsis", right: box.right, figures };
            }),
          );
          expect(rows.some((row) => row.text.startsWith(LONG_MODEL) && row.text.endsWith(LONG_MODEL_TOKENS))).toBe(true);
          for (const row of rows) {
            expect(row.clipped, `${range} ${row.text}`).toBe(false);
            expect(row.right, `${range} ${row.text}`).toBeLessThanOrEqual(width);
            for (const figure of row.figures) {
              expect(figure.inside, `${range} ${row.text}: ${figure.figure}`).toBe(true);
              expect(figure.lines, `${range} ${row.text}: ${figure.figure}`).toBe(1);
            }
          }
        }
      });
    }

    test("the conversation head picture stays 38 px", async ({ page }) => {
      await open(page, "#/talk/ag-1");
      const mark = (await page.locator(".navbar .talk-head > .mark").boundingBox())!;
      expect([mark.width, mark.height]).toEqual([38, 38]);
    });
  });
}

test.describe("wide", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, "wide layout only");

  test("the status tab draws 상태 once, the pressed tab, and nothing in the sidebar overlaps the tabs", async ({ page }, info) => {
    await open(page, "#/status");
    await expect(page.getByTestId("device-line")).toBeVisible();
    const look = await page.evaluate(() => {
      const shown = (element: Element) => {
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && getComputedStyle(element).visibility !== "hidden";
      };
      const named = [...document.querySelectorAll("body *")].filter((element) => shown(element) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "상태"));
      const tabs = document.querySelector("[data-testid=tabs]")!.getBoundingClientRect();
      const sidebar = [...document.querySelectorAll(".sidebar *")].filter((element) => shown(element) && element.children.length === 0 && element.textContent?.trim());
      const overlaps = sidebar.filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < tabs.right && box.right > tabs.left && box.top < tabs.bottom && box.bottom > tabs.top;
      });
      return { named: named.map((element) => element.getAttribute("data-testid") ?? element.className), overlaps: overlaps.length };
    });
    await page.screenshot({ path: info.outputPath(`status-head-1280-${info.project.name}.png`) });
    expect(look.named).toEqual(["tab-status"]);
    expect(look.overlaps).toBe(0);
    // The machines and 설정 stay one list named 상태.
    await expect(page.getByRole("list", { name: "상태" })).toBeVisible();
  });

  test("the conversation head picture is 36 px, centred in the toolbar", async ({ page }, info) => {
    await open(page, "#/talk/ag-1");
    const toolbar = (await page.locator(".toolbar").boundingBox())!;
    const mark = (await page.locator(".toolbar .talk-head > .mark").boundingBox())!;
    await page.screenshot({ path: info.outputPath(`talk-head-1280-${info.project.name}.png`) });
    expect([mark.width, mark.height]).toEqual([36, 36]);
    expect(mark.y - toolbar.y).toBeGreaterThanOrEqual(7);
    expect(toolbar.y + toolbar.height - (mark.y + mark.height)).toBeGreaterThanOrEqual(7);
  });
});
