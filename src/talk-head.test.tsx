import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";

// lina-app#191: the 대화 window's head reads like a chat app's: the agent's picture (or its letter circle) and name in
// the bar, once, a back icon with no word, and no help line under the name.

async function open(hash: string, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, agents: source.scene.items.agents };
}

/** The bar the window's head stands in: the phone's navbar, the wide window's toolbar. */
function bar(view: ReturnType<typeof render>, wide: boolean): HTMLElement {
  return view.container.querySelector(wide ? ".toolbar" : ".navbar") as HTMLElement;
}

test.each([false, true])("the bar holds the agent's mark and name as the screen's one title, and the window under it repeats neither (wide %s)", async (wide) => {
  const { view, agents } = await open("#/talk/ag-2", wide);
  const head = bar(view, wide);
  await waitFor(() => expect(within(head).getByTestId("agent-talk-name").textContent).toBe(agents[1].name));
  expect(view.getAllByTestId("screen-title")).toHaveLength(1);
  expect(head.contains(view.getByTestId("screen-title"))).toBe(true);
  expect(head.querySelector(".talk-head > .mark")).not.toBeNull();
  const window = view.getByTestId("agent-talk");
  expect(window.querySelector(".agent-talk-head")).toBeNull();
  expect(within(window).queryByText(agents[1].name)).toBeNull();
});

test.each([false, true])("no help line stands under the name (wide %s)", async (wide) => {
  const { view } = await open("#/talk/ag-1", wide);
  await waitFor(() => expect(view.getByTestId("agent-talk-name")).toBeTruthy());
  expect(view.container.textContent).not.toContain("앱 대화");
  expect(view.container.textContent).not.toContain("메신저 대화와 따로 남음");
});

test("on a phone back is an icon with no word, named for the list it returns to", async () => {
  const { view } = await open("#/talk/ag-1", false);
  const back = await waitFor(() => view.getByTestId("back"));
  expect(back.textContent).toBe("");
  expect(back.getAttribute("aria-label")).toBe("대화");
  expect(back.querySelector("svg")).not.toBeNull();
});

test("an agent without the picture flag gets the letter circle and no image request, on the list and in the bar", async () => {
  const { view, agents } = await open("#/talk", false);
  const rows = await waitFor(() => view.getAllByTestId(/^talk-agent-\d$/));
  expect(rows).toHaveLength(agents.length);
  const marks = rows.map((row) => row.querySelector(".mark") as HTMLElement);
  expect(marks.map((mark) => Boolean(mark.querySelector("img")))).toEqual(agents.map((agent) => "avatar" in agent && agent.avatar === true));
  expect(marks[1].textContent).toBe(Array.from(agents[1].name)[0].toUpperCase());
  fireEvent.click(rows[1].querySelector("a") as HTMLElement);
  await waitFor(() => expect(within(bar(view, false)).getByTestId("agent-talk-name").textContent).toBe(agents[1].name));
  expect(bar(view, false).querySelector("img")).toBeNull();
});

// Last: a picture that failed is remembered for the page, so later marks of that agent stay the letter circle.
test("an agent the people list gives a picture draws it in its mark; a picture that fails leaves the letter circle in the same place", async () => {
  const { view, agents } = await open("#/talk/ag-1", false);
  const mark = await waitFor(() => {
    const found = bar(view, false).querySelector(".talk-head > .mark");
    expect(found?.querySelector("img")).toBeTruthy();
    return found as HTMLElement;
  });
  const img = mark.querySelector("img") as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("/api/lina/agents/ag-1/avatar");
  expect(img.getAttribute("alt")).toBe("");
  // The letter is drawn under the picture, so the circle is there before it loads and after it fails.
  expect(mark.textContent).toBe(Array.from(agents[0].name)[0].toUpperCase());
  fireEvent.error(img);
  await waitFor(() => expect(mark.querySelector("img")).toBeNull());
  expect(mark.textContent).toBe(Array.from(agents[0].name)[0].toUpperCase());
  expect(mark.isConnected).toBe(true);
});
