import type { Direction, Motion } from "./router";

type Transition = { finished: Promise<unknown> };
export type MotionHost = {
  document: {
    documentElement: { dataset: Record<string, string | undefined> };
    startViewTransition?: (update: () => Promise<void>) => Transition;
  };
  matchMedia?: (query: string) => { matches: boolean };
};

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The phone's push and pop: a same-document View Transition, its direction set on the root before the swap so the
 * CSS knows which way to slide. Without `startViewTransition`, under reduced motion, or for a swap that is neither
 * a push nor a pop, the screen swaps at once.
 */
export function slideMotion(host: MotionHost = window as unknown as MotionHost): Motion {
  return (direction: Direction, apply) => {
    const doc = host.document;
    const reduced = host.matchMedia?.(REDUCED_MOTION).matches ?? false;
    if (direction === "none" || reduced || typeof doc.startViewTransition !== "function") {
      void apply();
      return;
    }
    const root = doc.documentElement;
    root.dataset.nav = direction;
    const transition = doc.startViewTransition(apply);
    void transition.finished.finally(() => {
      if (root.dataset.nav === direction) delete root.dataset.nav;
    });
  };
}
