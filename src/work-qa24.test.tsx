import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND23, ROUND24, SyntheticSource } from "./data/synthetic-source";
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

/** A group's rows as a person reads them: the first line, and the second line under it (null when none). */
function lines(group: HTMLElement) {
  return [...group.querySelectorAll("[data-testid=row]")].map((row) => ({ first: row.querySelector(".title")?.textContent ?? "", second: row.querySelector("[data-testid=row-sub]")?.textContent ?? null }));
}

const repeated = (firsts: readonly string[]) => firsts.filter((first, index) => firsts.indexOf(first) !== index);

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

  test(`rows of one goal are told apart by their first line in 중단됨 and 예정 (${width})`, async () => {
    const view = await open("#/", hub(), wide);
    const stopped = view.getByTestId("section-stopped");
    const more = stopped.querySelector(".more-row:not([data-testid=fold-hide]) button");
    if (more) fireEvent.click(more);
    const stoppedLines = lines(stopped);
    expect(repeated(stoppedLines.map((line) => line.first))).toEqual([]);
    for (const own of ROUND24.stopOwn) expect(stoppedLines.find((line) => line.first === own)?.second).toBe(ROUND24.stopGoal);
    const plannedLines = lines(view.getByTestId("section-planned"));
    expect(repeated(plannedLines.map((line) => line.first))).toEqual([]);
    expect(plannedLines.find((line) => line.first === ROUND24.planOwn)?.second).toBe(ROUND24.planGoal);
    expect(plannedLines.find((line) => line.first === ROUND24.planGoal)?.second).toBeNull();
  });

  test(`a goal's work list counts the finished cards nothing names in one line, never names a row by the kind word (${width})`, async () => {
    const source = hub();
    const view = await open("#/goals/G10", source, wide);
    const list = await waitFor(() => view.getByRole("list", { name: W.cards }));
    const rows = lines(list);
    expect(rows.map((row) => row.first).filter((first) => first === W.cards)).toEqual([]);
    expect(rows.map((row) => row.first).sort()).toEqual([W.untitledCount(ROUND24.workUnnamed.length), ...ROUND24.workNamed].sort());
    const grey = [...list.querySelectorAll("[data-testid=row]")].find((row) => row.querySelector(".title")?.textContent === W.untitledCount(ROUND24.workUnnamed.length)) as HTMLElement;
    expect(grey.querySelector(".title")?.classList.contains("is-kind")).toBe(true);
    expect(grey.textContent).toContain(W.agentsCount(3));
  });

  test(`a goal's head says in one line why its record's state and its progress disagree (${width})`, async () => {
    for (const [id, why] of [
      ["G7", W.todosLeft(1)],
      ["G8", W.todosLeft(12)],
      ["G9", W.workDone(ROUND23.plannedDoneOwn.length)],
    ] as const) {
      const view = await open(`#/goals/${id}`, hub(), wide);
      const head = await waitFor(() => view.getByTestId("screen-goal").querySelector(".detail-head") as HTMLElement);
      await waitFor(() => expect(within(head).getByTestId("goal-why").textContent).toBe(why));
      view.unmount();
    }
    // A goal whose record agrees with itself says nothing more.
    const view = await open("#/goals/G10", hub(), wide);
    const head = await waitFor(() => view.getByTestId("screen-goal").querySelector(".detail-head") as HTMLElement);
    expect(within(head).queryByTestId("goal-why")).toBeNull();
  });
}
