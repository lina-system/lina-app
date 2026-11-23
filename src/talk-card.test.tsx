import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import type { ItemSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { generateScene } from "./fixtures/synthetic";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

test("the full app opens the conversation list on a hashless visit", async () => {
  window.history.replaceState(null, "", "/app/");
  const view = render(<App store={new Store(new SyntheticSource())} />);
  expect(await view.findByRole("link", { name: "대화", current: "page" })).toBeTruthy();
  expect(await view.findByRole("list", { name: "에이전트" })).toBeTruthy();
});

test.each([true, false])("delegated ledger rows open their own evidence and parent without closing the to-do (wide %s)", async (wide) => {
  const scene = generateScene(undefined, { now: Math.floor(Date.now() / 1000), delegatedTodos: true, hubRound11: true });
  const source = new SyntheticSource({ scene });
  const done = vi.spyOn(source, "done");
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: wide, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk/ag-4");
  const view = render(<App store={new Store(source)} />);
  const card = await view.findByTestId("agent-card");
  if (!wide) fireEvent.click(card.querySelector("button")!);
  const list = await view.findByRole("list", { name: "할 일" });
  const links = [...list.querySelectorAll("a")];
  expect(links.map((link) => link.hash)).toEqual(["#/items/T1", "#/items/T2"]);
  expect(links[0].textContent).toContain(scene.itemDetails.T1.title);
  expect(links[0].textContent).toContain(scene.items.agents.find((agent) => agent.id === "ag-4")!.name);
  expect(links[0].textContent).toContain("진행 중");
  expect(links[1].textContent).toContain("결정 대기");
  expect(links[0].textContent).toContain(scene.itemDetails.T1.doneCondition);
  expect(list.textContent).not.toMatch(/합쳐|병합|merged/i);
  fireEvent.click(links[0]);
  const detail = await view.findByTestId("screen-item");
  expect(detail.querySelector(".detail-title")?.textContent).toContain(scene.itemDetails.T1.title);
  expect(detail.textContent).toContain(scene.itemDetails.T1.doneCondition);
  expect(detail.querySelector('a[href="#/cards/k-101"]')).toBeTruthy();
  const runs = detail.querySelectorAll('ul[aria-label="실행"] a');
  expect(runs).toHaveLength(2);
  fireEvent.click(detail.querySelector('a[href="#/runs/r1"]')!);
  const record = await view.findByTestId("timeline");
  expect(record.textContent).toContain("검토 필요");
  expect(record.textContent).toContain(scene.records.r1.rounds[1].result);
  expect(record.textContent).toContain("완료 기록이 없다");
  expect(record.textContent).toContain(scene.records.r1.rounds[2].result);
  expect(record.textContent).not.toMatch(/합쳐|병합|merged/i);
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
  });
  const reopened = await view.findByTestId("screen-item");
  expect(reopened.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false");
  const parent = reopened.querySelector('a[href="#/goals/G1"]');
  expect(parent).toBeTruthy();
  fireEvent.click(parent!);
  const goal = await view.findByTestId("screen-goal");
  expect(goal.textContent).toContain(scene.itemDetails.G1.why);
  expect(done).not.toHaveBeenCalled();
});

test("a namesake parent opened from its to-do shows only attributable work", async () => {
  const source = new SyntheticSource({ scene: generateScene(undefined, { now: Math.floor(Date.now() / 1000), delegatedTodos: true }) });
  window.history.replaceState(null, "", "/app/#/items/T4");
  const view = render(<App store={new Store(source)} />);
  const item = await view.findByTestId("screen-item");
  fireEvent.click(item.querySelector('a[href="#/goals/G2"]')!);
  const goal = await view.findByTestId("screen-goal");
  await waitFor(() => expect(goal.querySelector('a[href="#/cards/k-102"]')).toBeTruthy());
  expect(goal.querySelector('a[href="#/cards/k-101"]')).toBeNull();
});

// lina-app#167 item 1: the hub lists goals with no to-dos (14 of 49 on 11-15). The folded card on a phone read
// `<goal> 0/0 · <goal> 0/1 · …`; a goal with no to-dos shows no progress there, as on the lists (lina-app#160).
test("the folded card shows no 0/0 for a goal with no to-dos, and keeps the others' progress", async () => {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const items = source.scene.items.items as ItemSummary[];
  const first = items.find((item) => item.kind === "goal" && item.agent === "ag-1")!;
  items.push({ ...first, id: "G90", title: "운영 메모를 설계 문서로 옮기기", state: "in_progress", reason: null, due: null, todos: { done: 0, total: 0 } });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk/ag-1");
  const view = render(<App store={new Store(source)} />);
  const toggle = await waitFor(() => view.getByTestId("agent-card").querySelector(".agent-card-toggle") as HTMLElement);
  const parts = toggle.querySelector(".sub")!.textContent!.split(" · ");
  expect(parts).toContain("운영 메모를 설계 문서로 옮기기");
  expect(parts.join(" · ")).not.toMatch(/\b0\/0\b/);
  expect(parts.find((part) => part.startsWith(first.title))).toMatch(/ \d+\/[1-9]\d*$/);
  fireEvent.click(toggle);
  const row = view.getAllByTestId("row").find((each) => each.textContent?.includes("운영 메모를 설계 문서로 옮기기"))!;
  expect(row.querySelector("a")!.getAttribute("aria-label")).not.toMatch(/0\/0/);
});

// lina-app#190: at 390 the opened card kept its one-line summary of the goals and their n/n over the goal rows that
// show the same goals and numbers. The summary shows while the card is folded only.
test("at 390 the card's summary line shows while folded and goes while the goals are open", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk/ag-1");
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} />);
  const toggle = await waitFor(() => view.getByTestId("agent-card").querySelector(".agent-card-toggle") as HTMLElement);
  expect(toggle.querySelector(".sub")?.textContent).toMatch(/\d+\/\d+/);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.querySelector(".sub")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.querySelector(".sub")?.textContent).toMatch(/\d+\/\d+/);
});

// lina-app#190: at 390 the opened card read `목표 2` three times: its toggle, its counts line and the goals' own head. The
// toggle `에이전트 · 목표 n` heads the goal rows, so the counts leave the goals out and the goals draw no head of their own;
// the wide card keeps both.
test.each([false, true])("the opened card reads 목표 n once at 390, the wide card keeps its counts and head (wide %s)", async (wide) => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk/ag-1");
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} />);
  const card = await waitFor(() => view.getByTestId("agent-card"));
  const toggle = card.querySelector(".agent-card-toggle") as HTMLElement | null;
  if (toggle) fireEvent.click(toggle);
  await waitFor(() => expect(card.querySelectorAll("[data-testid=row]").length).toBeGreaterThan(0));
  const said = (element: Element | null) => (element?.textContent ?? "").match(/목표 ?\d+/g) ?? [];
  const counts = card.querySelector("[data-testid=agent-card-counts]");
  const heads = [...card.querySelectorAll(".section-head")].filter((head) => head.textContent?.startsWith("목표"));
  expect(card.querySelector("ul[aria-label='목표']")).toBeTruthy();
  if (wide) {
    expect(said(counts)).toEqual(["목표 2"]);
    expect(heads).toHaveLength(1);
    return;
  }
  expect(toggle?.textContent).toBe("에이전트 · 목표 2");
  expect(said(counts)).toEqual([]);
  expect(counts?.textContent).toContain("진행 중 1");
  expect(heads).toHaveLength(0);
  expect(said(card)).toEqual(["목표 2"]);
});

// lina-app#167 item 6: at 390 the 대화 list had no 메뉴; it has the one 작업 has.
test("at 390 the 대화 list opens the 작업 menu from its header", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk");
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} />);
  await waitFor(() => expect(view.getByTestId("talk-agents")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "메뉴" }));
  const menu = view.getByRole("dialog", { name: "메뉴" });
  for (const id of ["nav-today", "nav-inbox", "nav-goals"]) expect(menu.querySelector(`[data-testid=${id}]`)).toBeTruthy();
});

// lina-app#200 item 2: on the hub a goal whose one to-do is done but that still waits (1/1, state waiting) drew an
// empty circle, while 2/2 and 3/3 goals already closed drew the checked, struck-through mark. On the card the mark
// follows the goal's own to-dos: every n/n draws the done mark, and a goal with an open to-do keeps its dial.
test("every n/n goal on the 대화 card draws the done mark, whatever n, and 0/1 keeps its dial", async () => {
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const items = source.scene.items.items as ItemSummary[];
  const first = items.find((item) => item.kind === "goal" && item.agent === "ag-1")!;
  const goal = (id: string, title: string, state: ItemSummary["state"], done: number, total: number) => ({ ...first, id, title, state, reason: null, due: null, todos: { done, total } });
  items.push(goal("G91", "하나 끝난 목표", "waiting", 1, 1), goal("G92", "둘 끝난 목표", "done", 2, 2), goal("G93", "하나 남은 목표", "in_progress", 0, 1));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/talk/ag-1");
  const view = render(<App store={new Store(source)} />);
  const card = await waitFor(() => view.getByTestId("agent-card"));
  const row = (title: string) => [...card.querySelectorAll("[data-testid=row]")].find((each) => each.textContent?.includes(title)) as HTMLElement;
  await waitFor(() => expect(row("하나 남은 목표")).toBeTruthy());
  for (const title of ["하나 끝난 목표", "둘 끝난 목표"]) {
    expect(row(title).classList.contains("is-checked"), title).toBe(true);
    expect(row(title).querySelector("[data-testid=done-check]")?.getAttribute("aria-checked"), title).toBe("true");
  }
  expect(row("하나 남은 목표").querySelector("[data-testid=done-check]")).toBeNull();
  expect(row("하나 남은 목표").querySelector(".dial")).toBeTruthy();
});
