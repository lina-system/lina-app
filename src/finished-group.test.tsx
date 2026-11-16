import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { FINISHED_SHOWN, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#186: the work tab reads its first finished cards only; the 완료 head, the sidebar's 완료 and the rows (one each,
// a `×n` line too, and the fold its `외 n개`, lina-app#221) are one number before and after the fold opens the rest.

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

const now = () => Math.floor(Date.now() / 1000);

async function open(hash: string, source: SyntheticSource) {
  setWide(true);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  // A current screen draws no freshness word since lina-app#187: the quiet head is the loaded screen.
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const sidebarDone = (view: ReturnType<typeof render>) => Number(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")?.textContent ?? "0");
const headDone = (view: ReturnType<typeof render>) => Number(view.getByTestId("head-finished").querySelector("[data-testid=count]")?.textContent);
/** The fold under the rows while it holds any back: `외 n개`, or 불러오는 중 while it reads them (not the opened fold's 닫기). */
const FOLD = ".more-row:not([data-testid=fold-hide])";
/** The rows the group stands for: the lines drawn, one each, and the fold's `외 n개`. */
function rowCards(group: HTMLElement): { lines: number; fold: number; cards: number } {
  const lines = group.querySelectorAll("[data-testid=row]").length;
  const fold = Number(/외 (\d+)개/.exec(group.querySelector(FOLD)?.textContent ?? "")?.[1] ?? 0);
  return { lines, fold, cards: lines + fold };
}

test("collapsed: the 완료 head, the sidebar's 완료 and the rows with their fold are one number", async () => {
  const view = await open("#/", new SyntheticSource({ now: now(), manyFinished: true }));
  const group = view.getByTestId("section-finished");
  const total = headDone(view);
  expect(total).toBeGreaterThan(10);
  expect(sidebarDone(view)).toBe(total);
  const shown = rowCards(group);
  expect(shown.cards).toBe(total);
  expect(shown.lines).toBeLessThan(total);
  expect(shown.fold).toBeGreaterThan(0);
  expect(within(group).getByRole("button", { name: `${W.done} ${W.more(shown.fold)}` }).getAttribute("aria-expanded")).toBe("false");
});

test("opened: the fold loads the rest with a loading line in its place, and no number moves", async () => {
  const view = await open("#/", new SyntheticSource({ now: now(), manyFinished: true }));
  const group = view.getByTestId("section-finished");
  const total = headDone(view);
  fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
  const loading = group.querySelector(".more-row");
  expect(loading?.textContent).toBe(W.loading);
  expect(loading?.getAttribute("aria-busy")).toBe("true");
  expect(headDone(view)).toBe(total);
  expect(sidebarDone(view)).toBe(total);
  await waitFor(() => expect(group.querySelector(FOLD)).toBeNull());
  expect(headDone(view)).toBe(total);
  expect(sidebarDone(view)).toBe(total);
  expect(rowCards(group)).toEqual({ lines: total, fold: 0, cards: total });
});

// lina-app#217: the finished count moves while the fold reads the rest. The read of every finished card counts its total
// apart from its list, at another moment: `lags` counted before four more cards finished, `leads` after the list was
// cut. The head is the lines and the fold at every moment, and once the rest is in, the lines of the cards that read
// sent, each of its own (lina-app#221).
for (const wide of [true, false]) {
  test.each([
    ["lags", 4, 0],
    ["leads", 0, 4],
  ] as const)(`a count that %s the cards the read sends: the ${W.done} head, the fold and the lines are one number at every moment (${wide ? "1280" : "390"})`, async (_case, finishing, ahead) => {
    const source = new SyntheticSource({ now: now(), manyFinished: true });
    const counted = source.scene.cards.cards.filter((card) => card.state === "done").length;
    const template = source.scene.cards.cards.find((card) => card.state === "done");
    // Every read without a limit waits for release: a refresh already queued reads them all too once the fold is open.
    const held: (() => void)[] = [];
    let holding = true;
    const release = () => {
      holding = false;
      for (let index = 0; index < finishing && template; index++) source.scene.cards.cards.push({ ...template, id: `k-${900 + index}`, plain: { ...template.plain, title: `${template.plain.title} ${index + 1}` }, endedAt: now(), lastHeartbeatAt: now() });
      for (const go of held.splice(0)) go();
    };
    const read = source.read.bind(source);
    source.read = (async (name, id) => {
      if (name !== "cards" || id !== undefined) return read(name, id);
      if (holding) await new Promise<void>((go) => held.push(go));
      const result = await read(name, id);
      return result.kind === "data" ? { ...result, data: { ...result.data, finishedTotal: counted + ahead } } : result;
    }) as SyntheticSource["read"];
    setWide(wide);
    window.history.replaceState(null, "", "/app/#/");
    const view = render(<App store={new Store(source)} />);
    await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
    const group = view.getByTestId("section-finished");
    const before = { head: headDone(view), ...rowCards(group) };
    expect(before.cards).toBe(before.head);
    const states: { head: number; loading: boolean; lines: number; cards: number }[] = [];
    new MutationObserver(() => states.push({ head: headDone(view), loading: group.querySelector(".more-row")?.textContent === W.loading, ...rowCards(group) })).observe(group, { subtree: true, childList: true, characterData: true });
    fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
    await waitFor(() => expect(group.querySelector(".more-row")?.textContent).toBe(W.loading));
    release();
    await waitFor(() => expect(group.querySelector(FOLD)).toBeNull());
    const sent = before.head + finishing;
    // While the rest is read nothing moves; every other moment the head is its lines and its fold.
    for (const state of states) expect(state.loading ? { head: state.head, lines: state.lines } : state.head).toEqual(state.loading ? { head: before.head, lines: before.lines } : state.cards);
    expect(rowCards(group)).toEqual({ lines: sent, fold: 0, cards: sent });
    expect(headDone(view)).toBe(sent);
    if (wide) expect(sidebarDone(view)).toBe(sent);
  });
}

test("empty: with no finished card there is no 완료 group, and the sidebar's 완료 has no number", async () => {
  const source = new SyntheticSource({ now: now() });
  source.scene.cards.cards.splice(0, source.scene.cards.cards.length, ...source.scene.cards.cards.filter((card) => card.state !== "done"));
  const view = await open("#/", source);
  expect(view.queryByTestId("section-finished")).toBeNull();
  expect(sidebarDone(view)).toBe(0);
});

test("완료 opened first reads every finished card in its first read, and its 전체 is the sidebar's number", async () => {
  const source = new SyntheticSource({ now: now(), manyFinished: true });
  const cards: (string | undefined)[] = [];
  const read = source.read.bind(source);
  source.read = ((name, id) => {
    if (name === "cards") cards.push(id);
    return read(name, id);
  }) as SyntheticSource["read"];
  const view = await open("#/done", source);
  await waitFor(() => expect(view.getByTestId("screen-done")).toBeTruthy());
  expect(cards[0]).toBeUndefined();
  const all = view.getByRole("button", { name: new RegExp(`^${W.allAgents} \\d+$`) });
  expect(Number(all.querySelector(".count")?.textContent)).toBe(sidebarDone(view));
});

test("a worker run opened on its own, whose card is an older finished one, reads that card: its title and the link to it", async () => {
  const source = new SyntheticSource({ now: now(), manyFinished: true });
  const finished = source.scene.cards.cards.filter((card) => card.state === "done").sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  const old = finished[0];
  // Past the few finished cards the work tab reads first.
  expect(finished.slice(-FINISHED_SHOWN).map((card) => card.id)).not.toContain(old.id);
  Object.assign(source.scene.cardDetails, { [old.id]: { ...source.scene.cardDetails["k-105"], id: old.id, workerRuns: [], runs: [] } });
  Object.assign(source.scene.records, { r99: { ...source.scene.records.r1, id: "r99", cardId: old.id } });
  const view = await open("#/runs/r99", source);
  const run = await waitFor(() => view.getByTestId("screen-run"));
  await waitFor(() => expect(run.querySelector(`a[href="#/cards/${old.id}"]`)).not.toBeNull());
  expect(view.container.textContent).not.toContain(W.untitled);
  expect(run.textContent).toContain(old.plain.title);
});
