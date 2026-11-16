import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND23, SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#237 (QA round 23, the real hub): the work tab's 완료 group and the goal views. The cards and goals here have
// the hub's row and record shapes field by field (&hub=round23); every title is made up.

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound23: true });

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, source: SyntheticSource, wide: boolean) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

/** Every finished line with the fold opened: its title less its `×n`, and the cards it says it stands for. */
async function finishedLines(view: ReturnType<typeof render>) {
  const group = view.getByTestId("section-finished");
  const fold = group.querySelector(".more-row:not([data-testid=fold-hide]) button");
  if (fold) fireEvent.click(fold);
  await waitFor(() => expect(within(group).queryByRole("button", { name: `${W.done} ${W.close}` })).not.toBeNull());
  return [...group.querySelectorAll("[data-testid=row]")].map((row) => {
    const title = row.querySelector(".title")?.textContent ?? "";
    return { title: title.replace(/ ×\d+$/, ""), cards: Number(/×(\d+)$/.exec(title)?.[1] ?? /(\d+)건/.exec(title)?.[1] ?? 1) };
  });
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a title is one line in 완료, its ×n counting every card under it (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const lines = await finishedLines(view);
    const titles = lines.map((line) => line.title);
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
    const total = source.scene.cards.cards.filter((card) => card.state === "done").length;
    expect(lines.reduce((sum, line) => sum + line.cards, 0)).toBe(total);
    expect(lines.find((line) => line.title === ROUND23.weekly)?.cards).toBe(5 + ROUND23.weeklyOwn.length);
    expect(lines.find((line) => line.title === ROUND23.order)?.cards).toBe(ROUND23.orderOwn.length);
    expect(lines.find((line) => line.title === ROUND23.move)?.cards).toBe(2);
  });
}
