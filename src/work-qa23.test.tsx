import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND23, SyntheticSource } from "./data/synthetic-source";
import { ago } from "./time";
import { SEP, W } from "./words";

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

  test(`the grey line names no one agent and says its time is its newest card's; opened, it counts its cards by agent (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const unnamed = source.scene.cards.cards.filter((card) => ROUND23.unnamed.includes(card.title as (typeof ROUND23.unnamed)[number]));
    const agents = [...new Set(unnamed.map((card) => card.agent))];
    expect(agents.length).toBeGreaterThan(1);
    await finishedLines(view);
    const group = view.getByTestId("section-finished");
    const grey = group.querySelector("[data-testid=row]:has(.title.is-kind)") as HTMLElement;
    // The newest finished card is one nothing names: the grey line is the group's first.
    expect(group.querySelector("[data-testid=row]")).toBe(grey);
    expect(grey.querySelector(".mark:not(.mark-none)")).toBeNull();
    const names = source.scene.items.agents.map((agent) => agent.name);
    const label = grey.querySelector("a")?.getAttribute("aria-label") ?? "";
    expect(names.filter((name) => label.includes(name))).toEqual([]);
    expect(label).toContain(W.agentsCount(agents.length));
    const newest = Math.max(...unnamed.map((card) => card.endedAt ?? 0));
    expect(grey.querySelector(".time")?.textContent).toBe(`${SEP}${W.newest(ago(now() - newest))}`);
    fireEvent.click(grey.querySelector("a") as HTMLElement);
    const box = await waitFor(() => view.getByTestId("fold-members"));
    const rows = [...box.querySelectorAll("[data-testid=fold-agent]")];
    expect(rows).toHaveLength(agents.length);
    expect(rows.reduce((sum, row) => sum + Number(/(\d+)건$/.exec(row.textContent ?? "")?.[1] ?? 0), 0)).toBe(unnamed.length);
    expect(box.querySelectorAll("[data-testid=fold-member]")).toHaveLength(0);
  });
}
