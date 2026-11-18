import { expect, test, type Page } from "@playwright/test";

// lina-app#269: on the hub's shapes (`&hub=round25`), at 1280 and 390. A card's 기록 line says a round's verdict and after it
// only a short sentence of the round's own, never a bot's comment; rounds that read their verdict alone one after another
// are one `×n` line. A stopped or waiting row reads what the card does now under its state line, on one line that
// overlaps nothing and is not cut.

const TIME = "(?:어제 )?\\d\\d:\\d\\d";
const NOTES = ["fake-mac에서 Playwright로 다시 확인함.", "가짜 검사를 모두 통과했다.", "가짜 정리를 마쳤다.", "가짜 묶음을 다시 나눴다."];
const STOPS = [
  { title: "가짜 기기 다시 켜기", now: "가짜 기기 재시작 승인을 기다리는 중" },
  { title: "가짜 보고 화면 내보내기", now: "가짜 화면 배포 확인을 기다리는 중" },
  { title: "가짜 로그인 연결하기", now: "가짜 로그인 승인과 앱 다시 로그인을 기다리는 중" },
  { title: "가짜 검사 다시 돌리기", now: "가짜 검사 결과를 기다리는 중" },
];

async function openCard(page: Page) {
  await page.goto("/app/?source=synthetic&hub=round25#/cards/k-470");
  const frame = page.locator("[data-frame]");
  await expect(frame.locator("article.detail")).toBeVisible();
  await expect(frame.getByTestId("timeline")).toBeVisible();
  return frame;
}

test("a card's record lines say each round's verdict, and after it only the round's own short sentence", async ({ page }, info) => {
  const frame = await openCard(page);
  const heads = frame.getByTestId("timeline").locator(".timeline-head");
  await expect(heads).toHaveText([
    new RegExp(`^${TIME} · 검토 통과 · 가짜 보고 화면을 다시 읽고 고쳤다\\.$`),
    new RegExp(`^${TIME} · 검토를 통과했다$`),
    new RegExp(`^${TIME} · 검토를 통과하지 못했다$`),
    new RegExp(`^${TIME} · 검토를 통과했다 ×3$`),
    new RegExp(`^${TIME} · 검토를 통과하지 못했다$`),
  ]);
  for (const note of NOTES) await expect(frame.getByTestId("timeline")).not.toContainText(note);
  for (const note of NOTES.slice(1)) await expect(frame.getByTestId("card-comments")).toContainText(note);
  for (const head of await heads.all()) expect(await head.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await frame.getByTestId("timeline").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("record-verdict.png"), fullPage: true });
});

test("a stopped or waiting row reads what the card does now under its state line, overlapping nothing", async ({ page }, info) => {
  await page.goto("/app/?source=synthetic&hub=round25#/running");
  for (const stop of STOPS) {
    const row = page.getByTestId("row").filter({ hasText: stop.title });
    const now = row.getByTestId("row-now");
    await now.scrollIntoViewIfNeeded();
    await expect(now).toHaveText(stop.now);
    const state = row.locator(".lines > .sub").filter({ has: page.getByTestId("state") });
    const [line, above, box] = await Promise.all([now.boundingBox(), state.boundingBox(), row.boundingBox()]);
    expect(line!.y, stop.title).toBeGreaterThanOrEqual(above!.y + above!.height - 1);
    expect(line!.y + line!.height, stop.title).toBeLessThanOrEqual(box!.y + box!.height + 1);
    expect(line!.x + line!.width, stop.title).toBeLessThanOrEqual(box!.x + box!.width + 1);
    expect(await now.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), stop.title).toBe(true);
  }
  const bare = page.getByTestId("row").filter({ hasText: "가짜 백업 자리 옮기기" });
  await expect(bare.getByTestId("state")).toBeVisible();
  await expect(bare.getByTestId("row-now")).toHaveCount(0);
  await page.getByTestId("row").filter({ hasText: STOPS[0].title }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("stopped-rows.png"), fullPage: true });
});
