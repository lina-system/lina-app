import { expect, test, type Locator, type Page } from "@playwright/test";

// lina-app#142: every kind of detail opens in the one frame (the right-hand pane at 1280, a sheet rising from the
// bottom at 390) where the owner is looking, from a row far down its list; back closes it and the list is where it
// was, its row still highlighted. The viewport is short so each list scrolls.
const APP = "/app/?source=synthetic";
const HEIGHT = 280;

const KINDS: readonly { kind: string; list: string; row: string; open?: (row: Locator) => Promise<Locator> }[] = [
  { kind: "work card", list: "#/running", row: "[data-testid=screen-running] [data-testid=row] > a[href^='#/cards/']" },
  { kind: "run", list: "#/inbox", row: "[data-testid=screen-inbox] [data-testid=row] > a[href^='#/runs/']" },
  { kind: "to-do", list: "#/", row: "[data-testid=screen-running] [data-testid=row] > a[href^='#/items/']" },
  { kind: "goal", list: "#/goals", row: "[data-testid=screen-goals] [data-testid=row] > a[href^='#/goals/']" },
  {
    kind: "decision",
    list: "#/inbox",
    row: "[data-testid=screen-inbox] .decision-row > .row-button",
    // A decision's row opens in place with its record's link; the record opens in the frame with the answer place.
    open: async (row) => {
      await row.click();
      return row.locator("xpath=..").locator(".decision-panel a").first();
    },
  },
];

async function ready(page: Page, hash: string) {
  await page.goto(`${APP}${hash}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("실시간");
}

for (const { kind, list, row: rowSelector, open } of KINDS) {
  test(`a ${kind} far down its list opens in the one frame at the viewport, and back keeps the list's place`, async ({ page }, info) => {
    const wide = (page.viewportSize()?.width ?? 0) >= 900;
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: HEIGHT });
    await ready(page, list);
    const scroller = page.locator(wide ? ".list-pane" : ".phone-main");
    const row = page.locator(rowSelector).last();
    // Far down: the list is scrolled to its end, the row in view at the bottom.
    await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await row.scrollIntoViewIfNeeded();
    const link = open ? await open(row) : row;
    await link.scrollIntoViewIfNeeded();
    const before = await scroller.evaluate((element) => element.scrollTop);
    expect(before, "the list does not scroll at this height").toBeGreaterThan(0);
    const title = await page.getByTestId("screen-title").first().textContent();
    const target = open ? null : await row.getAttribute("href");

    await link.click();

    const frame = page.getByTestId("detail-frame");
    await expect(frame).toHaveAttribute("data-frame", wide ? "panel" : "sheet");
    // The sheet rises into place; it is measured once it stands.
    await frame.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await expect(frame.locator("article.detail .detail-head").first()).toBeInViewport();
    const box = await frame.boundingBox();
    expect(box && box.y >= 0 && box.y < HEIGHT / 2, `the frame starts at ${box?.y}`).toBe(true);
    // The window itself never scrolls: the header and the menu stay, the list keeps its own scroll under the frame.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (wide) await expect(page.getByTestId("screen-title")).toHaveText(title ?? "");
    expect(Math.abs((await scroller.evaluate((element) => element.scrollTop)) - before)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`frame-${kind.replace(" ", "-")}.png`) });

    await page.goBack();
    await expect(frame).toHaveCount(0);
    expect(Math.abs((await scroller.evaluate((element) => element.scrollTop)) - before), "the list's scroll after back").toBeLessThanOrEqual(1);
    if (target) await expect(page.locator(`[data-testid=row] > a[href="${target}"]`).last()).toHaveAttribute("aria-current", "page");
  });
}
