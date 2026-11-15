import { render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";

// lina-app#193: the first screen of each tab (대화, 작업, 상태) has one head: on a phone the bar reads like a chat app's
// list head, an icon where the 메뉴 text was, the chip and the bell; the pressed tab is the screen's one title, so no
// large title repeats it. On a wide window the toolbar does not repeat the pressed tab either.

async function open(hash: string, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

/** The words a person sees outside the tabs: every text node not inside a hidden label. */
function shownWords(root: Element): string[] {
  const words: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(".visually-hidden, [data-testid=tabs]")) continue;
    const text = node.textContent?.trim();
    if (text) words.push(text);
  }
  return words;
}

const roots = [
  ["#/talk", "대화"],
  ["#/", "작업"],
  ["#/status", "상태"],
] as const;

test.each(roots)("on a phone %s's bar has an icon named 메뉴 with no word, then the bell", async (hash) => {
  const view = await open(hash, false);
  const bar = view.container.querySelector(".navbar") as HTMLElement;
  const menu = within(bar).getByRole("button", { name: "메뉴" });
  expect(menu.textContent).toBe("");
  expect(menu.querySelector("svg")).not.toBeNull();
  expect(within(bar).getByTestId("bell")).toBeTruthy();
});

test.each(roots)("on a phone %s names the pressed tab %s once: the tab, with no large title over it", async (hash, word) => {
  const view = await open(hash, false);
  expect(view.getByTestId("tabs").querySelector("[aria-current=page]")?.textContent).toBe(word);
  // The screen keeps its heading for a screen reader; nothing drawn repeats the tab.
  expect(view.getByTestId("screen-title").textContent).toBe(word);
  expect(view.container.querySelector(".large-title")).toBeNull();
  expect(shownWords(view.container)).not.toContain(word);
});

test.each(roots)("on a wide window %s's toolbar does not repeat the pressed tab %s", async (hash, word) => {
  const view = await open(hash, true);
  const toolbar = view.container.querySelector(".toolbar") as HTMLElement;
  expect(within(toolbar).getByTestId("tabs").querySelector("[aria-current=page]")?.textContent).toBe(word);
  expect(within(toolbar).getByTestId("screen-title").textContent).toBe(word);
  expect(shownWords(toolbar)).not.toContain(word);
  // The pick-an-agent line is the empty middle's sentence, never the toolbar's.
  expect(toolbar.querySelector("[data-testid=pick-agent]")).toBeNull();
});

test("on a wide window a list that is not the tab keeps its name in the toolbar", async () => {
  const view = await open("#/inbox", true);
  const toolbar = view.container.querySelector(".toolbar") as HTMLElement;
  expect(within(toolbar).getByTestId("screen-title").textContent).toBe("수신함");
  expect(shownWords(toolbar)).toContain("수신함");
});
