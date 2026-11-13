import { expect, test, type Page } from "@playwright/test";

// lina-app#142: every kind of detail opens in the one frame (the right-hand pane at 1280, a sheet rising from the
// bottom at 390) where the owner is looking, from a row far down its list; back closes it and the list is where it
// was, its row still highlighted. The viewport is short so each list scrolls.
const APP = "/app/?source=synthetic";
const HEIGHT = 280;

// `prepare` readies the list (the home folds the owner's to-dos, lina-app#141); `inside` is a link followed from the
// first frame (a worker run is no list row, lina-app#141: it opens from its card, in the same frame).
const KINDS: readonly { kind: string; list: string; row: string; prepare?: (page: Page) => Promise<void>; inside?: string }[] = [
  { kind: "work card", list: "#/running", row: "[data-testid=screen-running] [data-testid=row] > a[href^='#/cards/']" },
  { kind: "run", list: "#/running", row: "[data-testid=screen-running] [data-testid=row] > a[href='#/cards/k-101']", inside: "[data-testid=timeline-link]" },
  {
    kind: "to-do",
    list: "#/",
    row: "[data-testid=screen-running] [data-testid=row] > a[href^='#/items/']",
    prepare: async (page) => page.getByRole("button", { name: /^내 할 일/ }).click(),
  },
  { kind: "goal", list: "#/goals", row: "[data-testid=screen-goals] [data-testid=row] > a[href^='#/goals/']" },
  // A decision's row opens its record in the frame at once, with the place to answer it.
  { kind: "decision", list: "#/inbox", row: "[data-testid=screen-inbox] .decision-row > a" },
];

async function ready(page: Page, hash: string) {
  await page.goto(`${APP}${hash}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("실시간");
}

// A row brought into view (a tap, a focus move, a find) stops above the bottom bar on a phone, never under it.
for (const hash of ["#/", "#/inbox"]) {
  test(`on a phone the bottom bar never covers the last row of ${hash} brought into view`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone layout only");
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/app/?source=synthetic&writer=stopped&runs=ended&todos=many${hash}`);
    await expect(page.getByTestId("freshness-line")).toHaveText(/^\S/);
    const fold = page.getByRole("button", { name: /^내 할 일/ });
    if (await fold.count()) await fold.first().click();
    const last = page.locator(".phone-main [data-testid=row]").last();
    for (const bring of [() => last.evaluate((row) => row.scrollIntoView({ block: "end" })), () => page.locator(".phone-main").evaluate((main) => (main.scrollTop = main.scrollHeight))]) {
      await bring();
      const row = (await last.boundingBox())!;
      const bar = (await page.locator(".bottombar").boundingBox())!;
      expect(row.y + row.height, `the last row ends at ${row.y + row.height}, the bar starts at ${bar.y}`).toBeLessThanOrEqual(bar.y);
    }
  });
}

for (const { kind, list, row: rowSelector, prepare, inside } of KINDS) {
  test(`a ${kind} far down its list opens in the one frame at the viewport, and back keeps the list's place`, async ({ page }, info) => {
    const wide = (page.viewportSize()?.width ?? 0) >= 900;
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: HEIGHT });
    await ready(page, list);
    if (prepare) await prepare(page);
    const scroller = page.locator(wide ? ".list-pane" : ".phone-main");
    const row = page.locator(rowSelector).last();
    // Far down: the list is scrolled to its end, the row in view at the bottom.
    await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await row.scrollIntoViewIfNeeded();
    const before = await scroller.evaluate((element) => element.scrollTop);
    expect(before, "the list does not scroll at this height").toBeGreaterThan(0);
    const title = await page.getByTestId("screen-title").first().textContent();
    const target = await row.getAttribute("href");

    await row.click();

    const frame = page.getByTestId("detail-frame");
    if (inside) {
      await frame.locator(inside).first().click();
      await expect(frame.getByTestId("screen-run")).toBeVisible();
    }
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
    if (inside) await page.goBack();
    await expect(frame).toHaveCount(0);
    expect(Math.abs((await scroller.evaluate((element) => element.scrollTop)) - before), "the list's scroll after back").toBeLessThanOrEqual(1);
    if (target) await expect(page.locator(`[data-testid=row] > a[href="${target}"]`).last()).toHaveAttribute("aria-current", "page");
  });
}
