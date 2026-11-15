import { fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import type { ItemSummary } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
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
