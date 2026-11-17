import { expect, test, type Page } from "@playwright/test";

// G138: on the hub's shapes of cards at work and waiting (`&hub=now`), at 1280 and 390: a card's top line is the core's
// now line of 40 letters or fewer, else what its state says it waits for, else none; never a bot's comment. A stop with no
// sentence of why never reads 이유 기록 없음, and no card says it is read-only.

const TIME = "(어제 )?\\d\\d:\\d\\d";
const BOT_SAID = "가짜 묶음 셋을 나눠 맡겼다.";

async function openCard(page: Page, id: string) {
  await page.goto(`/app/?source=synthetic&hub=now#/cards/${id}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  const frame = page.locator("[data-frame]");
  await expect(frame.locator("article.detail")).toBeVisible();
  await expect(frame.getByTestId("detail-loading")).toHaveCount(0);
  return frame;
}

const head = (frame: ReturnType<Page["locator"]>) => frame.getByTestId("timeline").locator(".timeline-head").first();

test("a going card's top line is its now line of 40 letters or fewer, its state's wait, or nothing; never a bot comment", async ({ page }) => {
  const told = await openCard(page, "k-464");
  await expect(head(told)).toHaveText(new RegExp(`^${TIME} · 진행 중 · 가짜 목록 셋을 차례로 맞추는 중$`));
  await expect(told.getByTestId("card-now").locator(".box-text")).toHaveText("가짜 목록 셋을 차례로 맞추는 중");
  const asking = await openCard(page, "k-465");
  await expect(head(asking)).toHaveText(new RegExp(`^${TIME} · 진행 중 · 결정 대기$`));
  const going = await openCard(page, "k-460");
  await expect(head(going)).toHaveText(new RegExp(`^${TIME} · 진행 중$`));
  await expect(going.getByTestId("card-now")).toHaveCount(0);
  for (const frame of [told, asking, going]) {
    await expect(frame.locator(".detail-head")).not.toContainText(BOT_SAID);
    await expect(frame).not.toContainText(/도구 사용|읽기 전용/);
  }
  await expect(head(going)).not.toContainText(BOT_SAID);
});

test("a waiting card whose now line is over 40 letters reads its state's wait", async ({ page }) => {
  const waiting = await openCard(page, "k-461");
  await expect(waiting.getByTestId("card-now").locator(".box-text")).toHaveText("검토를 기다리는 중");
  await expect(waiting.getByTestId("card-now")).not.toContainText(BOT_SAID);
});

test("a stop with no sentence of why reads its words alone, and one nobody asks the owner for waits on something else", async ({ page }) => {
  const bare = await openCard(page, "k-463");
  await expect(bare.getByTestId("stop-why")).toHaveText("결정 대기");
  await expect(bare.getByTestId("answer-where")).toHaveText(/^답할 곳 · \S+ 대화$/);
  await expect(bare).not.toContainText("이유 기록 없음");
  await expect(bare.getByTestId("read-only")).toHaveCount(0);
  const device = await openCard(page, "k-462");
  await expect(device.locator(".detail-head [data-testid=state]").first()).toHaveText("중단됨 · 다른 일 대기");
  await expect(device.locator(".detail-head")).not.toContainText(/피드백 대기|이유 기록 없음|읽기 전용|가짜 기기가/);
});
