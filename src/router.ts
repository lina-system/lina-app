import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export type ListName = "inbox" | "running" | "due" | "done" | "goals" | "status";
export type Route =
  | { readonly name: "home" }
  | { readonly name: ListName }
  | { readonly name: "agent" | "goal" | "item" | "card" | "run"; readonly id: string };

const LISTS: readonly ListName[] = ["inbox", "running", "due", "done", "goals", "status"];
const PATHS: Record<string, Route["name"]> = { agents: "agent", goals: "goal", items: "item", cards: "card", runs: "run" };
const SEGMENT: Record<string, string> = { agent: "agents", goal: "goals", item: "items", card: "cards", run: "runs" };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: "home" };
  if (parts.length === 1 && (LISTS as readonly string[]).includes(parts[0])) return { name: parts[0] as ListName };
  const name = PATHS[parts[0]];
  if (parts.length === 2 && name && name !== "home") return { name, id: parts[1] } as Route;
  return { name: "home" };
}

export function href(route: Route): string {
  if (route.name === "home") return "#/";
  if ("id" in route) return `#/${SEGMENT[route.name]}/${encodeURIComponent(route.id)}`;
  return `#/${route.name}`;
}

/** Screens that sit in the middle column on a wide window; the rest open in the detail pane. */
export function isList(route: Route): boolean {
  return route.name === "agent" || (LISTS as readonly string[]).includes(route.name);
}

/** The list a detail falls back to when it was opened directly (a shared link or a reload). */
export function defaultListFor(route: Route): Route {
  switch (route.name) {
    case "card":
    case "run":
      return { name: "running" };
    case "goal":
      return { name: "goals" };
    case "item":
      return { name: "inbox" };
    default:
      return { name: "inbox" };
  }
}

export interface NavState {
  readonly stack: readonly string[];
  readonly scroll: Readonly<Record<string, number>>;
}

function currentHash(): string {
  return window.location.hash || "#/";
}

function readState(): NavState {
  const state = window.history.state as Partial<NavState> | null;
  return { stack: state?.stack ?? [currentHash()], scroll: state?.scroll ?? {} };
}

type ScrollReader = () => Record<string, number>;
let readScroll: ScrollReader = () => ({});

export function onSaveScroll(reader: ScrollReader): void {
  readScroll = reader;
}

/** Which way the stack moves: a push slides the next screen in from the right, a pop slides the top one out. */
export type Direction = "push" | "pop" | "none";

/** The direction between two history stacks: deeper is a push, shallower a pop, the same depth a plain swap. */
export function directionOf(from: readonly string[], to: readonly string[]): Direction {
  if (to.length > from.length) return "push";
  if (to.length < from.length) return "pop";
  return "none";
}

/**
 * How the screen swap is drawn. The phone shell sets a sliding one; everywhere else the swap is instant. `apply`
 * resolves once the next screen is in the document, scroll included.
 */
export type Motion = (direction: Direction, apply: () => Promise<void>) => void;
const instant: Motion = (_direction, apply) => void apply();
let motion: Motion = instant;

export function onStackMotion(next: Motion | null): void {
  motion = next ?? instant;
}

const listeners = new Set<(direction?: Direction) => void>();

export function navigate(to: Route | string, options: { replace?: boolean; direction?: Direction } = {}): void {
  const hash = typeof to === "string" ? to : href(to);
  const current = readState();
  window.history.replaceState({ ...current, scroll: readScroll() }, "");
  if (hash === currentHash() && !options.replace) return;
  const stack = options.replace ? [...current.stack.slice(0, -1), hash] : [...current.stack, hash];
  const next: NavState = { stack, scroll: {} };
  if (options.replace) window.history.replaceState(next, "", hash);
  else window.history.pushState(next, "", hash);
  const direction = options.direction ?? directionOf(current.stack, stack);
  for (const listener of listeners) listener(direction);
}

/** Set by our own back (the control or the edge swipe) until its popstate arrives; a browser back is not ours. */
let ownBack = false;

export function back(): void {
  ownBack = true;
  window.history.back();
}

export function useNav(): { route: Route; state: NavState; hash: string } {
  const read = () => ({ route: parse(currentHash()), state: readState(), hash: currentHash() });
  const [nav, setNav] = useState(read);
  const shown = useRef(nav);
  const committed = useRef(nav);
  const settle = useRef<(() => void) | null>(null);
  // Children's layout effects (the scroll restore) run first, so the swap is done, scroll included, before paint.
  useLayoutEffect(() => {
    committed.current = nav;
    settle.current?.();
    settle.current = null;
  }, [nav]);
  useEffect(() => {
    const update = (direction?: Direction) => {
      const next = read();
      // popstate and hashchange both fire for one back: the second finds the screen already shown.
      if (next.hash === shown.current.hash && next.state.stack.length === shown.current.state.stack.length) return;
      const way = direction ?? directionOf(shown.current.state.stack, next.state.stack);
      shown.current = next;
      motion(
        way,
        () =>
          new Promise<void>((resolve) => {
            // A late swap of an overtaken transition finds the latest screen already drawn: setting the same state
            // renders nothing and runs no layout effect, so it would never resolve and the transition would hang.
            if (committed.current === shown.current) {
              resolve();
              return;
            }
            settle.current?.();
            settle.current = resolve;
            // Always the latest screen: a transition skipped by a newer one still runs its swap, possibly after
            // the newer one, and must not bring back the screen (and the scroll) it was started for.
            setNav(shown.current);
          }),
      );
    };
    // A history step we did not start (the browser's back or forward, Safari's own swipe) is already drawn by the
    // browser: the screen swaps at once, in the same task, so its scroll is back before the next frame.
    const onHistory = (event: Event) => {
      const ours = ownBack;
      if (event.type === "popstate") ownBack = false;
      update(event.type === "popstate" && !ours ? "none" : undefined);
    };
    listeners.add(update);
    window.addEventListener("popstate", onHistory);
    window.addEventListener("hashchange", onHistory);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("hashchange", onHistory);
      settle.current?.();
    };
  }, []);
  return nav;
}

/** Click handler for in-app links: push our own history entry so popstate can restore scroll and selection. */
export function linkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.currentTarget as HTMLAnchorElement | null) ?? null;
  const target = anchor?.getAttribute("href");
  if (!target || !target.startsWith("#/")) return;
  event.preventDefault();
  navigate(target);
}
