import { expect, test } from "@playwright/test";

// lina-app#153 in a real browser: the list beside the detail pane keeps its scroll while the pane opens and closes,
// and a goal opened in 대화 has one talk box and a reply button that fits a phone.
const APP = "/app/?source=synthetic";

test("opening and closing the detail pane never changes the list's scroll, even when rows above wrap differently", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "the pane beside the list is the wide layout");
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto(`${APP}#/running`);
  await expect(page.getByTestId("freshness-line")).toHaveText("실시간");
  const list = page.locator(".list-pane");
  // Stands for the hub's long rows above the view: text whose height depends on the list's width.
  await list.evaluate((element) => {
    const rows = document.createElement("p");
    rows.textContent = "가나다라 마바사 아자차카 타파하 ".repeat(40);
    element.prepend(rows);
    element.scrollTop = 500;
  });
  const before = await list.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  const rows = page.locator(".list-pane [data-testid=row] > a[href^='#/cards/']");
  let row = rows.first();
  for (let index = 0; index < (await rows.count()); index += 1) {
    const box = await rows.nth(index).boundingBox();
    if (box && box.y > 60 && box.y + box.height < 340) {
      row = rows.nth(index);
      break;
    }
  }
  await row.click();
  await expect(page.getByTestId("detail-frame")).toHaveAttribute("data-frame", "panel");
  const open = await list.evaluate((element) => element.scrollTop);
  await page.goBack();
  await expect(page.getByTestId("detail-frame")).toHaveCount(0);
  const after = await list.evaluate((element) => element.scrollTop);
  console.log(`list scrollTop before open ${before}, while open ${open}, after close ${after}`);
  expect([open, after]).toEqual([before, before]);
});

test("a goal opened in 대화 has one talk box, and the reply button beside 답 달기 fits the screen", async ({ page }, info) => {
  await page.goto(`${APP}#/talk/ag-3?goal=G3`);
  await expect(page.getByTestId("freshness-line")).toHaveText("실시간");
  const answer = page.getByTestId("decision-answer");
  await expect(answer.getByRole("textbox", { name: "답 달기" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "메시지" })).toHaveCount(1);
  const send = (await answer.getByRole("button", { name: "보내기" }).boundingBox())!;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: info.outputPath("talk-goal.png") });
  expect(send.x + send.width, `보내기 ends at ${send.x + send.width} of ${width}`).toBeLessThanOrEqual(width);
});
