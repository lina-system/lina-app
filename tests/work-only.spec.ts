import { expect, test } from "@playwright/test";

/**
 * The work-only dist (`npm run build:work`, then `LINA_WORK_ONLY=1 npx playwright test tests/work-only.spec.ts`).
 * Default capture still serves `dist/` and skips this file.
 */
test.skip(process.env.LINA_WORK_ONLY !== "1", "work-only dist");

const APP = "/app/?source=synthetic";

test("work-only home has no talk, status or agent-ops, and a hidden address opens home", async ({ page }, info) => {
  await page.goto(`${APP}#/`);
  await expect(page.locator("[data-lina-mode=work]")).toBeVisible();
  await expect(page.getByTestId("tabs")).toHaveCount(0);
  await expect(page.getByTestId("tab-talk")).toHaveCount(0);
  await expect(page.getByTestId("tab-status")).toHaveCount(0);
  await expect(page.getByTestId("screen-running")).toBeVisible();
  await expect(page.getByTestId("retry")).toHaveCount(0);

  // On a phone the lists live in the header 메뉴 sheet (chrome-qa9); wide keeps the sidebar on screen.
  const phone = info.project.name === "phone";
  if (phone) await page.getByRole("button", { name: "메뉴" }).click();
  const nav = phone ? page.getByRole("dialog", { name: "메뉴" }) : page.getByTestId("sidebar");
  await expect(nav.getByTestId("nav-running")).toHaveCount(0);
  await expect(nav.getByTestId("nav-status")).toHaveCount(0);
  await expect(nav.getByTestId("nav-settings")).toHaveCount(0);
  await expect(nav.locator("[data-testid^=nav-agent-]")).toHaveCount(0);
  await expect(nav.locator("[data-testid^=nav-talk-]")).toHaveCount(0);
  await expect(nav.getByTestId("nav-inbox")).toBeVisible();
  await expect(nav.getByTestId("nav-due")).toBeVisible();
  await expect(nav.getByTestId("nav-today")).toBeVisible();
  await expect(nav.getByTestId("nav-done")).toBeVisible();
  await expect(nav.getByTestId("nav-goals")).toBeVisible();

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
