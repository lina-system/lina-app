export const REFRESH_MS = 10_000;

export interface RefreshHost {
  readonly document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

/**
 * The one place that decides when to read again: every 10 s while the tab is visible, paused while hidden,
 * once right away when it shows again. lina-app#8 swaps this timer for the core's change stream.
 */
export function startRefresh(run: () => void, host: RefreshHost = window, intervalMs = REFRESH_MS): () => void {
  let timer: number | null = null;
  const stop = () => {
    if (timer !== null) host.clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = host.setInterval(run, intervalMs);
  };
  const onVisibility = () => {
    if (host.document.visibilityState === "hidden") {
      stop();
      return;
    }
    run();
    start();
  };
  host.document.addEventListener("visibilitychange", onVisibility);
  if (host.document.visibilityState !== "hidden") {
    run();
    start();
  }
  return () => {
    stop();
    host.document.removeEventListener("visibilitychange", onVisibility);
  };
}
