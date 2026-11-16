import { render, waitFor } from "@testing-library/preact";
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
