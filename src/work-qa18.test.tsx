import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { localDay } from "./model";
import { STATE_WORD, W } from "./words";

// lina-app#221 (QA round 18, the real hub): the work tab's 완료 counted cards in its head and the sidebar, cards less the
// shown lines in its fold and lines once open (524, 외 519개, 514 lines); a finished line nothing named read 제목 없음 ×2
// (since lina-app#225 every number counts cards, and the cards nothing names are one grey line);
// and an open to-do past its due date read 예정. The cards here have the hub's finished-row shape (no checked title,
// result or now line, no goal title, read-only, an old card with no history kept, &hub=round18); every title is made up.

const now = () => Math.floor(Date.now() / 1000);

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The hub's shapes of 11-16 (round18Scene): 524 finished cards folding to 514 lines, 2 nothing names, T3 overdue. */
const hub = () => new SyntheticSource({ now: now(), hubRound18: true });

async function open(hash: string, source: SyntheticSource, wide: boolean) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

const count = (element: Element | null) => Number(element?.querySelector("[data-testid=count]")?.textContent ?? "0");
const sidebarDone = (view: ReturnType<typeof render>) => Number(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")?.textContent ?? "0");

/** What 완료 draws: its head's number, its rows and the cards they stand for, the fold's `외 n개`, whether it reads, and its hide button. */
function finished(view: ReturnType<typeof render>) {
  const group = view.getByTestId("section-finished");
  const more = group.querySelector(".more-row");
  const rows = [...group.querySelectorAll("[data-testid=row]")];
  return {
    head: count(view.getByTestId("head-finished")),
    rows: rows.length,
    cards: rows.reduce((sum, row) => sum + Number(/(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0),
    fold: Number(/외 (\d+)개/.exec(more?.textContent ?? "")?.[1] ?? 0),
    loading: more?.textContent === W.loading,
    hide: within(group).queryByRole("button", { name: `${W.done} ${W.close}` }) !== null,
  };
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`${W.done}: 524 cards folded to 514 rows, one of them the cards nothing names, read one number everywhere, before, while and after the rest is read (${width})`, async () => {
    const view = await open("#/", hub(), wide);
    const before = finished(view);
    // The newest five lines, and the fold the 519 cards they do not stand for.
    expect(before).toEqual({ head: 524, rows: 5, cards: 5, fold: 519, loading: false, hide: false });
    if (wide) expect(sidebarDone(view)).toBe(524);
    const group = view.getByTestId("section-finished");
    const states: ReturnType<typeof finished>[] = [];
    const watch = new MutationObserver(() => states.push(finished(view)));
    watch.observe(group, { subtree: true, childList: true, characterData: true });
    fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
    await waitFor(() => expect(finished(view).hide).toBe(true));
    watch.disconnect();
    // At every moment between the tap and the settled list, the head is 524 and, but while it reads, the cards drawn and the fold.
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) expect(state.loading ? { head: state.head, rows: state.rows } : { head: state.head, cards: state.cards + state.fold }).toEqual(state.loading ? { head: before.head, rows: before.rows } : { head: 524, cards: 524 });
    const after = finished(view);
    expect(after).toEqual({ head: 524, rows: 514, cards: 524, fold: 0, loading: false, hide: true });
    if (wide) expect(sidebarDone(view)).toBe(524);
    // A fold stays on its row and says how many cards it holds; the two nothing names are the last, grey.
    expect([...group.querySelectorAll("[data-testid=row]")].map((row) => /(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1]).filter(Boolean)).toEqual(["4", "5", "2", "2", "2"]);
    expect([...group.querySelectorAll("[data-testid=row] .title.is-kind")].map((title) => title.textContent)).toEqual([W.untitledCount(2)]);
    expect(view.container.textContent).not.toContain(W.untitled);
    // Hiding restores the collapsed view: the first five rows and one fold for the rest, the head unchanged.
    fireEvent.click(within(group).getByRole("button", { name: `${W.done} ${W.close}` }));
    expect(finished(view)).toEqual({ head: 524, rows: 5, cards: 5, fold: 519, loading: false, hide: false });
    if (wide) expect(sidebarDone(view)).toBe(524);
    // Opened again, it is the whole list at once: nothing is read twice.
    fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
    expect(finished(view)).toEqual({ head: 524, rows: 514, cards: 524, fold: 0, loading: false, hide: true });
  });

  test(`${W.done} screen: each choice counts the cards its rows stand for, the sidebar's number (${width})`, async () => {
    const view = await open("#/done", hub(), wide);
    const list = await waitFor(() => view.getByRole("list", { name: W.done }));
    const all = view.getByRole("button", { name: new RegExp(`^${W.allAgents} \\d+$`) });
    expect(list.querySelectorAll("[data-testid=row]").length).toBe(514);
    expect(Number(all.querySelector(".count")?.textContent)).toBe(524);
    if (wide) expect(sidebarDone(view)).toBe(524);
    expect(view.container.textContent).not.toContain(W.untitled);
  });

  test(`a planned to-do past its due date reads ${W.dueOverdue}, never ${STATE_WORD.planned}, on its 내 할 일 row, its goal's line and its head (${width})`, async () => {
    const source = hub();
    // T3 is the owner's planned to-do under G1, due before the scene's clock as such a to-do was on the hub.
    expect(source.scene.itemDetails.T3).toMatchObject({ state: "planned" });
    expect((source.scene.itemDetails.T3.due ?? "") < localDay(source.scene.now)).toBe(true);
    const home = await open("#/", source, wide);
    const row = within(home.getByTestId("home-mine")).getAllByTestId("row").find((each) => each.textContent?.includes("공지 문구 확인"));
    expect(row?.querySelector(".trail .kind-word")?.textContent).toBe(W.dueOverdue);
    expect(row?.querySelector(".due-date")?.classList.contains("is-overdue")).toBe(true);
    expect(row?.querySelector("a")?.getAttribute("aria-label")).toContain(W.dueOverdue);
    home.unmount();
    document.body.innerHTML = "";

    const goal = await open("#/goals/G1", source, wide);
    const frame = await waitFor(() => goal.getByTestId("detail-frame"));
    const line = await waitFor(() => {
      const found = within(frame).getAllByTestId("row").find((each) => each.textContent?.includes("공지 문구 확인"));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(line.querySelector("[data-testid=state]")?.textContent).toBe(W.dueOverdue);
    expect(line.querySelector("a")?.getAttribute("aria-label")).not.toContain(STATE_WORD.planned);
    goal.unmount();
    document.body.innerHTML = "";

    const item = await open("#/items/T3", source, wide);
    await waitFor(() => expect(item.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")).not.toBeNull());
    expect(item.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")?.textContent).toBe(W.dueOverdue);
    expect(item.getByTestId("item-due").textContent).toContain(W.due);
  });
}

test(`a planned to-do due today or later still reads ${STATE_WORD.planned}`, async () => {
  const source = new SyntheticSource({ now: now() });
  const view = await open("#/items/T3", source, true);
  await waitFor(() => expect(view.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")).not.toBeNull());
  expect(source.scene.itemDetails.T3.due && source.scene.itemDetails.T3.due >= localDay(source.scene.now)).toBe(true);
  expect(view.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")?.textContent).toBe(STATE_WORD.planned);
});
