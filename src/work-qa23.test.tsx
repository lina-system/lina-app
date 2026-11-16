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
  await waitFor(() => expect(group.querySelector(".more-row:not([data-testid=fold-hide])")?.textContent).toMatch(/^외 \d+개$/));
  fireEvent.click(group.querySelector(".more-row:not([data-testid=fold-hide]) button") as HTMLElement);
  await waitFor(() => expect(within(group).queryByRole("button", { name: `${W.done} ${W.close}` })).not.toBeNull());
  return [...group.querySelectorAll("[data-testid=row]")].map((row) => {
    const title = row.querySelector(".title")?.textContent ?? "";
    return { title: title.replace(/ ×\d+$/, ""), cards: Number(/×(\d+)$/.exec(title)?.[1] ?? /(\d+)건/.exec(title)?.[1] ?? 1) };
  });
}

/** The 완료 group as a person counts it: its head, the lines drawn and the number its fold says it holds back. */
function counted(view: ReturnType<typeof render>) {
  const group = view.getByTestId("section-finished");
  const fold = group.querySelector(".more-row:not([data-testid=fold-hide])")?.textContent ?? null;
  return { head: Number(group.querySelector("[data-testid=head-finished] [data-testid=count]")?.textContent), lines: group.querySelectorAll("[data-testid=row]").length, fold, more: fold === null ? 0 : Number(/^외 (\d+)개$/.exec(fold)?.[1] ?? NaN) };
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`외 n개 counts the lines the fold opens, on first load and later, and opened they are all the group's lines (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const total = source.scene.cards.cards.filter((card) => card.state === "done").length;
    // Never a number counted from the few finished cards the page read first: it reads the rest, then counts lines.
    const seen: ReturnType<typeof counted>[] = [];
    const group = view.getByTestId("section-finished");
    new MutationObserver(() => seen.push(counted(view))).observe(group, { subtree: true, childList: true, characterData: true });
    seen.push(counted(view));
    await waitFor(() => expect(counted(view).fold).toMatch(/^외 \d+개$/));
    const first = counted(view);
    for (const state of seen) expect(state.fold === null || state.fold === W.loading || state.more === first.more, JSON.stringify(state)).toBe(true);
    expect(first.head).toBe(total);
    const lines = await finishedLines(view);
    expect(first.lines + first.more).toBe(lines.length);
    expect(lines.reduce((sum, line) => sum + line.cards, 0)).toBe(first.head);
    // Folded again, the same lines and the same number.
    fireEvent.click(within(group).getByRole("button", { name: `${W.done} ${W.close}` }));
    expect(counted(view)).toEqual(first);
  });

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

  // The data disagrees with itself: the goal record says done while its own to-do count is open, or planned while every
  // card under its title is finished. The row keeps the record's words and says in one line what disagrees.
  test(`a goal whose record state and progress disagree says why in one line in the 대화 goal view (${width})`, async () => {
    const source = hub();
    const agent = source.scene.items.agents[0].id;
    const view = await open(`#/talk/${agent}`, source, wide);
    const card = await waitFor(() => view.getByTestId("agent-card"));
    const toggle = card.querySelector(".agent-card-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
    const rows = [...view.getByTestId("agent-card").querySelectorAll(".goal-row")].map((row) => ({
      title: row.querySelector(".title")?.textContent ?? "",
      state: row.querySelector("[data-testid=goal-state] .state")?.getAttribute("data-state") ?? null,
      progress: row.querySelector("[data-testid=goal-progress]")?.textContent ?? null,
      why: row.querySelector("[data-testid=goal-why]")?.textContent ?? null,
    }));
    const row = (title: string) => rows.find((each) => each.title === title);
    expect(row(ROUND23.closedEarly)).toEqual({ title: ROUND23.closedEarly, state: "done", progress: "0/1", why: W.todosLeft(1) });
    expect(row(ROUND23.closedAtFour)).toEqual({ title: ROUND23.closedAtFour, state: "done", progress: "4/16", why: W.todosLeft(12) });
    expect(row(ROUND23.plannedDone)).toEqual({ title: ROUND23.plannedDone, state: "planned", progress: "0/1", why: W.workDone(ROUND23.plannedDoneOwn.length) });
    view.unmount();
    // 목표 opened first reads the same: its rows fold the goal's cards, every finished one read.
    const list = await open("#/goals", hub(), wide);
    await waitFor(() => expect(within(list.getByRole("list", { name: W.goals })).getAllByTestId("goal-why").map((why) => why.textContent)).toEqual(expect.arrayContaining([W.todosLeft(1), W.todosLeft(12), W.workDone(ROUND23.plannedDoneOwn.length)])));
    // No other goal shows a state its own progress contradicts without that line.
    for (const each of rows) {
      const [done, total] = (each.progress ?? "0/0").split("/").map(Number);
      if (each.state === "done" && done < total) expect(each.why, each.title).toBe(W.todosLeft(total - done));
      if (each.why === null) expect(each.state === "done" && done < total).toBe(false);
    }
  });
}
