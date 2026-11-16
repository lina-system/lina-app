import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND24, SyntheticSource } from "./data/synthetic-source";

// lina-app#245 (QA round 25, the real hub): each worker run of a card serves its own record, which numbers its rounds
// from 1. A record block's head opens the worker run it was recorded from, never the card's first run. On the hub's
// shapes (&hub=round24, k-450); every text is made up.

const hub = () => new SyntheticSource({ now: Math.floor(Date.now() / 1000), hubRound24: true });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(hub())} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`each record block opens its own worker run, a run of two rounds both times (${width})`, async () => {
    const card = `#/cards/${ROUND24.runsCard}`;
    const view = await open(card, wide);
    await waitFor(() => expect(view.getAllByTestId("timeline-link")).toHaveLength(5));
    const links = view.getAllByTestId("timeline-link");
    // Newest first: w-4504, w-4503's two rounds, w-4502, w-4501, by their place among the card's worker runs.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([4, 3, 3, 2, 1].map((n) => `${card}/runs/${n}`));
    const heads = links.map((link) => link.textContent);
    view.unmount();
    // The address a block links opens that run's page, holding that block's rounds and no other.
    const run = await open(`${card}/runs/3`, wide);
    await waitFor(() => expect(run.getByTestId("screen-run").querySelectorAll("[data-testid=timeline-block]")).toHaveLength(2));
    expect([...run.getByTestId("screen-run").querySelectorAll(".timeline-head")].map((head) => head.textContent)).toEqual(heads.slice(1, 3));
  });
}

// lina-app#252 (QA round 27, the real hub): a record block's link to its worker run is an in-app link like every other:
// it pushes our own history entry, so back returns to the card with the pane's scroll.
for (const wide of [true, false]) {
  test(`a record block's link pushes our history entry and back restores the card's scroll (${wide ? "1280" : "390"})`, async () => {
    const card = `#/cards/${ROUND24.runsCard}`;
    const view = await open(card, wide);
    await waitFor(() => expect(view.getAllByTestId("timeline-link")).toHaveLength(5));
    const pane = (view.container.querySelector(".detail-pane, .sheet, [data-testid=detail-frame]")?.closest(".detail-pane, .sheet") ?? view.container.querySelector("main")) as HTMLElement;
    pane.scrollTop = 321;
    fireEvent.click(view.getAllByTestId("timeline-link")[1]);
    await waitFor(() => expect(window.location.hash).toBe(`${card}/runs/3`));
    expect((window.history.state as { stack: string[] } | null)?.stack).toEqual([card, `${card}/runs/3`]);
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    await waitFor(() => expect(view.getAllByTestId("timeline-link")).toHaveLength(5));
    expect(window.location.hash).toBe(card);
    expect((window.history.state as { scroll: Record<string, number> }).scroll).toMatchObject({});
    expect(Object.values((window.history.state as { scroll: Record<string, number> }).scroll)).toContain(321);
  });
}
