import { expect, test, type Page } from "@playwright/test";

// lina-app#226: the owner writes comments the way QA round 20 did on a disposable core (own20) and reads them back as
// saved: a goal's 댓글 thread and its 기록, and a card answered from its own page and its 댓글 lines. The words have the
// shapes the bot rule takes for ids, a product name and a hash; invented, like every scene.
const OWN = ["G2 먼저 보고 T3는 내일 본다", "Vercel 결제 확인 부탁", "a1b2c3d 커밋 기준으로 다시 봐 줘"];

async function open(page: Page, query: string, hash: string) {
  await page.goto(`/app/?source=synthetic${query}${hash}`);
  // The page reads its scene's updates only while it is in front.
  await page.bringToFront();
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  await expect(page.locator("[data-frame] article.detail")).toBeVisible();
}

/** The words of a history row, after its `time · `. */
const words = (text: string) => text.replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, "");

test("the owner's comments on a goal read as saved in its 댓글 thread and its 기록", async ({ page }) => {
  await open(page, "", "#/goals/G2");
  const frame = page.locator("[data-frame]");
  const comments = frame.getByTestId("comments");
  for (const text of OWN) {
    await comments.getByRole("textbox", { name: "댓글 달기" }).fill(text);
    await comments.getByRole("button", { name: "보내기", exact: true }).click();
    await expect(comments.locator(".comment-text").filter({ hasText: text })).toHaveCount(1);
    await expect(comments.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
    expect(await comments.locator(".comment-text").allTextContents()).toContain(text);
  }
  await expect(frame.getByTestId("goal-history").getByTestId("history-row").first()).toBeVisible();
  for (const text of OWN) await expect.poll(async () => (await frame.getByTestId("goal-history").getByTestId("history-row").allTextContents()).map(words)).toContain(text);
});

test("the owner's answer on a waiting card reads as saved in its 댓글 lines", async ({ page }) => {
  await open(page, "&runs=ended", "#/cards/k-112");
  const frame = page.locator("[data-frame]");
  const answer = frame.getByTestId("card-answer");
  await answer.getByRole("textbox").fill(OWN[0]);
  await answer.getByRole("button", { name: "보내기", exact: true }).click();
  // The answer is sent once its 되돌리기 toast is gone; the card's next read draws the comment.
  await expect.poll(async () => (await frame.getByTestId("card-comments").getByTestId("history-row").allTextContents()).map(words), { timeout: 30_000 }).toContain(OWN[0]);
});
