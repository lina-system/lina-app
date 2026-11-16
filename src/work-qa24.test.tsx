import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND23, SyntheticSource } from "./data/synthetic-source";
import { ago } from "./time";
import { SEP, STATE_WORD, W } from "./words";

// lina-app#242 (QA round 24, the real hub): the grey line's detail, rows told apart by their first line, a goal's work
// list and its head. The cards and goals here have the hub's row and record shapes field by field (&hub=round24, on top
// of round 23's); every title is made up.

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound24: true });

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

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`the grey line's detail speaks of the line: how many cards, how many agents, the newest time, no one card's head (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const unnamed = source.scene.cards.cards.filter((card) => ROUND23.unnamed.includes(card.title as (typeof ROUND23.unnamed)[number]));
    const group = view.getByTestId("section-finished");
    await waitFor(() => expect(group.querySelector(".more-row:not([data-testid=fold-hide])")?.textContent).toMatch(/^외 \d+개$/));
    const grey = group.querySelector("[data-testid=row]:has(.title.is-kind)") as HTMLElement;
    const count = Number(/제목 없는 (\d+)건/.exec(grey.textContent ?? "")?.[1]);
    expect(count).toBeGreaterThan(unnamed.length);
    fireEvent.click(grey.querySelector("a") as HTMLElement);
    const head = await waitFor(() => view.getByTestId("group-head"));
    const detail = head.closest("article") as HTMLElement;
    expect(detail.querySelector("h1")?.textContent).toBe(W.untitledCount(count));
    const newest = Math.max(...source.scene.cards.cards.filter((card) => card.state === "done").map((card) => card.endedAt ?? 0));
    expect(head.textContent).toBe([STATE_WORD.done, W.newest(ago(now() - newest))].join(SEP));
    const agents = Number(/에이전트 (\d+)명/.exec(grey.textContent ?? "")?.[1]);
    expect(within(detail).getByTestId("group-agents").textContent).toBe(W.agentsCount(agents));
    // No one card's words: its title placeholder, how long it took, or that it is read-only.
    expect(detail.textContent).not.toContain(W.untitled);
    expect(detail.textContent).not.toMatch(/소요 /);
    expect(detail.querySelector("[data-testid=read-only]")).toBeNull();
    const rows = [...detail.querySelectorAll("[data-testid=fold-agent]")];
    expect(rows.reduce((sum, row) => sum + Number(/(\d+)건$/.exec(row.textContent ?? "")?.[1] ?? 0), 0)).toBe(count);
  });

}
