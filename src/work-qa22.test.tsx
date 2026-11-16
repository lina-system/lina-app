import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND22_HOLES, ROUND22_WHOLE, SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#231 (QA round 22, the real hub): finished titles drawn with a hole where a word was cut. The cards here have
// the hub's finished row shape field by field and its list order (&hub=round22); every title is made up.

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound22: true });

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

/** Every finished row's title and how many cards it stands for, with the fold opened. */
async function finishedRows(view: ReturnType<typeof render>) {
  const group = view.getByTestId("section-finished");
  fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
  await waitFor(() => expect(within(group).queryByRole("button", { name: `${W.done} ${W.close}` })).not.toBeNull());
  return [...group.querySelectorAll("[data-testid=row]")].map((row) => ({
    grey: row.querySelector(".title.is-kind") !== null,
    title: row.querySelector(".title")?.textContent ?? "",
    sub: row.querySelector("[data-testid=row-sub]")?.textContent ?? null,
    cards: Number(/(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1),
  }));
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a finished title is drawn as written, less a bracket of refs, or counted in the grey line: no hole (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const rows = await finishedRows(view);
    const total = source.scene.cards.cards.filter((card) => card.state === "done").length;
    expect(rows.reduce((sum, row) => sum + row.cards, 0)).toBe(total);
    expect(Number(view.getByTestId("head-finished").querySelector("[data-testid=count]")?.textContent)).toBe(total);
    // The scene's titles as written, each less only a bracket of refs: every drawn line is one of them.
    const written = new Set([...source.scene.cards.cards.map((card) => card.title), ...ROUND22_WHOLE.map(([, drawn]) => drawn)]);
    for (const row of rows.filter((each) => !each.grey)) {
      expect(written.has(row.title), row.title).toBe(true);
      if (row.sub !== null) expect(written.has(row.sub), row.sub).toBe(true);
    }
    for (const [, drawn] of ROUND22_WHOLE) expect(rows.some((row) => row.title === drawn)).toBe(true);
    // The hole shapes are the grey line's cards and none of them is drawn.
    const grey = rows.filter((row) => row.grey);
    expect(grey).toHaveLength(1);
    expect(grey[0].cards).toBe(ROUND22_HOLES.length);
    expect(rows.some((row) => /\(\s*\)|\(\d+\)|@|^[·,]|^(용|을|를)\s/.test(row.title))).toBe(false);
    expect(view.container.textContent).not.toContain(W.untitled);
  });

  test(`the grey line says what it holds, never a bare kind word, and counts its cards once (${width})`, async () => {
    const view = await open("#/", hub(), wide);
    const rows = await finishedRows(view);
    const grey = rows.filter((row) => row.grey);
    expect(grey.map((row) => row.title)).toEqual([W.untitledCount(ROUND22_HOLES.length)]);
    expect(rows.some((row) => row.title === W.cards || row.title.startsWith(`${W.cards} ×`))).toBe(false);
    const link = view.getByTestId("section-finished").querySelector("[data-testid=row] .title.is-kind")?.closest("a");
    expect(link?.getAttribute("aria-label")).toContain(W.untitledCount(ROUND22_HOLES.length));
  });
}
