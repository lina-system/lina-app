import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkCardSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED } from "./fixtures/synthetic";
import { STATE_WORD } from "./words";

// lina-app#156: UI QA round 6 on the hub's real responses (11-15). Titles and asks are invented; the fields (`title`,
// `goalTitle`, `reason`, `waitingOn`, `retry`, `ask`, `plain.title` always null) and their shapes are the hub's own.

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

/** The synthetic scene with the hub's real card shapes added: cards of one goal, and stopped cards waiting on the owner. */
function realShapeScene(options: { noRunning?: boolean } = {}) {
  const scene = generateScene(SYNTHETIC_SEED, { now: now(), noRunning: options.noRunning });
  const base = scene.cards.cards.find((card) => card.state === "done") as WorkCardSummary;
  const agent = scene.items.agents[1].id;
  const card = (id: string, fields: Record<string, unknown>) => ({ ...base, id, agent, plain: NO_LINES, reason: null, waitingOn: null, retry: null, ask: null, readOnly: true, ...fields });
  const done = (id: string, title: string, ago: number) => card(id, { title, goalTitle: "가상 교체 시험", state: "done", endedAt: scene.now - ago });
  const stopped = (id: string, fields: Record<string, unknown>) => card(id, { state: "stopped", waitingOn: "owner", retry: "none", endedAt: null, lastHeartbeatAt: scene.now - 3600, ...fields });
  const cards = [
    done("k-swap-1", "가짜 교체 1단계 정리 (lina#1)", 7200),
    done("k-swap-2", "가짜 OCX 교체 2단계", 7300),
    done("k-swap-3", "fake swap verdict fixes (t_ab12cd34)", 7400),
    done("k-swap-4", "가짜 교체 판을 a6687ba로 올리기", 7500),
    done("k-swap-5", "가짜 교체에서 fake worker run 받기", 7600),
    stopped("k-stop-1", { title: "fake gate cleanup", goalTitle: null, reason: "decision", ask: "가짜 승인 순서 결정" }),
    stopped("k-stop-2", { title: "가짜 결제 화면 정리", goalTitle: "가상 결제 목표", reason: "decision", ask: "가짜 문구 둘 중 하나 고르기" }),
    stopped("k-stop-3", { title: "가짜 피드백 정리", goalTitle: "가상 결제 목표", reason: "feedback", ask: null }),
  ];
  return { ...scene, cards: { ...scene.cards, cards: [...scene.cards.cards, ...cards] as typeof scene.cards.cards } };
}

const rowOf = (root: HTMLElement, id: string) => root.querySelector(`a[href$="/cards/${id}"]`)?.closest("[data-testid=row]") as HTMLElement | null;

describe("work rows keep the readable part of a title (lina-app#156 items 1, 2)", () => {
  test("rows of one goal read apart by the card's own cleaned title; a title with a Latin word is hidden (lina-app#222)", async () => {
    const view = await open("#/done", new SyntheticSource({ scene: realShapeScene() }));
    const screen = view.getByTestId("screen-done");
    const sub = (id: string) => rowOf(screen, id)?.querySelector("[data-testid=row-sub]")?.textContent ?? null;
    expect(rowOf(screen, "k-swap-1")?.querySelector(".title")?.textContent).toBe("가상 교체 시험");
    expect(sub("k-swap-1")).toBe("가짜 교체 1단계 정리");
    // An abbreviation is a Latin word too (lina-app#222).
    expect(sub("k-swap-2")).toBeNull();
    // The ref and the particle glued to it go together; the sentence still reads.
    expect(sub("k-swap-4")).toBe("가짜 교체 판을 올리기");
    // No Hangul, or Latin words: hidden, the goal's title alone.
    expect(sub("k-swap-3")).toBeNull();
    expect(sub("k-swap-5")).toBeNull();
    // The group head still counts its rows.
    for (const section of screen.querySelectorAll("[data-testid^=section-]")) {
      const count = Number(section.querySelector("[data-testid=count]")?.textContent ?? "0");
      expect(section.querySelectorAll("[data-testid=row]").length).toBe(count);
    }
  });

  test("a goal-less stopped card whose title is hidden is named by its ask, never by whose stopped card it is", async () => {
    const view = await open("#/", new SyntheticSource({ scene: realShapeScene() }));
    const list = view.getByRole("list", { name: STATE_WORD.stopped });
    const row = rowOf(list, "k-stop-1");
    expect(row?.querySelector(".title")?.textContent).toBe("가짜 승인 순서 결정");
    expect(list.textContent).not.toContain("중단 카드");
    // The ask names the row: it is not said a second time in the state line.
    expect(row?.querySelector("[data-testid=state]")?.textContent).toBe(`${STATE_WORD.stopped} · 결정 대기`);
  });
});

describe("a stopped row says why it stopped (lina-app#156 item 3)", () => {
  test("decision reads 결정 대기 then the ask, feedback reads 피드백 대기; no person's name", async () => {
    const view = await open("#/", new SyntheticSource({ scene: realShapeScene() }), false);
    const list = view.getByRole("list", { name: STATE_WORD.stopped });
    const state = (id: string) => rowOf(list, id)?.querySelector("[data-testid=state]")?.textContent;
    expect(state("k-stop-2")).toBe(`${STATE_WORD.stopped} · 결정 대기 · 가짜 문구 둘 중 하나 고르기`);
    expect(state("k-stop-3")).toBe(`${STATE_WORD.stopped} · 피드백 대기 · 이유 기록 없음`);
    for (const each of list.querySelectorAll("[data-testid=state]")) expect(each.textContent).not.toContain(`${SYNTHETIC_OWNER.name} `);
    expect(list.textContent).not.toMatch(/준 기다림|확인 필요/);
    // The ask is said once, in the state line.
    expect(rowOf(list, "k-stop-2")?.textContent?.split("가짜 문구 둘 중 하나 고르기").length).toBe(2);
    // The head's red number is still every stopped row (folded ones included).
    const section = view.getByTestId("section-stopped");
    expect(Number(within(section).getByTestId("stopped-count").textContent)).toBeGreaterThanOrEqual(list.querySelectorAll("[data-testid=row]").length);
  });
});

describe("the side menu's 진행 중인 작업 badge (lina-app#156 item 5)", () => {
  test("with nothing running the item shows no number of its own, and the stopped cards read 중단됨 n", async () => {
    const view = await open("#/", new SyntheticSource({ scene: realShapeScene({ noRunning: true }) }));
    const nav = view.getByTestId("nav-running");
    const stoppedRows = view.getByTestId("section-stopped").querySelector("[data-testid=stopped-count]")?.textContent;
    expect(nav.querySelector("[data-testid=nav-count]")).toBeNull();
    expect(nav.querySelector("[data-testid=nav-stopped-mark]")?.textContent).toBe(`${STATE_WORD.stopped} ${stoppedRows}`);
  });

  test("with work running the item's number is the running cards only", async () => {
    const view = await open("#/", new SyntheticSource({ scene: realShapeScene() }));
    const nav = view.getByTestId("nav-running");
    const running = view.getByTestId("section-active").querySelectorAll("[data-testid=row]").length;
    expect(Number(nav.querySelector("[data-testid=nav-count]")?.textContent)).toBe(running);
    expect(nav.querySelector("[data-testid=nav-stopped-mark]")?.textContent).toMatch(new RegExp(`^${STATE_WORD.stopped} \\d+$`));
  });
});

describe("the goal pane folds like the rows (lina-app#156 item 7)", () => {
  test("a goal's title and done condition lose their refs, hashes and the particles glued to them", async () => {
    const scene = generateScene(SYNTHETIC_SEED, { now: now() });
    const goal = scene.items.items.find((item) => item.kind === "goal");
    const items = { ...scene.items, items: scene.items.items.map((item) => (item === goal ? { ...item, title: "가짜 목표 정리 (lina#49)", doneCondition: "lina#49 뒤 가짜 조건을 a1b2c3d로 맞춤" } : item)) };
    const view = await open("#/goals", new SyntheticSource({ scene: { ...scene, items } }));
    const row = view.getByTestId("screen-goals").querySelector(`a[href$="/goals/${goal?.id}"]`) as HTMLElement;
    expect(row.querySelector(".title")?.textContent).toBe("가짜 목표 정리");
    expect(row.querySelector(".sub")?.textContent).toBe("뒤 가짜 조건을 맞춤");
    expect(row.textContent).not.toMatch(/#\d+|a1b2c3d/);
  });
});

describe("a goal with no to-dos shows no progress (lina-app#160 item 6)", () => {
  test("0/0 is neither said nor drawn as an empty dial; a goal with to-dos keeps both", async () => {
    const scene = generateScene(SYNTHETIC_SEED, { now: now() });
    const [empty, counted] = scene.items.items.filter((item) => item.kind === "goal" && item.state !== "done");
    const items = { ...scene.items, items: scene.items.items.map((item) => (item === empty ? { ...item, todos: { done: 0, total: 0 } } : item === counted ? { ...item, todos: { done: 1, total: 2 } } : item)) };
    const view = await open("#/goals", new SyntheticSource({ scene: { ...scene, items } }));
    const row = (id: string) => view.getByTestId("screen-goals").querySelector(`a[href$="/goals/${id}"]`) as HTMLElement;
    expect(row(empty.id).querySelector(".dial")).toBeNull();
    expect(row(empty.id).getAttribute("aria-label")).not.toMatch(/\d+\/\d+/);
    expect(row(empty.id).textContent).not.toContain("0/0");
    expect(row(counted.id).querySelector(".dial")).not.toBeNull();
    expect(row(counted.id).getAttribute("aria-label")).toContain("1/2");
  });
});
