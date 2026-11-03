export const EDGE_PX = 20;
export const BACK_PX = 72;
const DECIDE_PX = 10;

export type SwipeContext = {
  /** The installed Home Screen app only: a Safari tab already goes back with the browser's own swipe. */
  standalone: () => boolean;
  atRoot: () => boolean;
  onBack: () => void;
};

type Point = { x: number; y: number };

/**
 * The left-edge swipe back of a navigation stack: a touch that starts within EDGE_PX of the left edge and moves
 * right past BACK_PX goes back. A gesture that turns out mostly vertical is a scroll and is dropped.
 */
export function swipeBack(context: SwipeContext) {
  let start: Point | null = null;
  let horizontal: boolean | null = null;
  return {
    start(point: Point): void {
      start = point.x <= EDGE_PX && context.standalone() && !context.atRoot() ? point : null;
      horizontal = null;
    },
    move(point: Point): void {
      if (!start || horizontal !== null) return;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return;
      horizontal = Math.abs(dx) > Math.abs(dy);
    },
    end(point: Point): boolean {
      const from = start;
      start = null;
      if (!from || horizontal === false) return false;
      const dx = point.x - from.x;
      if (dx < BACK_PX || Math.abs(point.y - from.y) >= dx) return false;
      context.onBack();
      return true;
    },
    cancel(): void {
      start = null;
    },
  };
}

export function isStandalone(host: { matchMedia?: (query: string) => { matches: boolean }; navigator: { standalone?: boolean } } = window as never): boolean {
  return host.matchMedia?.("(display-mode: standalone)").matches === true || host.navigator.standalone === true;
}

export function bindSwipeBack(context: SwipeContext, target: Document = document): () => void {
  const swipe = swipeBack(context);
  const at = (event: TouchEvent): Point | null => {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onStart = (event: TouchEvent) => {
    const point = at(event);
    if (point && event.touches.length === 1) swipe.start(point);
    else swipe.cancel();
  };
  const onMove = (event: TouchEvent) => {
    const point = at(event);
    if (point) swipe.move(point);
  };
  const onEnd = (event: TouchEvent) => {
    const point = at(event);
    if (point) swipe.end(point);
  };
  const onCancel = () => swipe.cancel();
  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchmove", onMove, { passive: true });
  target.addEventListener("touchend", onEnd, { passive: true });
  target.addEventListener("touchcancel", onCancel, { passive: true });
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", onCancel);
  };
}
