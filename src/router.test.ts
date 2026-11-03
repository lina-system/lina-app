import { act, render } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, test } from "vitest";
import { directionOf, navigate, onStackMotion, useNav, type Direction } from "./router";

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
  afterEach(() => onStackMotion(null));

  test("push on a link, pop on back, pop on a replace back to the list", async () => {
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
      window.history.back();
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
    expect(directions).toEqual(["push", "pop"]);
  });
});
