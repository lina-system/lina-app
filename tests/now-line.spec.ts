import { expect, test, type Page } from "@playwright/test";

// G138: on the hub's shapes of cards at work and waiting (`&hub=now`), at 1280 and 390: a going card's 기록 opens on what
// it does now, a stop with no sentence of why never reads 이유 기록 없음, and no card says it is read-only.

const DOING = "묶음 A·B·C를 일꾼 셋에 병렬로 맡겼다.";

async function openCard(page: Page, id: string) {
  await page.goto(`/app/?source=synthetic&hub=now#/cards/${id}`);
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  const frame = page.locator("[data-frame]");
  await expect(frame.locator("article.detail")).toBeVisible();
  await expect(frame.getByTestId("detail-loading")).toHaveCount(0);
  return frame;
}

test("a going card's record opens on what it does now, as its 지금 says, with no tool count and no read-only line", async ({ page }) => {
  const frame = await openCard(page, "k-460");
  await expect(frame.getByTestId("timeline").locator(".timeline-head").first()).toHaveText(new RegExp(`^(어제 )?\\d\\d:\\d\\d · 진행 중 · ${DOING}$`));
  await expect(frame.getByTestId("card-now").locator(".box-text")).toHaveText(DOING);
  await expect(frame).not.toContainText("도구 사용");
  await expect(frame).not.toContainText("읽기 전용");
  await expect(frame.getByTestId("read-only")).toHaveCount(0);
  // The English hand-out lines and the receipt are notices: the one folded comment is the progress report.
  await expect(frame.getByTestId("card-comments")).not.toContainText(/Assigned|받음|접힌 댓글 \d/);
});

test("a stop with no sentence of why reads its words alone, and one nobody asks the owner for waits on something else", async ({ page }) => {
  const bare = await openCard(page, "k-463");
  await expect(bare.getByTestId("stop-why")).toHaveText("결정 대기");
  await expect(bare.getByTestId("answer-where")).toHaveText(/^답할 곳 · \S+ 대화$/);
  await expect(bare).not.toContainText("이유 기록 없음");
  await expect(bare.getByTestId("read-only")).toHaveCount(0);
  const device = await openCard(page, "k-462");
  await expect(device.locator(".detail-head [data-testid=state]").first()).toHaveText("중단됨 · 다른 일 대기 · 가짜 기기가 돌아오면 이어서 붙인다.");
  await expect(device).not.toContainText(/피드백 대기|이유 기록 없음|읽기 전용/);
});
