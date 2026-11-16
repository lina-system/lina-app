import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND23_RUNS, SyntheticSource } from "./data/synthetic-source";

// lina-app#238: on the hub a card's history heads linked to `#/runs/OT-…`, a worker task id: no screen text, but the
// address shows on hover and in the browser's status bar. A card's worker run is named by the card and its place among
// the card's worker runs, and that address opens the same run page, after a reload too. The hub's shape (&hub=round23).

const now = () => Math.floor(Date.now() / 1000);
const TASK_ID = /OT-[A-Z]+\d+/;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(new SyntheticSource({ now: now(), hubRound23: true }))} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

async function runPage(view: ReturnType<typeof render>): Promise<string> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=screen-run]")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=screen-run] [data-testid=detail-loading]")).toBeNull());
  return view.container.querySelector("[data-testid=screen-run]")?.textContent ?? "";
}

for (const wide of [true, false]) {
  test(`a card's history heads link to its worker runs by the card and their place in it, never by a task id (${wide ? 1280 : 390})`, async () => {
    const view = await open("#/cards/k-101", wide);
    await waitFor(() => expect(view.getAllByTestId("timeline-link").length).toBeGreaterThan(0));
    const hrefs = [...document.querySelectorAll("a[href]")].map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.filter((href) => TASK_ID.test(href) || href.startsWith("#/runs/"))).toEqual([]);
    const heads = view.getAllByTestId("timeline-link").map((link) => link.getAttribute("href"));
    // k-101's worker runs as the hub lists them: rounds 1 and 2, then the one going now; `wait` is no run.
    expect(heads).toEqual(["#/cards/k-101/runs/3", "#/cards/k-101/runs/2", "#/cards/k-101/runs/1"]);
  });
}

test("a round's address opens the page its worker run's own address opened, read from the address alone", async () => {
  for (const [place, run] of [["1", ROUND23_RUNS.r9], ["3", ROUND23_RUNS.r1]] as const) {
    const byId = await runPage(await open(`#/runs/${run}`));
    document.body.innerHTML = "";
    const byPlace = await runPage(await open(`#/cards/k-101/runs/${place}`));
    document.body.innerHTML = "";
    expect(byPlace).toBe(byId);
    expect(byPlace).not.toBe("");
  }
});
