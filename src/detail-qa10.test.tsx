import { render, waitFor, within } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { stateLabel, waitWord } from "./words";

// lina-app#174: UI QA round 10 on scenes shaped like the hub's response: to-dos `waiting` with `feedback`,
// `blocked_by_item`, `decision` and `hold`; a read-only stopped card whose worker run record repeats its comments (one a
// machine notice by its author) and holds one the card does not; the read-only line's link to the agent's 대화.

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, source: SyntheticSource, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = () => Math.floor(Date.now() / 1000);
const twice = /대기.*대기/;

test("a record waiting on feedback, another to-do, a decision or a hold reads one wait word, never 대기 twice", () => {
  expect(stateLabel("waiting", "feedback")).toBe("피드백 대기");
  expect(stateLabel("waiting", "decision")).toBe("결정 대기");
  expect(stateLabel("waiting", "blocked_by_item")).toBe("다른 일 대기");
  expect(stateLabel("waiting", "hold")).toBe("대기 · 보류");
  expect(stateLabel("stopped", "feedback")).toBe("중단됨 · 피드백 대기");
  for (const reason of ["feedback", "decision", "blocked_by_item", "hold", "review", null])
    for (const state of ["planned", "in_progress", "waiting", "stopped", "done"] as const) expect(stateLabel(state, reason), `${state} ${reason}`).not.toMatch(twice);
});

test("a to-do waiting on feedback reads the work tab's word for the same wait, in its head and in its goal's 할 일", async () => {
  const source = new SyntheticSource({ now: now(), hubRound9: true });
  // The work tab's stopped row for a feedback wait (k-134) is the card's word for it.
  const cards = await open("#/cards/k-134", source);
  await frame(cards);
  const link = cards.container.querySelector('.list-pane a[href="#/cards/k-134"]')?.parentElement as HTMLElement;
  const cardWord = (within(link).getByTestId("state").textContent ?? "").split(" · ")[1];
  expect(cardWord).toBe(waitWord("feedback"));
  cards.unmount();
  const view = await open("#/items/T12", source);
  const head = (await frame(view)).querySelector(".detail-head .sub")?.textContent ?? "";
  expect(head).toMatch(new RegExp(`^${cardWord} · \\d+일 전$`));
  expect(head).toMatch(/^피드백 대기 · /);
  view.unmount();
  const goal = await open("#/goals/G5", source);
  const states = [...(await frame(goal)).querySelectorAll("[data-testid=state]")].map((state) => state.textContent ?? "");
  expect(states).toContain("피드백 대기");
  for (const state of states) expect(state).not.toMatch(twice);
});

test("a goal's 할 일 box reads 다른 일 대기 and 결정 대기, as a stopped row reads them, never 대기 · 진행 대기", async () => {
  const view = await open("#/goals/G3", new SyntheticSource({ now: now() }));
  const states = [...(await frame(view)).querySelectorAll("[data-testid=state]")].map((state) => state.textContent ?? "");
  expect(states).toEqual(expect.arrayContaining(["결정 대기", "다른 일 대기"]));
  for (const state of states) expect(state).not.toMatch(twice);
});

/** The hub-shaped stopped card k-134 with comments, and its worker run's record holding them and one more. */
function cardWithRecord() {
  const { scene } = new SyntheticSource({ now: now(), hubRound9: true });
  const at = (days: number) => scene.now - days * 86_400;
  const comments = [
    { id: 61, author: scene.items.agents[1].id, body: "새 판은 빌드 기기 둘 다에 고정해 둠.", createdAt: at(3) },
    { id: 62, author: "lina-worker", body: "작업 시작 알림", createdAt: at(4) },
  ];
  const workerRuns = [{ id: "r-134", kind: "lina-worker" as const, firstSeenAt: at(4), lastSeenAt: at(3) }];
  const cardDetails = { ...scene.cardDetails, "k-134": { ...scene.cardDetails["k-134"], comments, workerRuns } };
  const row = (days: number, text: string) => ({ at: at(days), kind: "comment" as const, text, count: 1 });
  const record = { ...scene.records.r9, id: "r-134", cardId: "k-134", rounds: [], comments: [row(4, "작업 시작 알림"), row(3, "새 판은 빌드 기기 둘 다에 고정해 둠."), row(2, "다음 판은 금요일에 올림.")] };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails, records: { ...scene.records, "r-134": record } } });
}

for (const wide of [true, false]) {
  test(`a stopped card whose record holds comments has one 댓글 section (${wide ? "1280" : "390"})`, async () => {
    const view = await open("#/cards/k-134", cardWithRecord(), wide);
    const card = await frame(view);
    await waitFor(() => expect(within(card).getByTestId("card-comments").textContent).toContain("다음 판은 금요일에 올림"));
    const heads = [...card.querySelectorAll("h2, h3, summary")].filter((head) => head.textContent === "댓글");
    expect(heads).toHaveLength(1);
    const box = within(card).getByTestId("card-comments").textContent ?? "";
    expect(box).toContain("새 판은 빌드 기기 둘 다에 고정해 둠");
    // The worker's notice is no line in the box, nor anywhere else on the card.
    expect(card.textContent).not.toContain("작업 시작 알림");
  });
}

test("the answer-where link is drawn in the app's link colour, not its line's grey", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app.css", "utf8");
  document.head.append(style);
  try {
    const view = await open("#/cards/k-135", new SyntheticSource({ now: now(), hubRound9: true }));
    const where = within(await frame(view)).getByTestId("answer-where");
    const link = within(where).getByRole("link");
    expect(getComputedStyle(link).color).toBe("var(--accent)");
    expect(getComputedStyle(link).color).not.toBe(getComputedStyle(where).color);
  } finally {
    style.remove();
  }
});
