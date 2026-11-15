import { expect, test, type Page } from "@playwright/test";
import { stripTop } from "./strip";

// lina-app#187: the phone's bottom strip holds only the head's word. With nothing to say it draws nothing and takes no
// height, so the 대화 field sits at the bottom like a chat app's; with a word (here 연결 중) it shows and covers nothing.
// Both at 390 light and dark, with and without a 300 px keyboard.
test.use({ serviceWorkers: "block" });

async function field(page: Page) {
  return page.getByTestId("agent-talk").getByRole("textbox", { name: "메시지" });
}

async function keyboard(page: Page, px: number) {
  await page.evaluate((inset) => document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`), px);
}

/** Whether the element is what the page draws at its centre: nothing covers it. */
async function onTop(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return at !== null && (at === element || element.contains(at));
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`at 390 ${colorScheme}`, () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, "phone layout only");
    test.use({ colorScheme });

    for (const inset of [0, 300]) {
      test(`a quiet head draws no strip and the field sits at the bottom (keyboard ${inset}px)`, async ({ page }, info) => {
        await page.goto("/app/?source=synthetic#/talk/ag-1");
        await expect(page.getByTestId("freshness-line")).toHaveText("");
        await expect(page.getByTestId("talk-mine").first()).toBeVisible();
        await keyboard(page, inset);
        expect(await page.locator(".bottombar").evaluate((bar) => getComputedStyle(bar).display)).toBe("none");
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bottom-strip").trim())).toBe("0px");
        const bottom = await stripTop(page);
        const box = (await (await field(page)).boundingBox())!;
        // The field ends 10 px above the bottom (or the keyboard): no empty band under it.
        expect(bottom - (box.y + box.height)).toBeGreaterThanOrEqual(6);
        expect(bottom - (box.y + box.height)).toBeLessThanOrEqual(14);
        expect(await onTop(page, ".agent-talk-form textarea")).toBe(true);
        // The last message brought into view ends above the field bar.
        await page.locator(".phone-main").evaluate((main) => (main.scrollTop = main.scrollHeight));
        const last = (await page.getByTestId("talk-group").last().boundingBox())!;
        const bar = (await page.locator(".agent-talk-form").boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
        await page.screenshot({ path: info.outputPath(`strip-quiet-390-${colorScheme}-kb${inset}.png`) });
      });

      test(`a word in the head shows the strip, which covers nothing (keyboard ${inset}px)`, async ({ page }, info) => {
        await page.goto("/app/?source=synthetic&live=down#/talk/ag-1");
        await expect(page.getByTestId("freshness-line")).toHaveText("연결 중");
        await expect(page.getByTestId("talk-mine").first()).toBeVisible();
        await keyboard(page, inset);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bottom-strip").trim())).toBe("44px");
        const strip = (await page.locator(".bottombar").boundingBox())!;
        expect(strip.height).toBe(44);
        expect(Math.round(strip.y + strip.height)).toBe(page.viewportSize()!.height - inset);
        expect(await onTop(page, "[data-testid=freshness-line]")).toBe(true);
        const box = (await (await field(page)).boundingBox())!;
        expect(strip.y - (box.y + box.height)).toBeGreaterThanOrEqual(6);
        expect(strip.y - (box.y + box.height)).toBeLessThanOrEqual(14);
        expect(await onTop(page, ".agent-talk-form textarea")).toBe(true);
        await page.screenshot({ path: info.outputPath(`strip-shown-390-${colorScheme}-kb${inset}.png`) });
      });
    }

    test("a list screen ends above the strip whether it shows or not", async ({ page }) => {
      for (const query of ["", "&live=down"]) {
        await page.goto(`/app/?source=synthetic&todos=many${query}#/`);
        await expect(page.getByTestId("freshness-line")).toHaveText(query ? "연결 중" : "");
        const fold = page.getByRole("button", { name: /^내 할 일/ });
        if (await fold.count()) await fold.first().click();
        await page.locator(".phone-main").evaluate((main) => (main.scrollTop = main.scrollHeight));
        const row = (await page.locator(".phone-main [data-testid=row]").last().boundingBox())!;
        const top = await stripTop(page);
        expect(row.y + row.height, query || "quiet").toBeLessThanOrEqual(top);
        expect(top - (row.y + row.height), query || "quiet").toBeLessThanOrEqual(40);
      }
    });

    test("a detail sheet leaves the strip showing, and its last line ends above it", async ({ page }) => {
      await page.goto("/app/?source=synthetic&live=down#/goals/G2");
      await expect(page.getByTestId("freshness-line")).toHaveText("연결 중");
      const body = page.locator(".detail-sheet-body");
      await expect(body).toBeVisible();
      await body.evaluate((element) => (element.scrollTop = element.scrollHeight));
      const strip = (await page.locator(".bottombar").boundingBox())!;
      expect(await onTop(page, "[data-testid=freshness-line]")).toBe(true);
      const field = body.locator("textarea").last();
      // The sheet scrolls smoothly: wait for the last line to come to rest.
      await expect
        .poll(async () => {
          const box = (await field.boundingBox())!;
          return box.y + box.height;
        })
        .toBeLessThanOrEqual(strip.y);
    });

    test("every word a phone shows in the 대화 window is at least 13 px", async ({ page }) => {
      await page.goto("/app/?source=synthetic#/talk/ag-1");
      await expect(page.getByTestId("talk-time").first()).toBeVisible();
      const sizes = await page.getByTestId("talk-time").evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)));
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(13);
    });
  });
}
