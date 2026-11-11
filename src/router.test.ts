import { act, cleanup, render } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, test } from "vitest";
import { back, defaultListFor, directionOf, href, navigate, onSaveScroll, onStackMotion, parse, tabOf, tabRoot, TABS, useNav, type Direction } from "./router";

// Preact runs a passive effect's cleanup after paint; unmounting inside act flushes it before the test ends, so no
// timer outlives the test environment (and no old listener sees the next test's history).
afterEach(async () => {
  await act(async () => cleanup());
});

describe("the 완료 filter lives in the address", () => {
  test("#/done?agent=<id> reads back as the same filter and writes the same address", () => {
    expect(parse("#/done?agent=ag-1")).toEqual({ name: "done", agent: "ag-1" });
    expect(href({ name: "done", agent: "ag-1" })).toBe("#/done?agent=ag-1");
    expect(parse("#/done")).toEqual({ name: "done" });
    expect(href({ name: "done" })).toBe("#/done");
  });
});

describe("설정 and the lists it pushes", () => {
  test("#/settings is a list; what it pushes reads back as the same page", () => {
    expect(parse("#/settings")).toEqual({ name: "settings" });
    expect(href({ name: "settings" })).toBe("#/settings");
    expect(parse("#/settings/runner/codex/model")).toEqual({ name: "setting", page: "runner/codex/model" });
    expect(href({ name: "setting", page: "runner/codex/model" })).toBe("#/settings/runner/codex/model");
    expect(parse(href({ name: "setting", page: "device/a b" }))).toEqual({ name: "setting", page: "device/a b" });
  });
});

describe("the three tabs", () => {
  test("#/talk lists the agents and #/talk/<id> opens one agent's window; every screen belongs to one tab", () => {
    expect(parse("#/talk")).toEqual({ name: "talks" });
    expect(parse("#/talk/ag-1")).toEqual({ name: "talk", id: "ag-1" });
    expect(href({ name: "talks" })).toBe("#/talk");
    expect(href({ name: "talk", id: "a b" })).toBe("#/talk/a%20b");
    expect(parse("#/talks")).toEqual({ name: "home" });
    expect(defaultListFor({ name: "talk", id: "ag-1" })).toEqual({ name: "talks" });
    expect(TABS.map((tab) => href(tabRoot(tab)))).toEqual(["#/talk", "#/", "#/status"]);
    const tabs = ["#/talk", "#/talk/ag-1", "#/", "#/today", "#/inbox", "#/agents/ag-1", "#/goals/G1", "#/cards/k-1", "#/status", "#/settings", "#/settings/runner/codex"].map((hash) => tabOf(parse(hash)));
    expect(tabs).toEqual(["talk", "talk", "work", "work", "work", "work", "work", "work", "status", "status", "status"]);
  });
});

describe("stack direction", () => {
  test("a deeper stack is a push, a shallower one a pop, the same depth a plain swap", () => {
    expect(directionOf(["#/"], ["#/", "#/running"])).toBe("push");
    expect(directionOf(["#/", "#/running", "#/cards/k-101"], ["#/", "#/running"])).toBe("pop");
    expect(directionOf(["#/items/T4"], ["#/inbox"])).toBe("none");
  });
});

function Shown() {
  const { hash } = useNav();
  return h("p", { "data-testid": "shown" }, hash);
}

describe("the motion learns the direction before the screen swaps", () => {
  afterEach(() => {
    onStackMotion(null);
    onSaveScroll(() => ({}));
  });

  test("push on a link, pop on our back, pop on a replace back to the list", async () => {
    window.history.replaceState(null, "", "/app/#/");
    const view = render(h(Shown, null));
    const seen: { direction: Direction; before: string; after: string }[] = [];
    onStackMotion((direction, apply) => {
      const before = view.getByTestId("shown").textContent ?? "";
      void apply().then(() => seen.push({ direction, before, after: view.getByTestId("shown").textContent ?? "" }));
    });

    await act(async () => navigate("#/running"));
    await act(async () => {
      const popped = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
      back();
      await popped;
    });
    await act(async () => navigate("#/inbox", { replace: true, direction: "pop" }));

    expect(seen).toEqual([
      { direction: "push", before: "#/", after: "#/running" },
      { direction: "pop", before: "#/running", after: "#/" },
      { direction: "pop", before: "#/", after: "#/inbox" },
    ]);
  });

  test("one back fires popstate and hashchange; the screen swaps once", async () => {
    window.history.replaceState(null, "", "/app/#/");
    render(h(Shown, null));
    const directions: Direction[] = [];
    onStackMotion((direction, apply) => {
      directions.push(direction);
      void apply();
    });
    await act(async () => navigate("#/goals"));
    await act(async () => {
      const changed = new Promise((resolve) => window.addEventListener("hashchange", resolve, { once: true }));
      window.history.back();
      await changed;
    });
    expect(directions).toEqual(["push", "none"]);
  });
  test("a browser back swaps at once; only our own back slides", async () => {
    window.history.replaceState(null, "", "/app/#/");
    render(h(Shown, null));
    const directions: Direction[] = [];
    onStackMotion((direction, apply) => {
      directions.push(direction);
      void apply();
    });
    const popped = () => new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    await act(async () => navigate("#/goals"));
    await act(async () => {
      const done = popped();
      window.history.back();
      await done;
    });
    await act(async () => navigate("#/goals"));
    await act(async () => {
      const done = popped();
      back();
      await done;
    });
    expect(directions).toEqual(["push", "none", "push", "pop"]);
  });

  test("a swap that a newer one overtook does not bring back its screen or scroll when it runs late", async () => {
    window.history.replaceState({ stack: ["#/"], scroll: {} }, "", "/app/#/");
    // The menu is scrolled to 120 when its row is tapped; navigate saves that into the menu's history entry.
    onSaveScroll(() => ({ main: 120 }));
    const scrolls: number[] = [];
    function Scroll() {
      const { hash, state } = useNav();
      scrolls.push(state.scroll.main ?? 0);
      return h("p", { "data-testid": "shown" }, hash);
    }
    const view = render(h(Scroll, null));
    // A slow device: the push's swap waits for its frame, the back arrives first and its swap runs first, then the
    // skipped push's swap runs (the order a skipped View Transition can take).
    const queued: (() => Promise<void>)[] = [];
    onStackMotion((_direction, apply) => {
      queued.push(apply);
    });
    navigate("#/goals");
    await act(async () => {
      const done = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
      window.history.back();
      await done;
    });
    expect(queued).toHaveLength(2);
    // Every swap completes, the late one too: a promise left pending holds its View Transition until it times out.
    // act renders when its callback returns, so each swap's promise is awaited after it.
    let newer: Promise<void> = Promise.resolve();
    let late: Promise<void> = Promise.resolve();
    await act(async () => {
      newer = queued[1]();
    });
    await newer;
    await act(async () => {
      late = queued[0]();
    });
    await late;
    expect(view.getByTestId("shown").textContent).toBe("#/");
    expect(scrolls.at(-1)).toBe(120);
  });
});
