import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkCardSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { generateScene, SYNTHETIC_SEED } from "./fixtures/synthetic";
import { STATE_WORD, W } from "./words";

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, source: SyntheticSource, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

const now = () => Math.floor(Date.now() / 1000);

/** The synthetic scene with finished cards of one goal, as the hub serves many (lina-app#148). */
function sameGoalScene() {
  const scene = generateScene(SYNTHETIC_SEED, { now: now() });
  const base = scene.cards.cards.find((card) => card.state === "done") as WorkCardSummary;
  const twin = (id: string, title: string, ago: number) => ({ ...base, id, title, goalTitle: "가상 반복 목표", endedAt: scene.now - ago, plain: { title: null, now: null, result: null } });
  return { ...scene, cards: { ...scene.cards, cards: [...scene.cards.cards, twin("k-twin-1", "가짜 첫 정리 (lina#1)", 7200), twin("k-twin-2", "가짜 둘째 정리", 9000)] } };
}

describe("work tab rows (lina-app#148)", () => {
  beforeEach(() => setWide(true));

  // lina-app#237: in 완료 a title is one line, its own names read apart in the detail it opens.
  test("finished cards of one goal are one line of its title, counting them, with no one card's own name under it", async () => {
    const view = await open("#/done", new SyntheticSource({ scene: sameGoalScene() }));
    const rows = within(view.getByTestId("screen-done")).getAllByTestId("row").filter((row) => row.textContent?.includes("가상 반복 목표"));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".title")?.textContent).toBe(`가상 반복 목표 ${W.repeated(2)}`);
    expect(rows[0].querySelector("[data-testid=row-sub]")).toBeNull();
  });

  test("planned cards are a 예정 group under 진행 중, its head counting its rows; the header is 작업", async () => {
    const view = await open("#/running", new SyntheticSource());
    expect(view.getByTestId("screen-title").textContent).toBe(W.tabWork);
    const planned = view.getByTestId("section-planned");
    expect(view.getByTestId("head-planned").querySelector("span")?.textContent).toBe(STATE_WORD.planned);
    expect(Number(view.getByTestId("head-planned").querySelector("[data-testid=count]")?.textContent)).toBe(planned.querySelectorAll("[data-testid=row]").length);
    expect(planned.querySelectorAll("[data-testid=row]").length).toBeGreaterThan(0);
    expect(view.getByTestId("section-active").compareDocumentPosition(planned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("with nothing running and something stopped or planned, 진행 중 0 stands as one line", async () => {
    const view = await open("#/running", new SyntheticSource({ noRunning: true }));
    const head = view.getByTestId("head-active");
    expect(head.querySelector("span")?.textContent).toBe(W.agentRunning);
    expect(head.querySelector("[data-testid=count]")?.textContent).toBe("0");
    expect(view.getByTestId("section-active").querySelectorAll("[data-testid=row]")).toHaveLength(0);
  });

  // lina-app#170 item 3: a name with a Latin word in it reads as on its 내 할 일 row, by the row title rule.
  test("a decision whose to-do's name holds a Latin word draws that name by its Hangul words as its context line (lina-app#222)", async () => {
    const scene = generateScene(SYNTHETIC_SEED, { now: now() });
    const target = scene.board.inbox.decide[0].target;
    const items = { ...scene.items, items: scene.items.items.map((item) => (item.id === target ? { ...item, title: "fakecorp·가상 회신", parent: null } : item)) };
    const board = { ...scene.board, inbox: { ...scene.board.inbox, decide: scene.board.inbox.decide.map((row) => (row.target === target ? { ...row, title: "fakecorp·가상 회신" } : row)) } };
    const view = await open("#/inbox", new SyntheticSource({ scene: { ...scene, items, board } }));
    const rows = within(view.getByRole("list", { name: W.decide })).getAllByTestId("row");
    expect(rows.filter((row) => row.querySelector(".context")?.textContent === "가상 회신")).toHaveLength(1);
    expect(rows.filter((row) => /fakecorp/.test(row.textContent ?? ""))).toHaveLength(0);
    expect(rows.filter((row) => !row.querySelector(".context"))).toHaveLength(0);
  });
});

// lina-app#152: the first screen shows what runs and what the owner must do before the stopped work, which is capped.
describe("work tab first screen (lina-app#152)", () => {
  beforeEach(() => setWide(false));

  const ORDER = ["home-decisions", "section-review", "section-active", "home-mine", "section-stopped", "section-planned", "section-waiting", "section-finished"];
  const order = (screen: HTMLElement) => [...screen.querySelectorAll("[data-testid=home-decisions], [data-testid^=section-], [data-testid=home-mine]")].map((each) => each.getAttribute("data-testid") ?? "");
  const rowsOf = (view: Awaited<ReturnType<typeof open>>, name: string) => within(view.getByRole("list", { name })).queryAllByTestId("row");

  test("decisions, running, my to-dos, then stopped, planned and the finished groups; each head counts every row behind it", async () => {
    const view = await open("#/", new SyntheticSource({ endedRuns: true, manyTodos: true }), false);
    const screen = view.getByTestId("screen-running");
    const seen = order(screen);
    expect(seen).toEqual(ORDER.filter((id) => seen.includes(id)));
    for (const id of ["home-decisions", "section-active", "home-mine", "section-stopped", "section-planned"]) expect(seen, id).toContain(id);

    // My to-dos: the head with every to-do counted, three rows open, one fold for the rest.
    const mine = view.getByTestId("home-mine");
    expect(within(mine).getByTestId("head-mine").textContent).toBe(`${W.mine}52`);
    expect(rowsOf(view, W.mine)).toHaveLength(3);
    fireEvent.click(within(mine).getByRole("button", { name: `${W.mine} ${W.more(49)}` }));
    expect(rowsOf(view, W.mine)).toHaveLength(52);

    // Stopped: five rows, one fold for the rest, the red count still every stopped card.
    const stopped = view.getByTestId("section-stopped");
    expect(within(stopped).getByTestId("stopped-count").textContent).toBe("7");
    expect(rowsOf(view, STATE_WORD.stopped)).toHaveLength(5);
    fireEvent.click(within(stopped).getByRole("button", { name: `${STATE_WORD.stopped} ${W.more(2)}` }));
    expect(rowsOf(view, STATE_WORD.stopped)).toHaveLength(7);
  });

  test("with three to-dos or fewer and five stopped cards or fewer, every row shows and no fold is drawn", async () => {
    const view = await open("#/", new SyntheticSource(), false);
    expect(within(view.getByTestId("head-mine")).getByTestId("count").textContent).toBe(String(rowsOf(view, W.mine).length));
    expect(rowsOf(view, W.mine).length).toBeGreaterThan(0);
    expect(view.queryByRole("button", { name: new RegExp(W.more(1).replace("1", "\\d+")) })).toBeNull();
  });
});
