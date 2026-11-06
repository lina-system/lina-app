import { mkdirSync } from "node:fs";
import { chromium, expect, test, type Page } from "@playwright/test";
import { TALK_FRAME_MS } from "../src/data/synthetic-source";

// Every screen on the synthetic scene, at 1280 (light and dark) and 390. The app is served under /app/
// like the core serves it (lina-system/lina#168).
const APP = "/app/?source=synthetic";

async function talk(page: Page, message: string): Promise<void> {
  const box = page.getByTestId("talk");
  await box.getByRole("textbox", { name: "메시지" }).fill(message);
  await box.getByRole("textbox", { name: "메시지" }).press("Enter");
}

// `clock`: the page's timers run only when the capture says, so a streaming reply is caught between two frames.
// `line`: the freshness line the screen is ready at (실시간 once the change stream is open).
const SCREENS: readonly { id: string; hash: string; query?: string; line?: string; wideOnly?: boolean; phoneOnly?: boolean; clock?: boolean; open?: (page: Page) => Promise<void> }[] = [
  { id: "menu", hash: "#/", phoneOnly: true },
  { id: "inbox", hash: "#/inbox" },
  { id: "live-stale", hash: "#/inbox", query: "&live=down", line: "갱신 지연" },
  { id: "running", hash: "#/running" },
  { id: "due", hash: "#/due" },
  { id: "done", hash: "#/done" },
  { id: "agent", hash: "#/agents/ag-2" },
  { id: "goals", hash: "#/goals" },
  { id: "goal-detail", hash: "#/goals/G2" },
  { id: "goal-done", hash: "#/goals/G4" },
  { id: "item-detail", hash: "#/items/T4" },
  {
    id: "item-comment",
    hash: "#/items/T4",
    open: async (page) => {
      await page.getByRole("textbox", { name: "댓글 달기" }).fill("휴대폰 가로 화면도 봐 주세요");
      await page.getByTestId("comments").getByRole("button", { name: "보내기", exact: true }).click();
      await expect(page.getByTestId("comment-pending")).toHaveText(/에게 보냄 · 방금$/);
    },
  },
  {
    id: "talk-streaming",
    hash: "#/items/T4",
    clock: true,
    open: async (page) => {
      await page.clock.pauseAt(new Date(Date.now() + 60_000));
      await talk(page, "입력 폼 간격 봐 주세요");
      await page.clock.runFor(TALK_FRAME_MS * 5);
      await expect(page.getByTestId("talk-live")).toBeAttached();
      await expect(page.getByTestId("talk-reply")).toContainText("입력 폼 간격부터");
      await page.getByTestId("talk").scrollIntoViewIfNeeded();
    },
  },
  {
    id: "talk-replied",
    hash: "#/items/T4",
    open: async (page) => {
      await talk(page, "입력 폼 간격 봐 주세요");
      await expect(page.getByTestId("talk-carried")).toHaveText(/ 대화에 남음$/, { timeout: 10_000 });
      await expect(page.getByTestId("talk-live")).toHaveCount(0);
    },
  },
  {
    id: "talk-refused",
    hash: "#/items/T4",
    query: "&talk=busy",
    open: async (page) => {
      await talk(page, "입력 폼 간격 봐 주세요");
      await expect(page.getByTestId("talk").getByTestId("write-error")).toHaveText("에이전트가 바쁨");
      await expect(page.getByTestId("talk").getByRole("textbox", { name: "메시지" })).toHaveValue("입력 폼 간격 봐 주세요");
    },
  },
  { id: "item-decision", hash: "#/items/T2" },
  { id: "goal-decision", hash: "#/goals/G3" },
  { id: "card-question", hash: "#/cards/k-102" },
  { id: "card-detail", hash: "#/cards/k-101" },
  // The home with the writer of the checked lines stopped (lina#151); card-question above is the card with none.
  { id: "summaries-stopped", hash: "#/running", query: "&writer=stopped" },
  // 완료 filtered to one agent in its address, and a card whose comments fold.
  { id: "done-filtered", hash: "#/done?agent=ag-1" },
  { id: "card-comment-folded", hash: "#/cards/k-103" },
  // An agent with a card just created: 예정 after 검토 필요, no time beside it.
  { id: "agent-planned", hash: "#/agents/ag-3" },
  // The run's own timeline on a card, scrolled to it.
  {
    id: "card-timeline",
    hash: "#/cards/k-101",
    open: async (page) => {
      await expect(page.getByTestId("timeline")).toBeVisible();
      await page.getByTestId("timeline").scrollIntoViewIfNeeded();
    },
  },
  { id: "run-detail", hash: "#/runs/r6" },
  { id: "status", hash: "#/status" },
  {
    id: "status-accounts",
    hash: "#/status",
    open: async (page) => {
      await page.getByRole("list", { name: "쿼터", exact: true }).locator("summary").first().click();
      await expect(page.getByTestId("account").first()).toBeVisible();
    },
  },
  {
    id: "safe-area",
    hash: "#/cards/k-101",
    phoneOnly: true,
    open: async (page) => {
      // An iPhone's status bar and home indicator, through the tokens the page reads from env().
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-top", "47px");
        document.documentElement.style.setProperty("--safe-bottom", "34px");
      });
    },
  },
  { id: "read-failed", hash: "#/inbox", query: "&error=quota" },
  {
    id: "decision-open",
    hash: "#/inbox",
    open: async (page) => {
      const rows = page.getByRole("list", { name: "결정 필요" }).locator(".row-button");
      await rows.nth(0).click();
      await rows.nth(1).click();
      await expect(page.getByRole("button", { name: /추천$/ })).toBeVisible();
      await expect(page.getByTestId("waiting-on")).toBeVisible();
    },
  },
  {
    id: "answered-toast",
    hash: "#/inbox",
    open: async (page) => {
      await page.getByRole("list", { name: "결정 필요" }).locator(".row-button").first().click();
      await page.getByRole("button", { name: /추천$/ }).click();
      await expect(page.getByTestId("toast")).toHaveText(/^답함/);
    },
  },
  {
    id: "done-toast",
    hash: "#/goals/G2",
    open: async (page) => {
      await page.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" }).click();
      await expect(page.getByRole("checkbox", { name: "결제 실패 화면 검토 완료됨" })).toBeVisible();
      await expect(page.getByTestId("toast")).toHaveText(/^완료로 표시함/);
    },
  },
  {
    id: "goal-with-open",
    hash: "#/goals/G1",
    open: async (page) => {
      await page.getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }).click();
      await expect(page.getByTestId("with-open")).toBeVisible();
    },
  },
  { id: "running-stopped-only", hash: "#/running", query: "&running=none" },
  {
    id: "done-held",
    hash: "#/inbox",
    open: async (page) => {
      await page.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).click();
      await page.waitForFunction(() => (window as unknown as { __linaScene: { itemDetails: Record<string, { state: string }> } }).__linaScene.itemDetails.T3.state === "done");
      await expect(page.getByRole("checkbox", { name: "공지 문구 확인 완료됨" })).toBeVisible();
    },
  },
  {
    id: "retry-requested",
    hash: "#/running",
    open: async (page) => {
      await page.getByTestId("retry").click();
      await expect(page.getByTestId("retry-requested")).toBeVisible();
    },
  },
  {
    id: "bell",
    hash: "#/inbox",
    open: async (page) => {
      await page.getByTestId("bell").click();
      await expect(page.getByTestId("notices")).toBeVisible();
    },
  },
];

function suffix(project: string): string {
  if (project === "phone") return "390";
  return project === "wide-dark" ? "1280-dark" : "1280";
}

test.beforeAll(() => {
  mkdirSync("captures", { recursive: true });
});

for (const screen of SCREENS) {
  test(`capture ${screen.id}`, async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "phone";
    test.skip(Boolean(screen.wideOnly && phone) || Boolean(screen.phoneOnly && !phone), "not drawn at this width");
    if (screen.clock) await page.clock.install();
    await page.goto(`${APP}${screen.query ?? ""}${screen.hash}`);
    await expect(page.getByTestId("freshness-line")).toHaveText(screen.line ?? "실시간");
    // A card with no checked title has a detail head without a title (lina#151).
    await expect(page.locator("[data-testid=screen-title], .detail-head").first()).toBeVisible();
    if (screen.open) await screen.open(page);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(fits).toBe(true);
    // On a phone only the screen between the bars scrolls, so a full capture grows the window to the screen's length.
    if (phone) {
      const tall = await page.evaluate(() => {
        const main = document.querySelector(".phone-main");
        return main ? Math.ceil(innerHeight - main.clientHeight + main.scrollHeight) : 0;
      });
      if (tall > page.viewportSize()!.height) await page.setViewportSize({ width: page.viewportSize()!.width, height: tall });
    }
    await page.screenshot({ path: `captures/${screen.id}-${suffix(testInfo.project.name)}.png`, fullPage: true, animations: "disabled" });
  });
}

// The bell's 알림 받기 row in each state. A full Chromium: the headless shell denies notifications, so its row would
// always read 브라우저에서 알림 막힘.
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PUSH_ROWS: readonly { id: string; query?: string; userAgent?: string; granted?: boolean; turnOn?: boolean }[] = [
  { id: "off", query: "&push=off" },
  { id: "home", userAgent: IPHONE },
  { id: "ready" },
  { id: "on", granted: true, turnOn: true },
];

test.describe("push row", () => {
  for (const row of PUSH_ROWS) {
    test(`capture push-row-${row.id}`, async ({}, testInfo) => {
      const browser = await chromium.launch({ channel: "chromium" });
      const { viewport, colorScheme, hasTouch, isMobile, locale, baseURL } = testInfo.project.use;
      const context = await browser.newContext({ viewport, colorScheme, hasTouch, isMobile, locale, baseURL, deviceScaleFactor: 1, ...(row.userAgent ? { userAgent: row.userAgent } : {}), ...(row.granted ? { permissions: ["notifications"] } : {}) });
      const page = await context.newPage();
      await page.goto(`${APP}${row.query ?? ""}#/inbox`);
      await expect(page.getByTestId("freshness-line")).toHaveText("실시간");
      await page.getByTestId("bell").click();
      const shown = page.getByTestId("notices").getByTestId("push-row");
      if (row.turnOn) {
        await shown.getByRole("switch", { name: "알림 받기" }).click();
      }
      await expect(shown).toHaveAttribute("data-state", row.id);
      await page.getByTestId("notices").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      await page.screenshot({ path: `captures/push-row-${row.id}-${suffix(testInfo.project.name)}.png`, fullPage: true, animations: "disabled" });
      await browser.close();
    });
  }
});

test("installs from /app/ with its manifest, icons and worker", async ({ page }) => {
  await page.goto(APP);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/app/manifest.webmanifest");
  const manifest = (await (await page.request.get(href ?? "")).json()) as { display: string; start_url: string; icons: { src: string }[] };
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    expect((await page.request.get(new URL(icon.src, `http://x${href}`).pathname)).status()).toBe(200);
  }
  expect((await page.request.get("/app/icons/apple-touch-icon.png")).status()).toBe(200);
  expect(await (await page.request.get("/app/sw.js")).text()).toContain('addEventListener("fetch"');
  await page.reload();
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active));
});
