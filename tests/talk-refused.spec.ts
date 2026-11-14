import { expect, test, type Page } from "@playwright/test";

// lina-app#158: a refused send stays readable on a phone. The red line is drawn where nothing covers it, the sticky
// field included, with and without the on-screen keyboard's height, and the message is back in the field.
const BUSY = "/app/?source=synthetic&talk=busy#/talk/ag-1";

async function refuse(page: Page, keyboard: number): Promise<void> {
  await page.goto(BUSY);
  const talk = page.getByTestId("agent-talk");
  await expect(talk).toBeVisible();
  // The page sets --keyboard-inset from the visual viewport; a desktop browser has no keyboard, so the test sets it.
  if (keyboard) await page.evaluate((px) => document.documentElement.style.setProperty("--keyboard-inset", `${px}px`), keyboard);
  await talk.getByRole("textbox", { name: "메시지" }).fill("가짜 질문 하나");
  await talk.getByRole("button", { name: "보내기" }).click();
  await expect(talk.getByTestId("write-error")).toHaveText("에이전트가 바쁨");
  await expect(talk.getByRole("textbox", { name: "메시지" })).toHaveValue("가짜 질문 하나");
}

/** Whether the line itself is what the page draws at its middle and its left corners: nothing over it. */
async function topmost(page: Page): Promise<boolean[]> {
  return page.getByTestId("write-error").evaluate((line) => {
    const box = line.getBoundingClientRect();
    const inside = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y);
      return at !== null && (at === line || line.contains(at));
    };
    const edge = 2;
    return [
      inside(box.left + box.width / 2, box.top + box.height / 2),
      inside(box.left + edge, box.top + edge),
      inside(box.left + edge, box.bottom - edge),
    ];
  });
}

for (const keyboard of [0, 300]) {
  test(`a refused send's line is drawn on top, not under the field (keyboard ${keyboard}px)`, async ({ page }, info) => {
    test.skip(keyboard > 0 && info.project.name !== "phone", "the keyboard inset is a phone's");
    await refuse(page, keyboard);
    const line = (await page.getByTestId("write-error").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(line.y).toBeGreaterThanOrEqual(0);
    expect(line.y + line.height).toBeLessThanOrEqual(viewport.height - keyboard);
    expect(await topmost(page)).toEqual([true, true, true]);
  });
}
