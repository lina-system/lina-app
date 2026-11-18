import { expect, test, type Page } from "@playwright/test";

// G138, lina-app#269: on `&hub=round26`, at 1280 and 390. A card's 기록 reads one line per step, `time · what it did`,
// newest first, each round's verdict a small mark beside its step that overlaps nothing and is not cut; a card with no
// steps reads one closed 이전 기록 fold and nothing of its old record before it opens.

const TIME = "(?:어제 )?\\d\\d:\\d\\d";

async function record(page: Page, id: string) {
  await page.goto(`/app/?source=synthetic&hub=round26#/cards/${id}`);
  const frame = page.locator("[data-frame]");
  await expect(frame.locator("article.detail")).toBeVisible();
  const box = frame.getByTestId("timeline");
  await expect(box).toBeVisible();
  return box;
}

async function whole(page: Page, id: string, lines: readonly string[], marks: readonly string[][], info: { outputPath: (name: string) => string }) {
  const box = await record(page, id);
  const drawn = box.getByTestId("history-line");
  await expect(drawn).toHaveText(lines.map((line, index) => new RegExp(`^${TIME} · ${line}${marks[index].join("")}$`)));
  // The phone sheet rises as it opens: measure once every animation has ended, all in one read. A wrapped sentence is
  // several boxes, so each mark is checked against every one of them.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  const problems = await box.evaluate((element) => {
    const found: string[] = [];
    const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const lines = [...element.querySelectorAll<HTMLElement>("[data-testid=history-line]")];
    lines.forEach((line, index) => {
      const rect = line.getBoundingClientRect();
      if (line.scrollWidth > line.clientWidth + 1) found.push(`line ${index} is cut`);
      const text = [...line.querySelector(".timeline-text")!.getClientRects()];
      for (const mark of line.querySelectorAll("[data-testid=history-mark]")) {
        const at = mark.getBoundingClientRect();
        if (at.right > rect.right + 1 || at.bottom > rect.bottom + 1) found.push(`line ${index}'s mark leaves its line`);
        if (text.some((part) => overlap(part, at))) found.push(`line ${index}'s mark covers its sentence`);
      }
      const next = lines[index + 1]?.getBoundingClientRect();
      if (next && next.top < rect.bottom - 1) found.push(`line ${index + 1} overlaps line ${index}`);
    });
    return found;
  });
  expect(problems).toEqual([]);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`card-history-${id}.png`), fullPage: true });
}

test("a going card's record reads its steps, the verdict a mark beside the step its round ended in", async ({ page }, info) => {
  await whole(page, "k-480", ["가짜 안내 문구 셋을 고쳐 씀", "가짜 검사 넷을 돌려 모두 통과함", "가짜 안내 화면의 빈칸을 찾음"], [[], ["검토 통과"], []], info);
});

test("a finished card's record reads its five steps and two verdict marks", async ({ page }, info) => {
  await whole(page, "k-481", ["가짜 정리 결과를 카드에 남김", "고친 묶음을 다시 검토받아 통과함", "검토에서 받은 지적 둘을 고침", "가짜 알림 묶음을 넷으로 나눔", "가짜 알림 목록을 처음부터 읽음"], [[], ["검토 통과"], [], ["검토 필요"], []], info);
});

test("a card with no steps reads one closed 이전 기록 fold, its old lines hidden until it opens", async ({ page }, info) => {
  const box = await record(page, "k-482");
  await expect(box.getByTestId("history-line")).toHaveCount(0);
  await expect(box.getByTestId("earlier-records-head")).toHaveText("이전 기록");
  await expect(box.getByTestId("timeline-block").first()).toBeHidden();
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("card-history-earlier.png"), fullPage: true });
  await box.getByTestId("earlier-records-head").click();
  await expect(box.getByTestId("timeline-block").first()).toBeVisible();
});
