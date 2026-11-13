import { expect, test, type Page } from "@playwright/test";

// lina-app#143: a goal chosen in 대화 stays in 대화, the phone's last goal row clears the field and the strip, and the
// selected top tab shows the same way at every width in dark.
const APP = "/app/?source=synthetic";

async function openFirstAgent(page: Page, phone: boolean): Promise<void> {
  await page.goto(`${APP}#/talk`);
  await page.getByTestId(phone ? "talk-agent-0" : "nav-talk-0").getByRole("link").click();
  await expect(page.getByTestId("agent-talk")).toBeVisible();
}

test("a goal chosen on the agent's card opens under 대화, and back returns to the talk", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await openFirstAgent(page, phone);
  const card = page.getByTestId("agent-card");
  if (phone) await card.getByRole("button").first().click();
  await card.getByRole("link", { name: /릴리스 노트 정리/ }).click();
  await expect(page.locator("article.detail .detail-title")).toHaveText("릴리스 노트 정리");
  expect(new URL(page.url()).hash).toBe("#/talk/ag-1?goal=G1");
  if (phone) await expect(page.getByTestId("agent-talk")).toHaveCount(0);
  else {
    await expect(page.getByTestId("tab-talk")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("agent-talk")).toBeVisible();
  }
  await page.getByTestId("back").click();
  await expect(page.getByTestId("agent-talk")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/talk/ag-1");
});

test("on a wide window each agent row keeps its counts inside the sidebar under its last message", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "wide sidebar only");
  await page.goto(`${APP}#/talk`);
  const row = page.getByTestId("nav-talk-1");
  await expect(row.getByTestId("talk-preview")).toHaveText("아직 나눈 대화 없음");
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  for (const count of await row.locator(".count-pair .count").all()) {
    const box = (await count.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  }
  await expect(row.locator(".count-pair .count")).toHaveText(["1", "1"]);
});

test("on a phone the last goal row is fully visible above the field and the strip", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  // The synthetic agent has two goals; a short window makes the open card longer than the screen, as 19 goals do.
  await page.setViewportSize({ width: 390, height: 420 });
  await openFirstAgent(page, true);
  const card = page.getByTestId("agent-card");
  await card.getByRole("button").first().click();
  const last = card.locator(".goal-row").last();
  const clear = async () => {
    const row = await last.boundingBox();
    const form = await page.locator(".agent-talk-form").boundingBox();
    const strip = await page.locator(".bottombar").boundingBox();
    expect(row && form && strip).toBeTruthy();
    expect(row!.y).toBeGreaterThanOrEqual(0);
    expect(row!.y + row!.height).toBeLessThanOrEqual(form!.y);
    expect(row!.y + row!.height).toBeLessThanOrEqual(strip!.y);
  };
  // Scrolled down just far enough to bring the row in (as a focus move or a find does), then to the end.
  await last.evaluate((row) => row.scrollIntoView({ block: "end" }));
  await clear();
  await page.locator(".phone-main").evaluate((main) => (main.scrollTop = main.scrollHeight));
  await clear();
});

test("the selected top tab is drawn the same at every width and stands apart from its neighbours", async ({ page }, info) => {
  test.skip(info.project.name !== "wide-dark", "one dark pass resizes between widths");
  const look = async () =>
    page.getByTestId("tabs").locator("a").evaluateAll((tabs) => tabs.map((tab) => ({ current: tab.getAttribute("aria-current") === "page", background: getComputedStyle(tab).backgroundColor })));
  await page.goto(`${APP}#/talk`);
  const wide = await look();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-layout=phone]")).toBeVisible();
  const narrow = await look();
  expect(narrow).toEqual(wide);
  const selected = narrow.find((tab) => tab.current)!.background;
  for (const tab of narrow.filter((each) => !each.current)) expect(tab.background).not.toBe(selected);
  expect(selected).toBe("rgb(115, 115, 119)");
});
