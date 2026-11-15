import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#219: on the hub an agent row with one card in progress and six stopped read `<name> 1 중단됨 6` and its
// `아직 나눈 대화 없음` was cut: the counts took the preview's width, and the bare 1 read as unread mail. The counts sit
// with the name, in words, and the preview has its own line.

function open(wide: boolean, source: SyntheticSource) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk");
  return render(<App store={new Store(source)} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The hub's shape: one agent with one card in progress, six stopped, and no turn yet. */
function hubShaped(): SyntheticSource {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const cards = source.scene.cards.cards;
  const stopped = cards.find((card) => card.agent === "ag-2" && card.state === "stopped")!;
  for (let index = 0; index < 5; index += 1) cards.push({ ...stopped, id: `k-2${index}` });
  return source;
}

/** Text nodes that are a number alone: a count with no word reads as unread mail. */
function bareNumbers(root: Element): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (/^\s*\d+\s*$/.test(node.textContent ?? "")) found.push(node.textContent!);
  return found;
}

test.each([true, false])("an agent row's counts read 진행 중 n and 중단됨 n on its name line, its preview on its own line (wide %s)", async (wide) => {
  const view = open(wide, hubShaped());
  const row = (index: number) => view.getByTestId(wide ? `nav-talk-${index}` : `talk-agent-${index}`);
  await waitFor(() => expect(row(1).querySelector("[data-testid=talk-preview]")?.textContent).toBe("아직 나눈 대화 없음"));
  const line = row(1).querySelector("[data-testid=talk-name-line]");
  expect(line?.querySelector("[data-testid=talk-running]")?.textContent).toBe("진행 중 1");
  expect(line?.querySelector("[data-testid=talk-stopped]")?.textContent).toBe("중단됨 6");
  expect(line?.textContent).toContain("Mirel");
  const preview = row(1).querySelector("[data-testid=talk-preview]")!;
  expect(line?.contains(preview)).toBe(false);
  expect(preview.parentElement).toBe(line?.parentElement);
  expect(bareNumbers(row(1))).toEqual([]);
  expect(row(1).querySelector("a")?.getAttribute("aria-label")).toBe("Mirel · 진행 중 1 · 중단됨 6");
  // A row with nothing going has no counts and its name alone.
  expect(row(2).querySelector("[data-testid=talk-running], [data-testid=talk-stopped]")).toBeNull();
  expect(row(2).querySelector("a")?.getAttribute("aria-label")).toBe("Quenna");
  view.unmount();
});
