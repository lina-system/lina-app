import { expect, test, type Page } from "@playwright/test";
import { AGENT_REPLY_DELTAS, TALK_FRAME_MS } from "../src/data/synthetic-source";

// lina-app#127: a message sent to one agent stays in its window when the owner opens another agent before the reply
// ends and comes back. The page's clock runs only when the spec says, so the owner is always away mid-reply.
const APP = "/app/?source=synthetic";

/** Opens the agent at `index`: from the sidebar on a wide window, from the 대화 list on a phone (back to it first). */
async function openAgent(page: Page, index: number, phone: boolean): Promise<void> {
  if (phone) {
    if (await page.getByTestId("agent-talk").count()) await page.getByTestId("back").click();
    await page.getByTestId(`talk-agent-${index}`).getByRole("link").click();
  } else {
    await page.getByTestId(`nav-talk-${index}`).getByRole("link").click();
  }
  await expect(page.getByTestId("agent-talk")).toBeVisible();
}

test("a message sent just before opening another agent stays in its window, and the reply joins it there", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await page.clock.install();
  await page.goto(`${APP}#/talk`);
  await openAgent(page, 0, phone);
  const window = page.getByTestId("agent-talk");
  await expect(window.getByTestId("talk-mine")).toHaveText(["어디까지 왔어요?"]);
  const name = (await window.getByTestId("agent-talk-name").textContent()) ?? "";
  await page.clock.pauseAt(new Date(Date.now() + 60_000));

  await window.getByRole("textbox", { name: "메시지" }).fill("오늘 어디까지 했어요?");
  await window.getByRole("textbox", { name: "메시지" }).press("Enter");
  await expect(window.getByTestId("talk-live")).toBeAttached();
  await page.clock.runFor(TALK_FRAME_MS);

  await openAgent(page, 1, phone);
  await expect(page.getByTestId("agent-talk-name")).not.toHaveText(name);
  await page.clock.runFor(200);
  await openAgent(page, 0, phone);
  // The window reads its earlier turns from an effect, which Preact runs on the page's (paused) timers.
  await page.clock.runFor(100);
  await expect(window.getByTestId("agent-talk-name")).toHaveText(name);
  await expect(window.getByTestId("talk-mine")).toHaveText(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
  await expect(window.getByTestId("talk-live")).toBeAttached();

  await page.clock.runFor(TALK_FRAME_MS * 10);
  await expect(window.getByTestId("talk-reply").last().locator(".talk-bubble")).toHaveText(AGENT_REPLY_DELTAS.join(""));
  await expect(window.getByTestId("talk-live")).toHaveCount(0);
  await expect(window.getByTestId("talk-mine")).toHaveText(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
});
