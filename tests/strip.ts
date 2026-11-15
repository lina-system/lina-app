import type { Page } from "@playwright/test";

/**
 * Where the phone's bottom strip starts, in viewport px (lina-app#187): the strip's top while it shows a word, else the
 * bottom of the visible page above the keyboard, since a quiet strip draws nothing and takes no height. Content brought
 * into view must end above this line.
 */
export async function stripTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector(".bottombar") as HTMLElement;
    if (getComputedStyle(bar).display !== "none") return bar.getBoundingClientRect().top;
    return innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset")) || 0);
  });
}
