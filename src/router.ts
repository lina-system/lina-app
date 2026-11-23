import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { WORK_ONLY } from "./mode";

export type ListName = "inbox" | "running" | "due" | "done" | "goals" | "status" | "settings" | "today" | "talks";
export type Route =
  | { readonly name: "home" }
  | { readonly name: Exclude<ListName, "done"> }
  /** 완료, optionally filtered to one agent: the filter lives in the address (`#/done?agent=<id>`), never in storage. */
  | { readonly name: "done"; readonly agent?: string }
  | { readonly name: "agent" | "goal" | "item" | "card" | "run"; readonly id: string }
  /**
   * A finished line of the cards nothing names, by its newest card, in the list it was drawn in (lina-app#244): every
   * agent's 완료 (`#/group/<card>`), one agent's (`?agent=<id>`) or a goal's work list (`?goal=<id>`). The card's own
   * address stays the card's.
   */
  | { readonly name: "group"; readonly id: string; readonly agent?: string; readonly goal?: string }
  /**
   * A card's worker run by its place among the card's worker runs (`#/cards/<card>/runs/<n>`, from 1): the run's own id
   * is a task id no person reads, and an address shows on hover and in the status bar (lina-app#238).
   */
  | { readonly name: "round"; readonly card: string; readonly n: number }
  /**
   * `talk` is the owner's own window on one agent (`#/talk/<agent>`); `talks` (`#/talk`) lists the agents. A goal
   * chosen on the agent's card opens under 대화 too (`#/talk/<agent>?goal=<id>`, lina-app#143).
   */
  | { readonly name: "talk"; readonly id: string; readonly goal?: string }
  /** A list the settings push (`#/settings/runner/codex/model`): `page` is the path after `settings/`. */
  | { readonly name: "setting"; readonly page: string }
  /** A report in the viewer (`#/reports/<id>`), or one earlier version of it (`?v=<n>`, lina-app#50). */
  | { readonly name: "report"; readonly id: string; readonly version?: number };

const LISTS: readonly ListName[] = ["inbox", "running", "due", "done", "goals", "status", "settings", "today", "talks"];
const PATHS: Record<string, Route["name"]> = { agents: "agent", goals: "goal", items: "item", cards: "card", runs: "run", talk: "talk" };
const SEGMENT: Record<string, string> = { agent: "agents", goal: "goals", item: "items", card: "cards", run: "runs", talk: "talk" };

/**
 * Talk, status, agent-ops and worker-card routes: a work-only build has no screens for them, so their addresses
 * open the work home. Default builds never pass this set.
 */
const HIDDEN_IN_WORK: ReadonlySet<Route["name"]> = new Set(["talks", "talk", "status", "settings", "setting", "running", "agent", "card", "run", "round", "group", "report"]);

/** Whether a route is gone from a work-only install (talk, status, running cards, worker runs). */
export function isHiddenInWork(name: Route["name"]): boolean {
  return HIDDEN_IN_WORK.has(name);
}

/** The three tabs at the top: 대화, 작업 and 상태. Every screen belongs to one. */
export type Tab = "talk" | "work" | "status";
export const TABS: readonly Tab[] = ["talk", "work", "status"];

export function tabOf(route: Route): Tab {
  switch (route.name) {
    case "talks":
    case "talk":
      return "talk";
    case "status":
    case "settings":
    case "setting":
      return "status";
    default:
      return "work";
  }
}

/** The screen a tab opens on: the agents to talk with, the work menu, the machines and quota. */
export function tabRoot(tab: Tab): Route {
  if (tab === "talk") return { name: "talks" };
  if (tab === "status") return { name: "status" };
  return { name: "home" };
}

export function parse(hash: string, workOnly: boolean = WORK_ONLY): Route {
  if (hash === "") return { name: workOnly ? "home" : "talks" };
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  let route: Route = { name: "home" };
  if (parts.length === 0) route = { name: "home" };
  else if (parts.length === 1 && parts[0] === "done") {
    const agent = new URLSearchParams(query).get("agent");
    route = agent ? { name: "done", agent } : { name: "done" };
  } else if (parts.length === 2 && parts[0] === "group") {
    const scope = new URLSearchParams(query);
    const agent = scope.get("agent");
    const goal = scope.get("goal");
    route = { name: "group", id: parts[1], ...(agent ? { agent } : {}), ...(goal ? { goal } : {}) };
  } else if (parts.length === 1 && parts[0] === "talk") route = { name: "talks" };
  else if (parts.length === 2 && parts[0] === "talk") {
    const goal = new URLSearchParams(query).get("goal");
    route = goal ? { name: "talk", id: parts[1], goal } : { name: "talk", id: parts[1] };
  } else if (parts.length === 1 && (LISTS as readonly string[]).includes(parts[0]) && parts[0] !== "talks") route = { name: parts[0] as ListName };
  else if (parts[0] === "settings") route = { name: "setting", page: parts.slice(1).join("/") };
  else if (parts.length === 2 && parts[0] === "reports") {
    const version = new URLSearchParams(query).get("v");
    route = version && /^[1-9]\d*$/.test(version) ? { name: "report", id: parts[1], version: Number(version) } : { name: "report", id: parts[1] };
  } else if (parts.length === 4 && parts[0] === "cards" && parts[2] === "runs" && /^[1-9]\d*$/.test(parts[3])) route = { name: "round", card: parts[1], n: Number(parts[3]) };
  else {
    const name = PATHS[parts[0]];
    if (parts.length === 2 && name && name !== "home") route = { name, id: parts[1] } as Route;
  }
  return workOnly && isHiddenInWork(route.name) ? { name: "home" } : route;
}

export function href(route: Route): string {
  if (route.name === "home") return "#/";
  if (route.name === "setting") return `#/settings/${route.page.split("/").map(encodeURIComponent).join("/")}`;
  if (route.name === "talk" && route.goal) return `#/talk/${encodeURIComponent(route.id)}?${new URLSearchParams({ goal: route.goal })}`;
  if (route.name === "round") return `#/cards/${encodeURIComponent(route.card)}/runs/${route.n}`;
  if (route.name === "report") return `#/reports/${encodeURIComponent(route.id)}${route.version ? `?v=${route.version}` : ""}`;
  if (route.name === "group") {
    const scope = String(new URLSearchParams(route.agent ? { agent: route.agent } : route.goal ? { goal: route.goal } : {}));
    return `#/group/${encodeURIComponent(route.id)}${scope ? `?${scope}` : ""}`;
  }
  if ("id" in route) return `#/${SEGMENT[route.name]}/${encodeURIComponent(route.id)}`;
  if (route.name === "done" && route.agent) return `#/done?${new URLSearchParams({ agent: route.agent })}`;
  if (route.name === "talks") return "#/talk";
  return `#/${route.name}`;
}

/** Screens that sit in the middle column on a wide window; the rest open in the detail pane. */
export function isList(route: Route): boolean {
  return route.name === "agent" || (LISTS as readonly string[]).includes(route.name);
}

/**
 * A goal, a to-do, a work card or a run: each opens in the one detail frame, never as a screen of its own (lina-app#142).
 * So does a goal chosen on an agent's card in 대화 (`#/talk/<agent>?goal=<id>`, lina-app#143).
 */
export function isFrame(route: Route): boolean {
  return route.name === "goal" || route.name === "item" || route.name === "card" || route.name === "group" || route.name === "run" || route.name === "round" || route.name === "report" || (route.name === "talk" && Boolean(route.goal));
}

/**
 * The screen a detail frame stands over or beside: the nearest screen under it in the stack that is not a frame (the
 * list, the home or the agent window it was opened from, whatever its tab), else the screen the earlier frame fell
 * back to, else the list this route falls back to; a goal
 * chosen in 대화 always its agent's window. Any other route is its own screen.
 */
export function baseOf(route: Route, stack: readonly string[]): Route {
  if (!isFrame(route)) return route;
  // A goal chosen on an agent's card stands beside that agent's window, wherever the address came from.
  if (route.name === "talk") return { name: "talk", id: route.id };
  for (let index = stack.length - 2; index >= 0; index -= 1) {
    const below = parse(stack[index]);
    if (!isFrame(below)) return below;
  }
  // Only frames lie below (the address was opened directly): the screen the earlier frame stood on is this one's too,
  // so a link followed inside the frame does not swap the screen around it.
  const earlier = stack.length >= 2 ? parse(stack[stack.length - 2]) : null;
  if (earlier) return baseOf(earlier, stack.slice(0, -1));
  return defaultListFor(route);
}

/** The list a detail falls back to when it was opened directly (a shared link or a reload). */
export function defaultListFor(route: Route): Route {
  switch (route.name) {
    case "card":
    case "run":
    case "round":
    case "report":
      return { name: "running" };
    case "goal":
      return { name: "goals" };
    case "group":
      if (route.goal) return { name: "goals" };
      return route.agent ? { name: "done", agent: route.agent } : { name: "done" };
    case "item":
      return { name: "inbox" };
    case "setting":
      return { name: "settings" };
    case "talk":
      return { name: "talks" };
    default:
      return { name: "inbox" };
  }
}

export interface NavState {
  readonly stack: readonly string[];
  readonly scroll: Readonly<Record<string, number>>;
}

function currentHash(): string {
  return window.location.hash || href(parse(""));
}

/**
 * A work-only install has no talk / status / agent-ops screens: replace those addresses with the work home so a
 * pasted or bookmarked hash does not stay in the bar after the screen has already opened as home.
 */
function rewriteHiddenHash(): void {
  if (!WORK_ONLY) return;
  const hash = currentHash();
  if (!isHiddenInWork(parse(hash, false).name)) return;
  const home = href({ name: "home" });
  if (hash === home) return;
  const current = readState();
  const stack = current.stack.map((entry) => (isHiddenInWork(parse(entry, false).name) ? home : entry));
  window.history.replaceState({ stack: stack.length ? stack : [home], scroll: current.scroll }, "", home);
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
  const read = () => {
    rewriteHiddenHash();
    return { route: parse(currentHash()), state: readState(), hash: currentHash() };
  };
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
