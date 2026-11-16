import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { FINISHED_SHOWN, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#186: the work tab reads its first finished cards only, and its 완료 group reads the rest right after
// (lina-app#237). The 완료 head and the sidebar's 완료 count the cards (a `×n` line counts n, lina-app#225); the fold
// `외 n개` counts the lines it opens, never a number counted from a part of the list.

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
/** The fold under the rows while it holds any back: `외 n개`, or 불러오는 중 while the rest is read (not the opened fold's 닫기). */
const FOLD = ".more-row:not([data-testid=fold-hide])";
/** What the group draws: its lines, the cards they stand for (a `×n` line counts n), its fold's text and its n. */
function drawn(group: HTMLElement): { lines: number; cards: number; fold: string | null; more: number } {
  const rows = [...group.querySelectorAll("[data-testid=row]")];
  const fold = group.querySelector(FOLD)?.textContent ?? null;
  const cards = rows.reduce((sum, row) => sum + Number(/(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0);
  return { lines: rows.length, cards, fold, more: Number(/^외 (\d+)개$/.exec(fold ?? "")?.[1] ?? 0) };
}

test("collapsed: the 완료 head and the sidebar count the cards; the fold counts the lines it opens", async () => {
  const view = await open("#/", new SyntheticSource({ now: now(), manyFinished: true }));
  const group = view.getByTestId("section-finished");
  await waitFor(() => expect(drawn(group).more).toBeGreaterThan(0));
  const total = headDone(view);
  expect(total).toBeGreaterThan(10);
  expect(sidebarDone(view)).toBe(total);
  const shown = drawn(group);
  expect(shown.lines).toBe(FINISHED_SHOWN);
  expect(within(group).getByRole("button", { name: `${W.done} ${W.more(shown.more)}` }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(group.querySelector(`${FOLD} button`) as HTMLElement);
  expect(drawn(group)).toEqual({ lines: shown.lines + shown.more, cards: total, fold: null, more: 0 });
});

test("first load: the rest is read with a loading line in the fold's place, and no number moves", async () => {
  const source = new SyntheticSource({ now: now(), manyFinished: true });
  const view = await open("#/", source);
  const group = view.getByTestId("section-finished");
  // The head draws no number while the rest is read (lina-app#242): the cards, once they are in.
  const total = source.scene.cards.cards.filter((card) => card.state === "done").length;
  const states: ReturnType<typeof drawn>[] = [drawn(group)];
  const watch = new MutationObserver(() => states.push(drawn(group)));
  watch.observe(group, { subtree: true, childList: true, characterData: true });
  await waitFor(() => expect(drawn(group).more).toBeGreaterThan(0));
  watch.disconnect();
  expect(states.some((state) => state.fold === W.loading)).toBe(true);
  const settled = drawn(group);
  for (const state of states) expect(state.fold === W.loading || state.more === settled.more, JSON.stringify(state)).toBe(true);
  expect(headDone(view)).toBe(total);
  expect(sidebarDone(view)).toBe(total);
});

// lina-app#217: the finished count moves while the group reads the rest. The read of every finished card counts its total
// apart from its list, at another moment: `lags` counted before four more cards finished, `leads` after the list was
// cut. While the rest is read the head stays and the fold says it reads; once it is in, the head is the cards that read
// sent, and the fold the lines it opens (lina-app#237).
for (const wide of [true, false]) {
  test.each([
    ["lags", 4, 0],
    ["leads", 0, 4],
  ] as const)(`a count that %s the cards the read sends: the ${W.done} head stays while the rest is read, then is the cards sent, and the fold the lines it opens (${wide ? "1280" : "390"})`, async (_case, finishing, ahead) => {
    const source = new SyntheticSource({ now: now(), manyFinished: true });
    const counted = source.scene.cards.cards.filter((card) => card.state === "done").length;
    const template = source.scene.cards.cards.find((card) => card.state === "done");
    // Every read without a limit waits for release: the group's read of the rest, and a refresh queued behind it.
    const held: (() => void)[] = [];
    let holding = true;
    const release = () => {
      holding = false;
      for (let index = 0; index < finishing && template; index++) source.scene.cards.cards.push(Object.assign({ ...template, id: `k-${900 + index}`, plain: { ...template.plain, title: `${template.plain.title} ${index + 1}` }, endedAt: now(), lastHeartbeatAt: now() }, { goalTitle: null }));
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
    await waitFor(() => expect(drawn(group).fold).toBe(W.loading));
    const before = { head: headDone(view), ...drawn(group) };
    const states: { head: number; fold: string | null; more: number }[] = [];
    new MutationObserver(() => states.push({ head: headDone(view), ...drawn(group) })).observe(group, { subtree: true, childList: true, characterData: true });
    release();
    await waitFor(() => expect(drawn(group).more).toBeGreaterThan(0));
    const sent = counted + finishing;
    const settled = drawn(group);
    // While the rest is read the head is what it was; every other moment it is the cards sent, and the fold one number.
    for (const state of states) expect(state.fold === W.loading ? state.head : { head: state.head, more: state.more }).toEqual(state.fold === W.loading ? before.head : { head: sent, more: settled.more });
    expect(headDone(view)).toBe(sent);
    if (wide) expect(sidebarDone(view)).toBe(sent);
    fireEvent.click(group.querySelector(`${FOLD} button`) as HTMLElement);
    expect(drawn(group)).toEqual({ lines: settled.lines + settled.more, cards: sent, fold: null, more: 0 });
  });
}

// lina-app#242: on the hub the head read 535 while the first page was in and 532 after: the core's total of finished cards
// is counted apart from the cards its full read sends. Until the page holds every finished card, the head and the
// sidebar draw no number; from then on both are the cards the group's lines stand for, the first page, the full read and
// a later read alike. The full read is held, as a slow core's, until released.
test("while the first page is in, the 완료 head and the sidebar draw no number; once every card is in, both are the cards its lines stand for, also after a later read", async () => {
  const source = new SyntheticSource({ now: now(), manyFinished: true });
  const counted = source.scene.cards.cards.filter((card) => card.state === "done").length;
  const held: (() => void)[] = [];
  let holding = true;
  const read = source.read.bind(source);
  source.read = (async (name, id) => {
    if (name === "cards" && id === undefined && holding) await new Promise<void>((go) => held.push(go));
    const result = await read(name, id);
    // The core's total counts three more than its full read sends.
    return name === "cards" && id !== undefined && result.kind === "data" ? { ...result, data: { ...result.data, finishedTotal: counted + 3 } } : result;
  }) as SyntheticSource["read"];
  setWide(true);
  window.history.replaceState(null, "", "/app/#/");
  const store = new Store(source);
  const view = render(<App store={store} />);
  const group = await waitFor(() => view.getByTestId("section-finished"));
  const number = (element: Element | null) => element?.querySelector("[data-testid=count], [data-testid=nav-count]")?.textContent ?? null;
  const state = () => ({ head: number(view.getByTestId("head-finished")), sidebar: number(view.getByTestId("nav-done")), fold: drawn(group).fold });
  const states = [state()];
  const watch = new MutationObserver(() => states.push(state()));
  watch.observe(view.container, { subtree: true, childList: true, characterData: true });
  await waitFor(() => expect(drawn(group).fold).toBe(W.loading));
  holding = false;
  for (const go of held.splice(0)) go();
  await waitFor(() => expect(drawn(group).more).toBeGreaterThan(0));
  // A later read of every card, held too, leaves the numbers as they are.
  holding = true;
  const later = store.refresh();
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  holding = false;
  for (const go of held.splice(0)) go();
  await later;
  watch.disconnect();
  states.push(state());
  for (const each of states) expect({ head: each.head, sidebar: each.sidebar }, JSON.stringify(each)).toEqual(each.fold === W.loading ? { head: null, sidebar: null } : { head: String(counted), sidebar: String(counted) });
  fireEvent.click(group.querySelector(`${FOLD} button`) as HTMLElement);
  expect(drawn(group).cards).toBe(counted);
});

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
