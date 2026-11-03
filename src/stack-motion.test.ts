import { describe, expect, test, vi } from "vitest";
import { REDUCED_MOTION, slideMotion, type MotionHost } from "./stack-motion";

function host({ transitions, reduced }: { transitions: boolean; reduced: boolean }) {
  const dataset: Record<string, string | undefined> = {};
  let finish = () => {};
  const startViewTransition = vi.fn((update: () => Promise<void>) => {
    expect(dataset.nav).toBeDefined();
    void update();
    return { finished: new Promise<void>((resolve) => (finish = resolve)) };
  });
  const value: MotionHost = {
    document: { documentElement: { dataset }, ...(transitions ? { startViewTransition } : {}) },
    matchMedia: (query) => ({ matches: reduced && query === REDUCED_MOTION }),
  };
  return { value, dataset, startViewTransition, finish: () => finish() };
}

describe("push and pop", () => {
  test("a push runs a view transition with its direction set on the root first, then clears it", async () => {
    const page = host({ transitions: true, reduced: false });
    const apply = vi.fn(async () => {});
    slideMotion(page.value)("push", apply);
    expect(page.startViewTransition).toHaveBeenCalledTimes(1);
    expect(page.dataset.nav).toBe("push");
    expect(apply).toHaveBeenCalledTimes(1);
    page.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(page.dataset.nav).toBeUndefined();
  });

  test("a pop sets pop", () => {
    const page = host({ transitions: true, reduced: false });
    slideMotion(page.value)("pop", async () => {});
    expect(page.dataset.nav).toBe("pop");
  });

  test.each([
    ["without startViewTransition", { transitions: false, reduced: false }, "push"],
    ["under reduced motion", { transitions: true, reduced: true }, "push"],
    ["for a swap that is neither push nor pop", { transitions: true, reduced: false }, "none"],
  ] as const)("%s the screen swaps at once", (_case, options, direction) => {
    const page = host(options);
    const apply = vi.fn(async () => {});
    slideMotion(page.value)(direction, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(page.startViewTransition).not.toHaveBeenCalled();
    expect(page.dataset.nav).toBeUndefined();
  });
});
