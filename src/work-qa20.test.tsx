import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { FINISHED_SHOWN, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { localDay } from "./model";
import { STOP_WAIT, W } from "./words";

// lina-app#225 (QA round 20, the real hub): 완료 counted cards while collapsed and rows once opened (525, then 475); two
// stopped cards with no goal and a Latin word in their own title read 제목 없음; a planned card whose goal title held a
// Latin word was in no list; and a waiting to-do past its due date read only its date. The cards here have the hub's
// shapes field by field (&hub=round20); every title is made up.

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound20: true });

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

const cardsIn = (source: SyntheticSource, state: string) => source.scene.cards.cards.filter((card) => card.state === state);
const sidebarDone = (view: ReturnType<typeof render>) => Number(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")?.textContent ?? "0");

/** What 완료 draws: its head, its rows, the cards the rows stand for (each `×n` counts n), the fold's `외 n개`. */
function finished(view: ReturnType<typeof render>) {
  const group = view.getByTestId("section-finished");
  const rows = [...group.querySelectorAll("[data-testid=row]")];
  const more = group.querySelector(".more-row:not([data-testid=fold-hide])");
  return {
    head: Number(view.getByTestId("head-finished").querySelector("[data-testid=count]")?.textContent),
    rows: rows.length,
    cards: rows.reduce((sum, row) => sum + Number(/×(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0),
    fold: Number(/외 (\d+)개/.exec(more?.textContent ?? "")?.[1] ?? 0),
    loading: more?.textContent === W.loading,
  };
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`${W.done} counts cards in every state: the head, the sidebar, the fold and the rows' ×n are one number, collapsed, reading and opened (${width})`, async () => {
    const source = hub();
    const total = cardsIn(source, "done").length;
    expect(total).toBeGreaterThan(40);
    const view = await open("#/", source, wide);
    const before = finished(view);
    expect(before).toEqual({ head: total, rows: FINISHED_SHOWN, cards: FINISHED_SHOWN, fold: total - FINISHED_SHOWN, loading: false });
    if (wide) expect(sidebarDone(view)).toBe(total);
    const group = view.getByTestId("section-finished");
    const states: ReturnType<typeof finished>[] = [];
    const watch = new MutationObserver(() => states.push(finished(view)));
    watch.observe(group, { subtree: true, childList: true, characterData: true });
    fireEvent.click(group.querySelector(".more-row button") as HTMLElement);
    await waitFor(() => expect(within(group).queryByRole("button", { name: `${W.done} ${W.close}` })).not.toBeNull());
    watch.disconnect();
    expect(states.some((state) => state.loading)).toBe(true);
    for (const state of states) expect(state.head).toBe(total);
    for (const state of states) if (!state.loading) expect(state.cards + state.fold).toBe(total);
    const after = finished(view);
    expect(after).toMatchObject({ head: total, cards: total, fold: 0 });
    expect(after.rows).toBeLessThan(total);
    if (wide) expect(sidebarDone(view)).toBe(total);
    // The cards nothing names are one grey row that says how many, never 제목 없음.
    const unnamed = [...group.querySelectorAll("[data-testid=row] .title.is-kind")].map((title) => title.textContent);
    expect(unnamed).toEqual([`${W.cards} ${W.repeated(4)}`]);
    expect(view.container.textContent).not.toContain(W.untitled);
    expect([...group.querySelectorAll("[data-testid=row]")].map((row) => /×(\d+)/.exec(row.textContent ?? "")?.[1]).filter(Boolean)).toEqual(["4", "3", "2", "4"]);
  });

  test(`${W.done} screen: 전체 counts the cards its rows stand for, the sidebar's number (${width})`, async () => {
    const source = hub();
    const view = await open("#/done", source, wide);
    const list = await waitFor(() => view.getByRole("list", { name: W.done }));
    const all = view.getByRole("button", { name: new RegExp(`^${W.allAgents} \\d+$`) });
    const cards = [...list.querySelectorAll("[data-testid=row]")].reduce((sum, row) => sum + Number(/×(\d+)/.exec(row.textContent ?? "")?.[1] ?? 1), 0);
    expect(cards).toBe(cardsIn(source, "done").length);
    expect(Number(all.querySelector(".count")?.textContent)).toBe(cards);
    if (wide) expect(sidebarDone(view)).toBe(cards);
  });

  test(`every stopped and planned card is a row, named by what is left of its title once its references go, never ${W.untitled} (${width})`, async () => {
    const source = hub();
    const view = await open("#/", source, wide);
    const stopped = view.getByTestId("section-stopped");
    fireEvent.click(stopped.querySelector(".more-row button") as HTMLElement);
    const stoppedRows = [...stopped.querySelectorAll("[data-testid=row]")];
    expect(cardsIn(source, "stopped")).toHaveLength(13);
    expect(stoppedRows).toHaveLength(13);
    expect(Number(view.getByTestId("head-stopped").querySelector("[data-testid=stopped-count]")?.textContent)).toBe(13);
    expect(stopped.textContent).not.toContain(W.untitled);
    const titles = stoppedRows.map((row) => row.querySelector(".title")?.textContent);
    expect(titles).toContain("Grafana 대시보드 패널 순서 맞추기");
    expect(titles).toContain("Figma 시안의 버튼 간격을 Tailwind 기준으로 다시 맞추기");
    const grafana = stoppedRows.find((row) => row.textContent?.includes("Grafana"));
    expect(grafana?.querySelector(".title")?.classList.contains("is-kind")).toBe(false);
    expect(grafana?.textContent).toContain(STOP_WAIT.feedback);

    const planned = view.getByTestId("section-planned");
    const plannedRows = [...planned.querySelectorAll("[data-testid=row]")];
    expect(plannedRows).toHaveLength(cardsIn(source, "planned").length);
    expect(Number(view.getByTestId("head-planned").querySelector("[data-testid=count]")?.textContent)).toBe(plannedRows.length);
    const notion = plannedRows.find((row) => row.querySelector(".title")?.textContent === "Notion 문서 옮기기");
    expect(notion?.querySelector("[data-testid=row-sub]")?.textContent).toBe("Notion 페이지 목록을 새 폴더로 정리");
    expect(view.container.textContent).not.toContain(W.untitled);
  });

  test(`a waiting to-do past its due date reads ${W.dueOverdue} on its 내 할 일 row and keeps its wait word with ${W.dueOverdue} on its head (${width})`, async () => {
    const source = hub();
    // T9 is the owner's to-do waiting on their feedback, due the day before the scene's clock, as two were on the hub.
    expect(source.scene.itemDetails.T9).toMatchObject({ state: "waiting", reason: "feedback" });
    expect((source.scene.itemDetails.T9.due ?? "") < localDay(source.scene.now)).toBe(true);
    const home = await open("#/", source, wide);
    const mine = home.getByTestId("home-mine");
    const more = mine.querySelector<HTMLElement>(".more-row button");
    if (more) fireEvent.click(more);
    const row = within(mine).getAllByTestId("row").find((each) => each.textContent?.includes("저장소 접근 권한 주기"));
    expect(row?.querySelector(".trail .kind-word")?.textContent).toBe(W.dueOverdue);
    expect(row?.querySelector(".due-date")?.classList.contains("is-overdue")).toBe(true);
    expect(row?.querySelector("a")?.getAttribute("aria-label")).toContain(W.dueOverdue);
    home.unmount();
    document.body.innerHTML = "";

    const item = await open("#/items/T9", source, wide);
    await waitFor(() => expect(item.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")).not.toBeNull());
    expect(item.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")?.textContent).toBe(`${STOP_WAIT.feedback} · ${W.dueOverdue}`);
  });
}
