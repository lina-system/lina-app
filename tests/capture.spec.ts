import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { syntheticHome } from "../src/fixtures/synthetic";

test.beforeAll(() => {
  mkdirSync("captures", { recursive: true });
});

test("home on synthetic data", async ({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width;
  expect(width === 1280 || width === 390).toBe(true);

  await page.goto("/");
  await expect(page.getByTestId("version")).toHaveText(/^0\.0\.1-alpha\.\d{8}\.[1-9]\d*$/);
  await expect(page.getByTestId("goal-count")).toHaveText("2");
  await expect(page.getByTestId("todo-count")).toHaveText("3");
  await expect(page.getByTestId("run-count")).toHaveText("1");
  await expect(page.getByText(syntheticHome.agents[0].goals[0].title)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(true);

  const note = page.getByRole("textbox", { name: "Note" });
  await note.click();
  await note.evaluate((element: HTMLInputElement) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composing = (value: string) => {
      element.value = value;
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    };
    composing("ㅎ");
    composing("하");
    composing("한");
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "한", inputType: "insertText", isComposing: false }),
    );
  });
  await expect(note).toHaveValue("한");
  await page.screenshot({ path: `captures/home-${width}.png`, fullPage: true });

  const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as {
    display: string;
    icons: { src: string }[];
  };
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.status()).toBe(200);
  }
  expect((await page.request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
  expect(await (await page.request.get("/sw.js")).text()).toContain('addEventListener("fetch"');

  await page.reload();
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active);
  });
});
