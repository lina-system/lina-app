import { expect, test, type Locator } from "@playwright/test";

// lina-app#141, #152: on a phone the work tab reads in one look. With the owner's 52 to-dos the running cards and the
// owner's first to-dos are on the first screen, and a title or a row's second line takes a second line before it is cut.
const APP = "/app/?source=synthetic&runs=ended&todos=many#/";

test.use({ viewport: { width: 390, height: 844 } });

/** How many lines a title is drawn on, and whether its first line is cut short. */
async function lines(title: Locator): Promise<{ lines: number; cut: boolean }> {
  return title.evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    return { lines: Math.round(element.getBoundingClientRect().height / lineHeight), cut: style.whiteSpace === "nowrap" && element.scrollWidth > element.clientWidth };
  });
}

test("with 50 more to-dos, the first screen shows the decisions, what runs and the owner's first to-dos before the stopped rows (lina-app#152)", async ({ page }) => {
  await page.goto(APP);
  const running = page.getByRole("list", { name: "진행 중인 작업" });
  await expect(running.getByTestId("row").first()).toBeVisible();
  const height = await page.evaluate(() => window.innerHeight);
  const top = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().top);
  expect(await top(page.getByTestId("home-decisions"))).toBeLessThan(await top(running.getByTestId("row").first()));
  expect(await top(running.getByTestId("row").first())).toBeLessThan(height);
  // The head counts every to-do; its first three rows read without a tap, then one fold.
  await expect(page.getByTestId("head-mine")).toHaveText("내 할 일52");
  await expect(page.getByTestId("home-mine").locator(".check-row")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "내 할 일 외 49개" })).toBeVisible();
  // Stopped: five rows and one fold, after the to-dos.
  const stopped = page.getByRole("list", { name: "중단됨" });
  await expect(stopped.getByTestId("row")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "중단됨 외 2개" })).toBeVisible();
  expect(await top(page.getByTestId("home-mine"))).toBeLessThan(await top(stopped));
});

test("a row's second line wraps to at most two lines at 390, and a stopped row's state line is never cut beside its button (lina-app#152)", async ({ page }) => {
  await page.goto(APP);
  await page.getByRole("button", { name: "중단됨 외 2개" }).click();
  const subs = page.getByTestId("screen-running").getByTestId("row-sub");
  expect(await subs.count()).toBeGreaterThan(0);
  for (const sub of await subs.all()) {
    const { lines: count, cut } = await lines(sub);
    expect(cut, (await sub.textContent()) ?? "").toBe(false);
    expect(count, (await sub.textContent()) ?? "").toBeLessThanOrEqual(2);
  }
  // A long second line takes its second line instead of an ellipsis.
  const long = page.getByTestId("screen-running").getByTestId("row-sub").filter({ hasText: "위키: 결제 화면 문서 정리" }).first();
  await expect(long).toBeVisible();
  const width = await page.evaluate(() => window.innerWidth);
  for (const row of await page.getByRole("list", { name: "중단됨" }).locator("li:has([data-testid=retry])").all()) {
    const state = row.locator(".lines > .sub:not(.row-sub):not(.stop-ask)");
    const text = (await state.textContent()) ?? "";
    // The whole reason is drawn: nothing runs past the box and no ellipsis stands in for it.
    expect(await state.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), text).toBe(true);
    const box = await row.getByTestId("retry").boundingBox();
    const lineBox = await state.boundingBox();
    expect(box && lineBox && box.x >= lineBox.x + lineBox.width - 1, text).toBe(true);
    expect(box && box.x + box.width <= width, text).toBe(true);
  }
});

test("the bell's badge leaves the bell readable on every tab at 390, also with a two-digit count (lina-app#152)", async ({ page }) => {
  for (const tab of ["tab-work", "tab-talk", "tab-status"]) {
    await page.goto(APP);
    await page.getByTestId(tab).click();
    const bell = page.getByTestId("bell");
    await expect(bell.getByTestId("bell-count")).toBeVisible();
    await bell.getByTestId("bell-count").evaluate((badge) => {
      badge.textContent = "56";
    });
    const covered = await bell.evaluate((button) => {
      const icon = button.querySelector("svg")?.getBoundingClientRect();
      const badge = button.querySelector("[data-testid=bell-count]")?.getBoundingClientRect();
      if (!icon || !badge) return 1;
      const x = Math.max(0, Math.min(icon.right, badge.right) - Math.max(icon.left, badge.left));
      const y = Math.max(0, Math.min(icon.bottom, badge.bottom) - Math.max(icon.top, badge.top));
      return (x * y) / (icon.width * icon.height);
    });
    expect(covered, tab).toBeLessThanOrEqual(0.2);
  }
});

test("a long to-do title and a long running title take two lines at 390, with nothing cut on the first", async ({ page }) => {
  await page.goto(APP);
  const running = page.getByRole("list", { name: "진행 중인 작업" }).locator("li:has(> a[href='#/cards/k-102']) .title");
  await expect(running).toHaveText("결제 화면 개편: 카드사별 실패 문구와 다시 시도 버튼 정리");
  expect(await lines(running)).toEqual({ lines: 2, cut: false });
  await page.getByRole("button", { name: "내 할 일 외 49개" }).click();
  const todo = page.getByRole("list", { name: "내 할 일" }).getByTestId("row").filter({ hasText: "연말 행사 촬영 장소와 소품 목록을 정리하고 담당자 확인 1" }).first().locator(".title");
  expect(await lines(todo)).toEqual({ lines: 2, cut: false });
});
