import { expect, test } from "@playwright/test";

test("keeps every key typed fast into the note field", async ({ page }) => {
  await page.goto("/");
  const note = page.getByRole("textbox", { name: "Note" });
  await note.click();

  await page.keyboard.type("hello world", { delay: 0 });

  await expect(note).toHaveValue("hello world");
});

test("keeps a Hangul string composed fast into the note field", async ({ page }) => {
  await page.goto("/");
  const note = page.getByRole("textbox", { name: "Note" });
  await note.click();

  await note.evaluate((element: HTMLInputElement) => {
    const syllables = [
      ["ㅎ", "하", "한"],
      ["ㄱ", "그", "글"],
    ];
    let committed = "";
    for (const steps of syllables) {
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      for (const step of steps) {
        element.value = committed + step;
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: step,
            inputType: "insertCompositionText",
            isComposing: true,
          }),
        );
      }
      const syllable = steps[steps.length - 1];
      committed += syllable;
      element.value = committed;
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: syllable }));
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: syllable,
          inputType: "insertText",
          isComposing: false,
        }),
      );
    }
  });

  await expect(note).toHaveValue("한글");
});
