import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// The work tab's row titles as the hub serves them (no checked titles): a finished card with a tool name in its title
// is drawn by it, a goal's title over a stopped card and its finished ones is one line 1 on the tab, and a card's
// detail head reads what its row reads. Every title is made up.

const GOAL = "가상 관문 옮기기";
const STOPPED = "가짜 키 다시 받기";
const TOOL = "가짜 Figma 시안 옮기기";

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function source(): SyntheticSource {
  const now = Math.floor(Date.now() / 1000);
  const { scene } = new SyntheticSource({ now });
  const done = scene.cards.cards.find((card) => card.state === "done");
  const stopped = scene.cards.cards.find((card) => card.state === "stopped");
  if (!done || !stopped) throw new Error("the synthetic scene has no finished or stopped card");
  const plain = { title: null, now: null, result: null };
  const added = [
    { ...stopped, id: "k-9001", title: STOPPED, goalTitle: GOAL, plain, lastHeartbeatAt: now - 60 },
    { ...done, id: "k-9002", title: "가짜 관문 문서 정리", goalTitle: GOAL, plain, endedAt: now - 120 },
    { ...done, id: "k-9003", title: TOOL, goalTitle: null, plain, endedAt: now - 180 },
  ];
  const details = Object.fromEntries(added.map((card) => [card.id, { ...scene.cardDetails[card.state === "done" ? done.id : stopped.id], id: card.id, title: card.title, state: card.state, plain, workerRuns: [] }]));
  return new SyntheticSource({ now, scene: { ...scene, cards: { cards: [...scene.cards.cards, ...added] }, cardDetails: { ...scene.cardDetails, ...details } } });
}

async function open(hash: string) {
  setWide(true);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source())} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

const GROUPS = ["active", "stopped", "planned", "waiting", "finished"];
const firstLine = (row: Element) => row.querySelector(".title")?.textContent ?? "";

/** Every group's rows, every fold opened. */
function groups(view: ReturnType<typeof render>): Map<string, Element[]> {
  for (const id of GROUPS) {
    const more = view.queryByTestId(`section-${id}`)?.querySelector(".more-row:not([data-testid=fold-hide]) button");
    if (more) fireEvent.click(more);
  }
  return new Map(GROUPS.map((id) => [id, [...(view.queryByTestId(`section-${id}`)?.querySelectorAll("[data-testid=row]") ?? [])]]));
}

test("a title is one group's line 1 on the work tab; the stopped card under it leads with its own name, and the 완료 head, its lines and the sidebar agree", async () => {
  const view = await open("#/");
  const rows = groups(view);
  const where = new Map<string, Set<string>>();
  for (const [id, each] of rows) for (const row of each) where.set(firstLine(row), (where.get(firstLine(row)) ?? new Set()).add(id));
  expect([...where].filter(([, ids]) => ids.size > 1).map(([title, ids]) => [title, [...ids]])).toEqual([]);
  const stopped = (rows.get("stopped") ?? []).find((row) => row.querySelector('a[href="#/cards/k-9001"]'));
  expect(stopped && firstLine(stopped)).toBe(STOPPED);
  expect(stopped?.querySelector("[data-testid=row-sub]")?.textContent).toBe(GOAL);
  const finished = rows.get("finished") ?? [];
  expect(finished.filter((row) => firstLine(row) === GOAL)).toHaveLength(1);
  expect(finished.filter((row) => firstLine(row) === TOOL)).toHaveLength(1);
  const cards = finished.reduce((sum, row) => sum + Number(/(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0);
  const head = Number(view.getByTestId("head-finished").querySelector("[data-testid=count]")?.textContent);
  const sidebar = Number(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")?.textContent);
  expect([head, sidebar]).toEqual([cards, cards]);
});

test("a card's detail head reads its row's line 1: a finished card's tool name, a stopped card's own name over its goal", async () => {
  for (const [id, title] of [
    ["k-9003", TOOL],
    ["k-9001", STOPPED],
  ] as const) {
    const view = await open(`#/cards/${id}`);
    const detail = await waitFor(() => view.getByTestId("screen-card"));
    await waitFor(() => expect(detail.querySelector("h1")?.textContent).toBe(title));
    const row = view.container.querySelector(`.list-pane a[href="#/cards/${id}"]`)?.closest("[data-testid=row]");
    expect(row && firstLine(row)).toBe(title);
    if (id === "k-9001") expect(within(detail).getByTestId("card-goal").textContent).toContain(GOAL);
    view.unmount();
  }
});
