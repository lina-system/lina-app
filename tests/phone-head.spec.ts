import { expect, test, type Page } from "@playwright/test";

// lina-app#202: a phone's head is a chat app's: 56-60 px above the safe area, the same on the conversation window and
// on the first screen of each tab (대화, 작업, 상태), so switching tabs moves nothing. The window's picture is 36-40 px
// with room above and below it, its name one type step over the body, and the 에이전트 · 목표 n strip under the bar
// stands apart from it. At 390 light and dark.
test.use({ serviceWorkers: "block" });

const screens = ["#/talk/ag-1", "#/talk", "#/", "#/status"];

async function open(page: Page, hash: string) {
  await page.goto(`/app/?source=synthetic${hash}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  await expect(page.getByTestId("screen-title")).toHaveCount(1);
}

/** The bar's box, and its height above the safe area (the bar's top padding is the safe area). */
async function bar(page: Page) {
  return page.locator(".navbar").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const safe = parseFloat(getComputedStyle(element).paddingTop);
    return { top: box.top + safe, bottom: box.bottom, height: box.height - safe };
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`at 390 ${colorScheme}`, () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");
    test.use({ colorScheme });

    test("the conversation window and the three tab roots have one head height, 56-60 px, and the tabs stay put", async ({ page }) => {
      const heights: number[] = [];
      const tabs: number[] = [];
      for (const hash of screens) {
        await open(page, hash);
        heights.push((await bar(page)).height);
        if (hash !== "#/talk/ag-1") tabs.push((await page.getByTestId("tabs").boundingBox())!.y);
      }
      for (const height of heights) {
        expect(height).toBeGreaterThanOrEqual(56);
        expect(height).toBeLessThanOrEqual(60);
      }
      expect(new Set(heights).size).toBe(1);
      expect(new Set(tabs).size).toBe(1);
    });

    test("the window's picture is 36-40 px with room above and below it, and the name is one step over the body", async ({ page }) => {
      await open(page, "#/talk/ag-1");
      const head = await bar(page);
      const mark = (await page.locator(".navbar .talk-head > .mark").boundingBox())!;
      expect(mark.height).toBeGreaterThanOrEqual(36);
      expect(mark.height).toBeLessThanOrEqual(40);
      expect(mark.width).toBe(mark.height);
      expect(mark.y - head.top).toBeGreaterThanOrEqual(8);
      expect(head.bottom - (mark.y + mark.height)).toBeGreaterThanOrEqual(8);
      const sizes = await page.evaluate(() => ({
        name: parseFloat(getComputedStyle(document.querySelector(".navbar .talk-head > h1")!).fontSize),
        body: parseFloat(getComputedStyle(document.querySelector(".stack")!).fontSize),
      }));
      expect(sizes.name).toBe(20);
      expect(sizes.body).toBe(17);
    });

    test("the 에이전트 · 목표 n strip has its own room under the bar's edge", async ({ page }) => {
      await open(page, "#/talk/ag-1");
      const head = await bar(page);
      const strip = page.getByTestId("agent-card");
      await expect(strip).toContainText("에이전트 · 목표");
      expect((await strip.boundingBox())!.y - head.bottom).toBeGreaterThanOrEqual(8);
      expect(await page.locator(".navbar").evaluate((element) => getComputedStyle(element).borderBottomStyle)).toBe("solid");
    });
  });
}
