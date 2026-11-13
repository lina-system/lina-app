import { expect, test, type Locator } from "@playwright/test";

// lina-app#141: on a phone the work tab reads in one look. With the owner's 52 to-dos the stopped group starts on the
// first screen, and a to-do's or a running card's title takes a second line before it is cut, like a stopped row's.
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

test("with 50 more to-dos, the decisions and the stopped rows are on the first screen before any to-do", async ({ page }) => {
  await page.goto(APP);
  const stopped = page.getByRole("list", { name: "중단됨" });
  await expect(stopped.getByTestId("row").first()).toBeVisible();
  const height = await page.evaluate(() => window.innerHeight);
  const top = await stopped.getByTestId("row").first().evaluate((row) => row.getBoundingClientRect().top);
  expect(top).toBeLessThan(height);
  expect(await page.getByTestId("home-decisions").evaluate((row) => row.getBoundingClientRect().top)).toBeLessThan(top);
  await expect(page.getByRole("button", { name: "내 할 일 52" })).toBeVisible();
  await expect(page.locator(".check-row")).toHaveCount(0);
});

test("a long to-do title and a long running title take two lines at 390, with nothing cut on the first", async ({ page }) => {
  await page.goto(APP);
  const running = page.getByRole("list", { name: "진행 중인 작업" }).locator("li:has(> a[href='#/cards/k-102']) .title");
  await expect(running).toHaveText("결제 화면 개편: 카드사별 실패 문구와 다시 시도 버튼 정리");
  expect(await lines(running)).toEqual({ lines: 2, cut: false });
  await page.getByRole("button", { name: "내 할 일 52" }).click();
  const todo = page.getByRole("list", { name: "내 할 일" }).getByTestId("row").filter({ hasText: "연말 행사 촬영 장소와 소품 목록을 정리하고 담당자 확인 1" }).first().locator(".title");
  expect(await lines(todo)).toEqual({ lines: 2, cut: false });
});
