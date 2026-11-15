import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ItemDetail, ItemSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED } from "./fixtures/synthetic";

// lina-app#175: UI QA round 10 on the hub's real responses (11-15). Titles are invented; the shapes are the hub's own:
// the owner's to-dos come in creation order and are many (54 on the hub), and a goal's `todos` counts every to-do of
// it while the item list holds only the open ones and those closed in the last three days.

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, source: SyntheticSource, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

const now = () => Math.floor(Date.now() / 1000);
const WORDS = ["영수증 모으기", "회의록 정리", "사진 백업", "책상 정리"];
const GOAL = "가상 배송 화면 만들기";
const EMPTY_GOAL = "가상 운영 메모 옮기기";

/**
 * The synthetic scene in round 10's shapes: 12 more owner to-dos after the scene's own, in the order they were made;
 * G60, another agent's goal holding 22 to-dos (20 done), of which the item list serves only the first agent's two open
 * ones; G61, the first agent's goal with no to-dos.
 */
function round10Scene() {
  const scene = generateScene(SYNTHETIC_SEED, { now: now() });
  const [first, second] = scene.items.agents;
  const mine = Array.from({ length: 12 }, (_, index) => ({ id: `T${300 + index}`, title: `${WORDS[index % WORDS.length]} ${index + 1}`, waiting: false, due: null, agent: SYNTHETIC_OWNER.id }));
  const base = scene.items.items.find((item) => item.kind === "goal") as ItemSummary;
  const goal: ItemSummary = { ...base, id: "G60", title: GOAL, agent: second.id, state: "in_progress", reason: null, due: null, doneCondition: null, todos: { done: 20, total: 22 } };
  const empty: ItemSummary = { ...base, id: "G61", title: EMPTY_GOAL, agent: first.id, state: "in_progress", reason: null, due: null, doneCondition: null, todos: { done: 0, total: 0 } };
  const todo = (index: number, done: boolean, agent: string): ItemSummary => ({ ...goal, id: `T${400 + index}`, kind: "todo", parent: "G60", title: `가상 배송 단계 ${index + 1}`, agent, state: done ? "done" : "planned", todos: null });
  const children = Array.from({ length: 22 }, (_, index) => (index < 20 ? todo(index, true, second.id) : todo(index, false, first.id)));
  const detail = (item: ItemSummary, kids: ItemSummary[]): ItemDetail => ({ ...item, why: null, basis: [], children: kids, comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null });
  return {
    ...scene,
    items: { ...scene.items, items: [...scene.items.items, goal, empty, ...children.slice(20)] },
    itemDetails: { ...scene.itemDetails, G60: detail(goal, children), G61: detail(empty, []) },
    board: { ...scene.board, inbox: { ...scene.board.inbox, mine: [...scene.board.inbox.mine, ...mine] } },
  };
}

const count = (element: Element | null) => Number(element?.textContent?.match(/\d+/)?.[0] ?? Number.NaN);

describe.each([
  ["1280", true],
  ["390", false],
])("at %s", (_width, wide) => {
  test("a to-do just added is on the home above the fold, keeps its box, and undo of its done mark finds it (item 1)", async () => {
    Element.prototype.scrollIntoView = () => {}; // jsdom has none; the field scrolls itself into view on focus
    const source = new SyntheticSource({ scene: round10Scene() });
    const view = await open("#/", source, wide);
    const mine = view.getByTestId("home-mine");
    const before = count(within(mine).getByTestId("head-mine").querySelector("[data-testid=count]"));
    expect(before).toBeGreaterThanOrEqual(14);
    fireEvent.click(within(mine).getByRole("button", { name: "할 일 추가" }));
    const field = within(mine).getByRole("textbox", { name: "할 일" }) as HTMLInputElement;
    field.value = "가상 새 일 하나";
    fireEvent.input(field);
    fireEvent.click(within(mine).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(view.getByTestId("toast").textContent).toBe("할 일 추가함"));
    // The core lists it last; it is drawn, not folded under `외 n개`.
    expect(source.scene.board.inbox.mine.at(-1)?.title).toBe("가상 새 일 하나");
    const list = view.getByRole("list", { name: "내 할 일" });
    const box = await waitFor(() => within(list).getByRole("checkbox", { name: "가상 새 일 하나 완료로 표시" }));
    // The head still counts every row: the drawn ones and the fold's.
    const drawn = list.querySelectorAll(":scope > li:not(.more-row)").length;
    const folded = count(list.querySelector(".more-row"));
    expect(count(within(mine).getByTestId("head-mine").querySelector("[data-testid=count]"))).toBe(before + 1);
    expect(drawn + folded).toBe(before + 1);
    fireEvent.click(box);
    await waitFor(() => expect(view.getByTestId("toast").textContent).toBe("완료로 표시함되돌리기"));
    fireEvent.click(within(view.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
    await waitFor(() => expect(within(view.getByRole("list", { name: "내 할 일" })).getByRole("checkbox", { name: "가상 새 일 하나 완료로 표시" })).toBeTruthy());
  });

  test("a goal's number is done/total of the to-dos its page lists, on the 대화 card, its band, the agent and goal lists; no to-dos, no number (item 2)", async () => {
    const source = new SyntheticSource({ scene: round10Scene() });
    const goal = await open("#/goals/G60", source, wide);
    const todos = await waitFor(() => {
      const list = goal.getByTestId("detail-frame").querySelector('ul[aria-label="할 일"]');
      expect(list).not.toBeNull();
      return list as HTMLElement;
    });
    const rows = todos.querySelectorAll("[role=checkbox]");
    const done = [...rows].filter((box) => box.getAttribute("aria-checked") === "true").length;
    expect([done, rows.length]).toEqual([20, 22]);
    const progress = `${done}/${rows.length}`;
    // The 목표 list beside it reads the same number.
    if (wide) expect(goal.container.querySelector('.list-pane a[href="#/goals/G60"]')?.getAttribute("aria-label")).toMatch(new RegExp(` · ${progress}$`));
    goal.unmount();

    const talk = await open("#/talk/ag-1", new SyntheticSource({ scene: round10Scene() }), wide);
    const card = talk.getByTestId("agent-card");
    if (!wide) {
      const band = card.querySelector(".agent-card-toggle .sub")!.textContent!.split(" · ");
      expect(band).toContain(`${GOAL} ${progress}`);
      expect(band).toContain(EMPTY_GOAL);
      fireEvent.click(card.querySelector(".agent-card-toggle") as HTMLElement);
    }
    expect(card.querySelector('a[href="#/talk/ag-1?goal=G60"]')?.getAttribute("aria-label")).toMatch(new RegExp(` · ${progress}$`));
    expect(card.querySelector('a[href="#/talk/ag-1?goal=G61"]')?.getAttribute("aria-label")).not.toMatch(/\d+\/\d+/);
    talk.unmount();

    const agent = await open("#/agents/ag-1", new SyntheticSource({ scene: round10Scene() }), wide);
    expect(agent.getByTestId("section-goals").querySelector('a[href="#/goals/G60"]')?.getAttribute("aria-label")).toMatch(new RegExp(` · ${progress}$`));
  });

  test("the 대화 goal list draws each goal's number as text, and none for a goal with no to-dos (item 3)", async () => {
    const view = await open("#/talk/ag-1", new SyntheticSource({ scene: round10Scene() }), wide);
    const card = view.getByTestId("agent-card");
    if (!wide) fireEvent.click(card.querySelector(".agent-card-toggle") as HTMLElement);
    const row = (id: string) => card.querySelector(`a[href="#/talk/ag-1?goal=${id}"]`)!.closest("li")!;
    expect(row("G60").querySelector("[data-testid=goal-progress]")?.textContent).toBe("20/22");
    expect(row("G60").textContent).toContain("20/22");
    expect(row("G61").querySelector("[data-testid=goal-progress]")).toBeNull();
  });
});
