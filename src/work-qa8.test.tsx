import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ItemDetail, WorkCardSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { generateScene, SYNTHETIC_SEED } from "./fixtures/synthetic";
import { STATE_WORD, W } from "./words";

// lina-app#168: UI QA round 8 on the hub's real responses (11-15). Titles are invented; the fields (`goalTitle`,
// `readOnly`, `plain.title` always null, a running card linked to its record goal only through its runs' `todo`) and
// their shapes are the hub's own.

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, source: SyntheticSource, wide = true) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

const now = () => Math.floor(Date.now() / 1000);
const NO_LINES = { title: null, now: null, result: null };
const DAY = 86_400;
const DEPLOY = "가짜 코어와 앱 빌드를 올리기";
const LIVE_GOAL = "가상 앱을 쓸 수 있게";

/**
 * The synthetic scene with the hub's shapes of round 8: five finished cards whose titles differ only by a hash, and a
 * running card whose record goal and to-do still say 예정, linked by its runs' to-do.
 */
function round8Scene() {
  const scene = generateScene(SYNTHETIC_SEED, { now: now() });
  const base = scene.cards.cards.find((card) => card.state === "done") as WorkCardSummary;
  const agent = scene.items.agents[1].id;
  const card = (id: string, fields: Record<string, unknown>) => ({ ...base, id, agent, plain: NO_LINES, reason: null, waitingOn: null, retry: null, ask: null, readOnly: true, goalTitle: null, ...fields });
  const hashes = ["1a2b3c4d", "5e6f7a8b", "9c0d1e2f", "3a4b5c6d", "7e8f9a0b"];
  // The hash in a bracket of its own: a finished title is drawn as written less a ref-only bracket (lina-app#231).
  const deploys = hashes.map((hash, index) => card(`k-deploy-${index + 1}`, { title: `${DEPLOY} (${hash})`, state: "done", endedAt: scene.now - 2 * DAY - index * 600 }));
  const live = card("k-live", { title: "가상 앱 쓸 수 있는 수준으로: 세 탭 점검", goalTitle: LIVE_GOAL, state: "in_progress", endedAt: null, elapsedSeconds: DAY, lastHeartbeatAt: scene.now - 60 });
  const goalRow = { ...scene.items.items.find((item) => item.kind === "goal"), id: "G900", parent: null, title: LIVE_GOAL, agent, state: "planned", reason: null, doneCondition: null, due: null, todos: { done: 0, total: 1 } } as (typeof scene.items.items)[number];
  const todoRow = { ...goalRow, id: "T900", kind: "todo", parent: "G900", title: "가상 세 탭 점검과 수정", todos: null } as (typeof scene.items.items)[number];
  const detail: ItemDetail = { ...goalRow, why: null, basis: [], children: [todoRow], comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null };
  const run = { ...scene.board.cards[0], id: "r-live", card: "k-live", todo: "T900", agent, state: "done" as const };
  return {
    ...scene,
    cards: { ...scene.cards, cards: [...scene.cards.cards, ...deploys, live] as typeof scene.cards.cards },
    items: { ...scene.items, items: [...scene.items.items, goalRow, todoRow] },
    itemDetails: { ...scene.itemDetails, G900: detail },
    board: { ...scene.board, cards: [...scene.board.cards, run] },
  };
}

describe("finished lines collapse (lina-app#168 item 1)", () => {
  test("five cards that differ only by a hash are one 완료 line ×5 opening the newest; the head and the sidebar count the cards", async () => {
    const view = await open("#/running", new SyntheticSource({ scene: round8Scene() }));
    const finished = view.getByTestId("section-finished");
    // The page reads the newest finished cards first (lina-app#186), then the group reads the rest, the oldest deploy too
    // (lina-app#237): its five lines are all of them, with no fold.
    await waitFor(() => expect(finished.querySelector(".more-row")).toBeNull());
    const rows = within(finished).getAllByTestId("row").filter((row) => row.textContent?.includes(DEPLOY));
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".title")?.textContent).toBe(`${DEPLOY} ${W.repeated(5)}`);
    expect(rows[0].querySelector("a")?.getAttribute("href")).toMatch(/\/cards\/k-deploy-1$/);
    // The head and the sidebar's 완료 count the cards (lina-app#225): a ×5 line is one row and counts its five.
    const cards = within(finished).getAllByTestId("row").reduce((sum, row) => sum + Number(/(?:×|제목 없는 )(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0);
    expect(cards).toBe(within(finished).getAllByTestId("row").length + 4);
    expect(Number(finished.querySelector("[data-testid=count]")?.textContent)).toBe(cards);
    expect(Number(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")?.textContent)).toBe(cards);
  });
});

describe("one goal, one state in both tabs (lina-app#168 item 2)", () => {
  test("a goal with one running card reads 진행 중 on the work tab and in the conversation tab's goal view", async () => {
    const work = await open("#/running", new SyntheticSource({ scene: round8Scene() }));
    const row = within(work.getByTestId("section-active"))
      .getAllByTestId("row")
      .find((each) => each.querySelector(".title")?.textContent === LIVE_GOAL);
    expect(row?.querySelector("[data-testid=state]")?.textContent).toBe(STATE_WORD.in_progress);
    work.unmount();

    const agent = round8Scene().items.agents[1].id;
    for (const wide of [true, false]) {
      const talk = await open(`#/talk/${agent}?goal=G900`, new SyntheticSource({ scene: round8Scene() }), wide);
      const goal = await waitFor(() => talk.getByTestId("screen-goal"));
      expect(goal.querySelector(".head-check [data-testid=state]")?.textContent).toBe(STATE_WORD.in_progress);
      talk.unmount();
    }
  });
});
