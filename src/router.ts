import { useEffect, useState } from "preact/hooks";

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

const listeners = new Set<() => void>();

export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
  const hash = typeof to === "string" ? to : href(to);
  const current = readState();
  window.history.replaceState({ ...current, scroll: readScroll() }, "");
  if (hash === currentHash() && !options.replace) return;
  const stack = options.replace ? [...current.stack.slice(0, -1), hash] : [...current.stack, hash];
  const next: NavState = { stack, scroll: {} };
  if (options.replace) window.history.replaceState(next, "", hash);
  else window.history.pushState(next, "", hash);
  for (const listener of listeners) listener();
}

export function back(): void {
  window.history.back();
}

export function useNav(): { route: Route; state: NavState; hash: string } {
  const read = () => ({ route: parse(currentHash()), state: readState(), hash: currentHash() });
  const [nav, setNav] = useState(read);
  useEffect(() => {
    const update = () => setNav(read());
    listeners.add(update);
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
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
