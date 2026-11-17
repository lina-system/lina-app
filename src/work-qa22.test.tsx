import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND22_CONDITION, ROUND22_HOLES, ROUND22_LATIN, ROUND22_WHOLE, SyntheticSource } from "./data/synthetic-source";
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
  // The group reads every finished card first (lina-app#237); its fold opens them once it says how many lines it holds.
  await waitFor(() => expect(group.querySelector(".more-row")?.textContent).toMatch(/^외 \d+개$/));
  fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
  await waitFor(() => expect(within(group).queryByRole("button", { name: `${W.done} ${W.close}` })).not.toBeNull());
  return [...group.querySelectorAll("[data-testid=row]")].map((row) => ({
    grey: row.querySelector(".title.is-kind") !== null,
    title: (row.querySelector(".title")?.textContent ?? "").replace(/ ×\d+$/, ""),
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
    const written = new Set([...source.scene.cards.cards.flatMap((card) => [card.title, (card as { goalTitle?: string | null }).goalTitle ?? ""]), ...ROUND22_WHOLE.map(([, drawn]) => drawn)]);
    for (const row of rows.filter((each) => !each.grey)) {
      expect(written.has(row.title), row.title).toBe(true);
      if (row.sub !== null) expect(written.has(row.sub), row.sub).toBe(true);
    }
    for (const [, drawn] of ROUND22_WHOLE) expect(rows.some((row) => row.title === drawn)).toBe(true);
    // A Latin word is no cut: the shapes a cut one left a hole in are drawn as written.
    for (const title of ROUND22_LATIN) expect(rows.some((row) => row.title === title), title).toBe(true);
    // The hole shapes are the grey line's cards and none of them is drawn.
    const grey = rows.filter((row) => row.grey);
    expect(grey).toHaveLength(1);
    expect(grey[0].cards).toBe(ROUND22_HOLES.length);
    expect(rows.some((row) => !ROUND22_LATIN.includes(row.title) && /\(\s*\)|\(\d+\)|@|^[·,]|^(용|을|를)\s/.test(row.title))).toBe(false);
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

  test(`a goal's row under 대화 and its page read one done condition, by one rule, with no issue reference, and one state (${width})`, async () => {
    const source = hub();
    const agent = source.scene.items.agents[0].id;
    // G6 is the record's shape the hub showed: waiting 16 days, 14/16, a done condition with refs; G1 runs a card.
    expect(source.scene.items.items.find((item) => item.id === "G6")).toMatchObject({ state: "waiting", todos: { done: 14, total: 16 }, doneCondition: ROUND22_CONDITION });
    const list = await open(`#/talk/${agent}`, source, wide);
    const card = list.getByTestId("agent-card");
    const toggle = card.querySelector<HTMLElement>(".agent-card-toggle");
    if (toggle) fireEvent.click(toggle);
    const rows: Record<string, { state: string | null; condition: string | null; progress: string | null }> = {};
    for (const id of ["G6", "G1"]) {
      const row = card.querySelector(`a[href$="goal=${id}"]`)?.closest("[data-testid=row]");
      rows[id] = {
        state: row?.querySelector("[data-testid=goal-state]")?.textContent ?? null,
        condition: row?.querySelector(".sub.wrap-line")?.textContent ?? null,
        progress: row?.querySelector("[data-testid=goal-progress]")?.textContent ?? null,
      };
    }
    expect(rows.G6.progress).toBe(W.progress(14, 16));
    list.unmount();
    document.body.innerHTML = "";
    for (const id of ["G6", "G1"]) {
      const page = await open(`#/talk/${agent}?goal=${id}`, hub(), wide);
      const frame = await waitFor(() => page.getByTestId("screen-goal"));
      const head = frame.querySelector(".detail-head [data-testid=state]")?.closest(".sub")?.textContent ?? null;
      const box = [...frame.querySelectorAll(".box")].find((each) => each.querySelector(".box-head")?.textContent === W.doneCondition);
      expect(rows[id].state, id).toBe(head);
      expect(rows[id].condition, id).toBe(box?.querySelector(".box-text")?.textContent ?? null);
      expect(frame.textContent, id).not.toMatch(/#\d/);
      page.unmount();
      document.body.innerHTML = "";
    }
    expect(rows.G6.state).toMatch(/^대기 · 16일 전$/);
    expect(rows.G1.state).toMatch(/^진행 중 · /);
  });
}
