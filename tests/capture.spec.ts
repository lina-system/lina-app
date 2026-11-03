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
  { id: "card-detail", hash: "#/cards/k-101" },
  { id: "run-detail", hash: "#/runs/r6" },
  { id: "status", hash: "#/status" },
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
