import { expect, test } from "@playwright/test";

/**
 * The work-only dist (`npm run build:work`, then `LINA_WORK_ONLY=1 npx playwright test tests/work-only.spec.ts`).
 * Default capture still serves `dist/` and skips this file.
 */
test.skip(process.env.LINA_WORK_ONLY !== "1", "work-only dist");

const APP = "/app/?source=synthetic";

test("work-only home has no talk, status or agent-ops, and a hidden address opens home", async ({ page }) => {
  await page.goto(`${APP}#/`);
  await expect(page.locator("[data-lina-mode=work]")).toBeVisible();
  await expect(page.getByTestId("tabs")).toHaveCount(0);
  await expect(page.getByTestId("tab-talk")).toHaveCount(0);
  await expect(page.getByTestId("tab-status")).toHaveCount(0);
  await expect(page.getByTestId("nav-running")).toHaveCount(0);
  await expect(page.getByTestId("nav-status")).toHaveCount(0);
  await expect(page.getByTestId("nav-inbox")).toBeVisible();
  await expect(page.getByTestId("nav-due")).toBeVisible();
  await expect(page.getByTestId("nav-today")).toBeVisible();
  await expect(page.getByTestId("nav-done")).toBeVisible();
  await expect(page.getByTestId("nav-goals")).toBeVisible();
  await expect(page.getByTestId("screen-running")).toBeVisible();
  await expect(page.getByTestId("retry")).toHaveCount(0);

  await page.goto(`${APP}#/talk`);
  await expect(page.locator("[data-lina-mode=work]")).toBeVisible();
  await expect(page.getByTestId("screen-running")).toBeVisible();
  await expect(page.getByTestId("screen-status")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("#/");
});

test("work-only item detail keeps comments and 맡은 봇, with no talk or runs", async ({ page }) => {
  await page.goto(`${APP}#/items/T4`);
  await expect(page.getByTestId("screen-item")).toBeVisible();
  await expect(page.getByTestId("comments")).toBeVisible();
  await expect(page.getByTestId("talk")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "실행" })).toHaveCount(0);
  await expect(page.getByTestId("assigned-bot")).toHaveText(/^맡은 봇/);
});
