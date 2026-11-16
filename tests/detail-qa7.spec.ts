import { expect, test, type Page } from "@playwright/test";

// lina-app#161 item 2: nothing inside the detail frame is cut, at 390 and at 1280: no element that hides its overflow
// holds more than it shows, measured with scrollWidth / scrollHeight inside [data-frame]. The card's own name is the
// line the hub's titles cut most; it is set to a long made-up title in the hub's shape before measuring. What overflows
// must be text to count: a list's divider (`.row + .row .lines::before`, 100vw wide) is trimmed by its list on purpose.
const LONG_OWN_TITLE = "결제: 실패 화면에서 다시 시도 단추와 안내 문구를 휴대폰 폭에 맞게 다시 배치하고 확인하기";

const DETAILS: readonly { name: string; query: string; hash: string; prepare?: (page: Page) => Promise<void> }[] = [
  { name: "decision", query: "", hash: "#/items/T2" },
  {
    name: "card with its own name",
    query: "",
    hash: "#/cards/k-102",
    prepare: async (page) => {
      // The head reads the card's own name (lina-app#242), so it is the line the hub's long titles cut.
      await page.locator("[data-frame] .detail-title").evaluate((line, title) => {
        line.textContent = title;
      }, LONG_OWN_TITLE);
    },
  },
  { name: "stopped card", query: "&runs=ended", hash: "#/cards/k-108" },
  { name: "to-do with a due date", query: "", hash: "#/items/T3" },
  { name: "goal", query: "", hash: "#/goals/G2" },
];

for (const { name, query, hash, prepare } of DETAILS) {
  test(`nothing in the ${name} detail frame is cut`, async ({ page }) => {
    await page.goto(`/app/?source=synthetic${query}${hash}`);
    await expect(page.getByTestId("freshness-line")).toHaveText("");
    const frame = page.locator("[data-frame]");
    await expect(frame.locator("article.detail")).toBeVisible();
    await expect(frame.getByTestId("detail-loading")).toHaveCount(0);
    if (prepare) await prepare(page);
    const clipped = await frame.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("*")]
        .filter((element) => !element.closest(".visually-hidden"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const hides = (value: string) => value === "hidden" || value === "clip";
          const wide = hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
          const tall = hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
          if (!wide && !tall) return false;
          const box = element.getBoundingClientRect();
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim() || (node.parentElement && getComputedStyle(node.parentElement).visibility === "hidden")) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if ((wide && rect.right > box.right + 1) || (tall && rect.bottom > box.bottom + 1)) return true;
          }
          return false;
        })
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}: ${element.textContent?.slice(0, 40)}`),
    );
    expect(clipped).toEqual([]);
  });
}
