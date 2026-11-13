import { render, waitFor, within } from "@testing-library/preact";
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
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
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

  test("rows of one goal read apart: the card's own name is a second line, also in the row's name", async () => {
    const view = await open("#/done", new SyntheticSource({ scene: sameGoalScene() }));
    const rows = within(view.getByTestId("screen-done")).getAllByTestId("row").filter((row) => row.textContent?.includes("가상 반복 목표"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.querySelector("[data-testid=row-sub]")?.textContent).sort()).toEqual(["가짜 둘째 정리", "가짜 첫 정리"]);
    expect(rows.every((row) => row.querySelector("a")?.getAttribute("aria-label")?.includes("가짜"))).toBe(true);
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

  test("a decision whose context is raw text draws no context line", async () => {
    const scene = generateScene(SYNTHETIC_SEED, { now: now() });
    const target = scene.board.inbox.decide[0].target;
    const items = { ...scene.items, items: scene.items.items.map((item) => (item.id === target ? { ...item, title: "fakecorp·가상 회신", parent: null } : item)) };
    const board = { ...scene.board, inbox: { ...scene.board.inbox, decide: scene.board.inbox.decide.map((row) => (row.target === target ? { ...row, title: "fakecorp·가상 회신" } : row)) } };
    const view = await open("#/inbox", new SyntheticSource({ scene: { ...scene, items, board } }));
    const rows = within(view.getByRole("list", { name: W.decide })).getAllByTestId("row");
    expect(rows.some((row) => row.textContent?.includes("fakecorp"))).toBe(false);
    expect(rows.filter((row) => !row.querySelector(".context")).length).toBe(1);
  });
});
