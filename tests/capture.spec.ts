import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Every screen on the synthetic scene, at 1280 (light and dark) and 390. The app is served under /app/
// like the core serves it (lina-system/lina#168).
const APP = "/app/?source=synthetic";

const SCREENS: readonly { id: string; hash: string; query?: string; wideOnly?: boolean; phoneOnly?: boolean; open?: (page: Page) => Promise<void> }[] = [
  { id: "menu", hash: "#/", phoneOnly: true },
  { id: "inbox", hash: "#/inbox" },
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
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await expect(page.getByTestId("comment-pending")).toHaveText(/에게 보냄 · 방금$/);
    },
  },
  { id: "item-decision", hash: "#/items/T2" },
  { id: "goal-decision", hash: "#/goals/G3" },
  { id: "card-question", hash: "#/cards/k-102" },
  { id: "card-detail", hash: "#/cards/k-101" },
  { id: "run-detail", hash: "#/runs/r6" },
  { id: "status", hash: "#/status" },
  {
    id: "status-accounts",
    hash: "#/status",
    open: async (page) => {
      await page.getByRole("list", { name: "쿼터" }).locator("summary").first().click();
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
    await page.goto(`${APP}${screen.query ?? ""}${screen.hash}`);
    await expect(page.getByTestId("freshness-line")).toHaveText(/^갱신 \d+초 전$/);
    await expect(page.locator("[data-testid=screen-title], .detail-title").first()).toBeVisible();
    if (screen.open) await screen.open(page);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(fits).toBe(true);
    await page.screenshot({ path: `captures/${screen.id}-${suffix(testInfo.project.name)}.png`, fullPage: true, animations: "disabled" });
  });
}

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
