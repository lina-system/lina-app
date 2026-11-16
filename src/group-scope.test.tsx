import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND24, SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#244: the line of the cards nothing names opens its own address, which carries the list it was drawn in
// (every agent's 완료, one agent's 완료, a goal's work list). Its detail is that list's line; a card's address opens the
// card, also the newest card of a line. On the hub's shapes (&hub=round24); every title is made up.

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound24: true });

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

/** The grey line of a list: its name, its second line and its link. */
function greyOf(list: HTMLElement) {
  const row = list.querySelector("[data-testid=row]:has(.title.is-kind)") as HTMLElement | null;
  if (!row) return null;
  return { name: row.querySelector(".title")?.textContent ?? "", sub: row.querySelector("[data-testid=row-sub]")?.textContent ?? null, link: row.querySelector("a") as HTMLAnchorElement };
}

/** What the group's detail says: its name, who, and the cards under it (by agent, or one line each). */
async function groupDrawn(view: ReturnType<typeof render>) {
  const head = await waitFor(() => view.getByTestId("group-head"));
  const detail = head.closest("article") as HTMLElement;
  const byAgent = [...detail.querySelectorAll("[data-testid=fold-agent]")];
  const members = [...detail.querySelectorAll<HTMLAnchorElement>("[data-testid=fold-member] a")];
  return {
    detail,
    name: detail.querySelector("h1")?.textContent ?? "",
    who: within(detail).getByTestId("group-agents").textContent ?? "",
    cards: byAgent.reduce((sum, row) => sum + Number(/(\d+)건$/.exec(row.textContent ?? "")?.[1] ?? 0), 0) + members.length,
    members: members.map((link) => link.getAttribute("href") ?? ""),
  };
}

/**
 * A card's address opens the card, never a group: its own detail, or for a card the scene serves no detail of (the hub
 * keeps no history of it), the one line saying it is not found, as for every such card.
 */
async function opensCard(id: string, wide: boolean) {
  document.body.innerHTML = "";
  const source = hub();
  const view = await open(`#/cards/${id}`, source, wide);
  if (source.scene.cardDetails[id]) await waitFor(() => expect(view.getAllByTestId("screen-card").length).toBeGreaterThan(0));
  else await waitFor(() => expect(view.getByText(W.notFound)).toBeTruthy());
  expect(view.queryByTestId("group-head")).toBeNull();
  view.unmount();
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`from every agent's 완료: the group's own address, the line's detail, the same after a reload, and its newest card opens as a card (${width})`, async () => {
    const view = await open("#/done", hub(), wide);
    const grey = greyOf(await waitFor(() => view.getByRole("list", { name: W.done })));
    expect(grey).not.toBeNull();
    const id = /^#\/group\/([^?]+)$/.exec(grey?.link.getAttribute("href") ?? "")?.[1];
    expect(id, grey?.link.getAttribute("href") ?? "").toBeDefined();
    fireEvent.click(grey?.link as HTMLElement);
    const shown = await groupDrawn(view);
    expect([shown.name, shown.who]).toEqual([grey?.name, grey?.sub]);
    expect(shown.cards).toBe(Number(/(\d+)/.exec(grey?.name ?? "")?.[1]));
    view.unmount();
    // Reloaded on its address, it is the same screen.
    const again = await groupDrawn(await open(`#/group/${id}`, hub(), wide));
    expect([again.name, again.who, again.cards]).toEqual([shown.name, shown.who, shown.cards]);
    await opensCard(decodeURIComponent(id ?? ""), wide);
  });

  test(`from one agent's 완료: that agent's group with its count and cards, never every agent's; each card under it opens as a card, and back is that 완료 (${width})`, async () => {
    const source = hub();
    // Every agent's group, then each agent's with two or more cards nothing names.
    const all = await open("#/done", source, wide);
    const everyone = greyOf(await waitFor(() => all.getByRole("list", { name: W.done })));
    const globalId = /^#\/group\/(.+)$/.exec(everyone?.link.getAttribute("href") ?? "")?.[1];
    all.unmount();
    let sameNewest = false;
    let scoped = 0;
    for (const agent of source.scene.items.agents) {
      document.body.innerHTML = "";
      const view = await open(`#/done?agent=${agent.id}`, hub(), wide);
      const grey = greyOf(await waitFor(() => view.getByRole("list", { name: W.done })));
      if (!grey || !/^#\/group\//.test(grey.link.getAttribute("href") ?? "")) {
        view.unmount();
        continue;
      }
      scoped += 1;
      const href = grey.link.getAttribute("href") ?? "";
      expect(href).toMatch(new RegExp(`^#/group/[^?]+\\?agent=${agent.id}$`));
      const id = /^#\/group\/([^?]+)/.exec(href)?.[1];
      if (id === globalId) sameNewest = true;
      fireEvent.click(grey.link);
      const shown = await groupDrawn(view);
      expect(shown.name).toBe(grey.name);
      expect(shown.name).not.toBe(everyone?.name);
      expect(shown.who).toBe(agent.name);
      expect(shown.cards).toBe(Number(/(\d+)/.exec(grey.name)?.[1]));
      expect(shown.members[0]).toBe(`#/cards/${id}`);
      // Its newest card, from its own line under the group, opens as a card.
      fireEvent.click(view.getByTestId("group-head").closest("article")?.querySelector("[data-testid=fold-member] a") as HTMLElement);
      await waitFor(() => expect(window.location.hash).toBe(`#/cards/${id}`));
      await waitFor(() => expect(view.queryByTestId("group-head")).toBeNull());
      if (id === globalId) await waitFor(() => expect(view.getAllByTestId("screen-card").length).toBeGreaterThan(0));
      view.unmount();
      await opensCard(decodeURIComponent(id ?? ""), wide);
    }
    // The scene holds one agent whose group's newest card is every agent's group's newest too, and others.
    expect(sameNewest).toBe(true);
    expect(scoped).toBeGreaterThan(1);
  });

  test(`from a goal's work list: the goal's group (its count and agents), after a reload too; its newest card opens as a card (${width})`, async () => {
    const view = await open("#/goals/G10", hub(), wide);
    const grey = greyOf(await waitFor(() => view.getByRole("list", { name: W.cards })));
    expect(grey?.name).toBe(W.untitledCount(ROUND24.workUnnamed.length));
    const href = grey?.link.getAttribute("href") ?? "";
    expect(href).toMatch(/^#\/group\/[^?]+\?goal=G10$/);
    fireEvent.click(grey?.link as HTMLElement);
    const shown = await groupDrawn(view);
    expect([shown.name, shown.who, shown.cards]).toEqual([W.untitledCount(ROUND24.workUnnamed.length), W.agentsCount(3), ROUND24.workUnnamed.length]);
    view.unmount();
    const again = await groupDrawn(await open(href, hub(), wide));
    expect([again.name, again.who, again.cards]).toEqual([shown.name, shown.who, shown.cards]);
    await opensCard(decodeURIComponent(/^#\/group\/([^?]+)/.exec(href)?.[1] ?? ""), wide);
  });
}

test("back from a group opened in one agent's 완료 is that 완료", async () => {
  const source = hub();
  const view = await open("#/", source, false);
  for (const agent of source.scene.items.agents) {
    window.location.hash = `#/done?agent=${agent.id}`;
    const list = await waitFor(() => view.getByRole("list", { name: W.done }));
    await waitFor(() => expect(window.location.hash).toBe(`#/done?agent=${agent.id}`));
    const grey = greyOf(list);
    if (!grey || !/^#\/group\//.test(grey.link.getAttribute("href") ?? "")) continue;
    fireEvent.click(grey.link);
    await groupDrawn(view);
    fireEvent.click(view.getByTestId("back"));
    await waitFor(() => expect(window.location.hash).toBe(`#/done?agent=${agent.id}`));
    expect(view.queryByTestId("group-head")).toBeNull();
    return;
  }
  throw new Error("no agent's 완료 holds a group");
});
