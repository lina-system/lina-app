import { describe, expect, test, vi } from "vitest";
import { BACK_PX, EDGE_PX, isStandalone, swipeBack } from "./swipe-back";

function recognizer({ standalone = true, atRoot = false } = {}) {
  const onBack = vi.fn();
  const swipe = swipeBack({ standalone: () => standalone, atRoot: () => atRoot, onBack });
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    swipe.start(from);
    for (let step = 1; step <= 5; step += 1) swipe.move({ x: from.x + ((to.x - from.x) * step) / 5, y: from.y + ((to.y - from.y) * step) / 5 });
    return swipe.end(to);
  };
  return { onBack, drag };
}

describe("left-edge swipe back", () => {
  test("from the edge, right past the threshold, goes back once", () => {
    const { onBack, drag } = recognizer();
    expect(drag({ x: 4, y: 300 }, { x: 4 + BACK_PX + 10, y: 310 })).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("a start outside the edge zone does nothing", () => {
    const { onBack, drag } = recognizer();
    expect(drag({ x: EDGE_PX + 1, y: 300 }, { x: EDGE_PX + 200, y: 300 })).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("a move short of the threshold does nothing", () => {
    const { onBack, drag } = recognizer();
    expect(drag({ x: 4, y: 300 }, { x: 4 + BACK_PX - 1, y: 300 })).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("a mostly vertical gesture is a scroll and is dropped, even if it ends far right", () => {
    const { onBack, drag } = recognizer();
    expect(drag({ x: 4, y: 100 }, { x: 4 + BACK_PX + 20, y: 500 })).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("off outside the installed app", () => {
    const { onBack, drag } = recognizer({ standalone: false });
    expect(drag({ x: 4, y: 300 }, { x: 200, y: 300 })).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("off on the first screen", () => {
    const { onBack, drag } = recognizer({ atRoot: true });
    expect(drag({ x: 4, y: 300 }, { x: 200, y: 300 })).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("installed app", () => {
  const matching = (standalone: boolean) => (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" });

  test("display-mode standalone or navigator.standalone counts; a tab does not", () => {
    expect(isStandalone({ matchMedia: matching(true), navigator: {} })).toBe(true);
    expect(isStandalone({ matchMedia: matching(false), navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({ matchMedia: matching(false), navigator: { standalone: false } })).toBe(false);
    expect(isStandalone({ navigator: {} })).toBe(false);
  });
});
