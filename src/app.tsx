import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { startRefresh } from "./data/refresh";
import { nowSeconds } from "./data/source";
import { useClock, useStore, type Store, type Want } from "./data/store";
import { buildModel, type Model } from "./model";
import { back, defaultListFor, href, isList, linkClick, navigate, onSaveScroll, parse, useNav, type Route } from "./router";
import { AgentScreen, DoneScreen, DueScreen, GoalsScreen, InboxScreen, RunningScreen, StatusScreen } from "./screens/lists";
import { CardScreen, GoalScreen, ItemScreen, RunScreen } from "./screens/details";
import { BackIcon, BellIcon, CalendarIcon, DeviceIcon, DoneIcon, GoalIcon, InboxIcon, PlusIcon, RunningIcon } from "./ui/icons";
import { AgentMark, Ctx, Disclosure, useApp, type AppContext } from "./ui/parts";
import { APP_VERSION } from "./version";
import { SEP, W } from "./words";

export const WIDE_QUERY = "(min-width: 900px)";

function useWide(): boolean {
  const query = () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY).matches : window.innerWidth >= 900);
  const [wide, setWide] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

export function titleOf(route: Route, model: Model, store: Store): string {
  switch (route.name) {
    case "home":
      return W.app;
    case "inbox":
    case "running":
    case "due":
    case "done":
    case "goals":
    case "status":
      return W[route.name];
    case "agent":
      return model.names.get(route.id) ?? W.agents;
    case "goal":
    case "item":
      return store.get("item", route.id)?.title ?? model.items.get(route.id)?.title ?? (route.name === "goal" ? W.goals : W.todo);
    case "card":
      return model.cards.get(route.id)?.title ?? store.get("card", route.id)?.title ?? W.cards;
    case "run":
      return model.runs.get(route.id)?.title ?? W.cards;
  }
}

function wantsFor(route: Route, store: Store): Want {
  switch (route.name) {
    case "goal":
    case "item": {
      const detail = store.get("item", route.id);
      const goalCards = new Set((store.get("goals")?.goals ?? []).map((goal) => goal.id));
      return [["item", route.id], ...(detail?.workCards ?? []).filter((id) => goalCards.has(id)).map((id) => ["goal", id] as const)];
    }
    case "card":
      return [["card", route.id]];
    default:
      return [];
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Sidebar />;
    case "inbox":
      return <InboxScreen />;
    case "running":
      return <RunningScreen />;
    case "due":
      return <DueScreen />;
    case "done":
      return <DoneScreen />;
    case "goals":
      return <GoalsScreen />;
    case "status":
      return <StatusScreen />;
    case "agent":
      return <AgentScreen id={route.id} />;
    case "goal":
      return <GoalScreen id={route.id} />;
    case "item":
      return <ItemScreen id={route.id} />;
    case "card":
      return <CardScreen id={route.id} />;
    case "run":
      return <RunScreen id={route.id} />;
  }
}

function NavRow({ to, icon, label, count, stopped, current, testid, children }: { to: Route; icon?: ComponentChildren; label: string; count?: number; stopped?: number; current: boolean; testid: string; children?: ComponentChildren }) {
  const { wide } = useApp();
  const target = href(to);
  return (
    <li class={`nav-row${current ? " is-current" : ""}`} data-testid={testid}>
      <a href={target} onClick={linkClick} aria-current={current ? "page" : undefined} aria-label={[count ? `${label} ${count}` : label, stopped ? W.stoppedCount(stopped) : ""].filter(Boolean).join(SEP)}>
        {icon ? <span class="nav-icon">{icon}</span> : null}
        {children ?? <span class="nav-label one-line">{label}</span>}
        {count ? (
          <span class="nav-count" data-testid="nav-count">
            {count}
          </span>
        ) : null}
        {stopped ? (
          <span class="nav-count is-stopped-count" data-testid="nav-stopped">
            {stopped}
          </span>
        ) : null}
        {wide ? null : <Disclosure />}
      </a>
    </li>
  );
}

export function Sidebar({ current }: { current?: Route }) {
  const { model } = useApp();
  const is = (name: string, id?: string) => Boolean(current && current.name === name && (id === undefined || ("id" in current && current.id === id)));
  const { all, ok, warn, down } = model.counts.devices;
  const devices = W.deviceLine(all, ok, warn, down);
  const deviceParts = [devices.all, devices.ok, warn ? devices.warn : "", down ? devices.down : ""].filter(Boolean);
  return (
    <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar">
      <ul class="nav-group">
        <NavRow to={{ name: "inbox" }} icon={<InboxIcon />} label={W.inbox} count={model.counts.inbox} current={is("inbox")} testid="nav-inbox" />
        <NavRow to={{ name: "running" }} icon={<RunningIcon />} label={W.running} count={model.counts.running} stopped={model.counts.stopped} current={is("running")} testid="nav-running" />
        <NavRow to={{ name: "due" }} icon={<CalendarIcon />} label={W.due} count={model.counts.due} current={is("due")} testid="nav-due" />
        <NavRow to={{ name: "done" }} icon={<DoneIcon />} label={W.done} count={model.counts.done} current={is("done")} testid="nav-done" />
      </ul>
      {model.agents.length ? (
        <>
          <h2 class="nav-head">{W.agents}</h2>
          <ul class="nav-group" aria-label={W.agents}>
            {model.agents.map((agent) => (
              <NavRow key={agent.id} to={{ name: "agent", id: agent.id }} icon={<AgentMark id={agent.id} />} label={agent.name} count={model.counts.agents[agent.id]?.running} stopped={model.counts.agents[agent.id]?.stopped} current={is("agent", agent.id)} testid={`nav-agent-${agent.index}`} />
            ))}
          </ul>
        </>
      ) : null}
      <ul class="nav-group">
        <NavRow to={{ name: "goals" }} icon={<GoalIcon />} label={W.goals} count={model.counts.goals} current={is("goals")} testid="nav-goals" />
      </ul>
      <h2 class="nav-head">{W.status}</h2>
      <ul class="nav-group" aria-label={W.status}>
        <NavRow to={{ name: "status" }} icon={<DeviceIcon />} label={deviceParts.join(SEP)} current={is("status")} testid="nav-status">
          <span class="nav-label one-line" data-testid="device-line">
            {devices.all}
            {SEP}
            {devices.ok}
            {warn ? <span class="is-orange">{`${SEP}${devices.warn}`}</span> : null}
            {down ? <span class="is-red">{`${SEP}${devices.down}`}</span> : null}
          </span>
        </NavRow>
      </ul>
      <p class="version" data-testid="version">
        {APP_VERSION}
      </p>
    </nav>
  );
}

export function Freshness() {
  const { model, store, now } = useApp();
  let line: { text: string; tone: string };
  if (store.offline) line = { text: W.offline, tone: "is-red" };
  else if (store.lastOk === null) line = { text: W.loading, tone: "" };
  else if (now - store.lastOk > 30) line = { text: W.stale, tone: "" };
  else line = { text: W.fresh(Math.max(0, Math.floor(now - store.lastOk))), tone: "" };
  return (
    <span class="freshness" data-testid="freshness">
      <span class={line.tone} data-testid="freshness-line">
        {line.text}
      </span>
      {!store.offline && model.errors.length ? (
        <span class="is-orange" data-testid="read-failed">
          {`${SEP}${W.readFailed(model.errors.join(", "))}`}
        </span>
      ) : null}
    </span>
  );
}

function noticeHref(model: Model, target: string): string {
  if (model.cards.has(target)) return href({ name: "card", id: target });
  if (model.runs.has(target)) return href({ name: "run", id: target });
  const item = model.items.get(target);
  return href({ name: item?.kind === "goal" ? "goal" : "item", id: target });
}

export function Bell() {
  const { model } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const count = model.counts.notices;
  return (
    <div class="bell" ref={ref}>
      <button type="button" class="tool" aria-label={count ? `${W.bell} ${count}` : W.bell} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} data-testid="bell">
        <BellIcon />
        {count ? (
          <span class="badge" data-testid="bell-count">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div class="popover" data-testid="notices">
          <ul class="rows" aria-label={W.bell}>
            {model.notices.map((notice) => (
              <li key={notice.key} class="row notice-row" data-testid="row">
                <a href={noticeHref(model, notice.target)} onClick={(event) => {
                  setOpen(false);
                  linkClick(event);
                }}>
                  <span class="lines">
                    <span class="title">{notice.line}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function QuickAdd() {
  return (
    <button type="button" class="tool" aria-label={W.quickAdd} disabled data-testid="quick-add">
      <PlusIcon />
    </button>
  );
}

function lastListIn(stack: readonly string[]): Route | null {
  for (let index = stack.length - 2; index >= 0; index -= 1) {
    const route = parse(stack[index]);
    if (isList(route)) return route;
  }
  return null;
}

function parentOf(route: Route, stack: readonly string[]): Route {
  if (stack.length > 1) return parse(stack[stack.length - 2]);
  if (route.name === "home") return route;
  if (isList(route)) return { name: "home" };
  return defaultListFor(route);
}

type Pane = RefObject<HTMLElement | null>;
type Panes = { list?: Pane; detail?: Pane; main?: Pane };

/** Keeps each pane's scroll: saved into the history entry on navigation, restored on back and forward. */
function useScrollKeeping(panes: Panes, keys: Record<keyof Panes, string>, saved: Readonly<Record<string, number>>) {
  const previous = useRef<Record<string, string>>({});
  onSaveScroll(() => {
    const scroll: Record<string, number> = {};
    for (const name of ["list", "detail", "main"] as const) {
      const pane = panes[name]?.current;
      if (pane) scroll[name] = pane.scrollTop;
    }
    return scroll;
  });
  useLayoutEffect(() => {
    for (const name of ["list", "detail", "main"] as const) {
      const pane = panes[name]?.current;
      if (!pane) continue;
      if (saved[name] !== undefined) pane.scrollTop = saved[name];
      else if (previous.current[name] !== keys[name]) pane.scrollTop = 0;
    }
    previous.current = { ...keys };
  }, [keys.list, keys.detail, keys.main]);
}

function WideShell({ route, stack }: { route: Route; stack: readonly string[] }) {
  const { model, store } = useApp();
  const listRoute: Route = route.name === "home" ? { name: "inbox" } : isList(route) ? route : (lastListIn(stack) ?? defaultListFor(route));
  const detailRoute = isList(route) || route.name === "home" ? null : route;
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const saved = (window.history.state?.scroll ?? {}) as Record<string, number>;
  useScrollKeeping({ list: listRef, detail: detailRef }, { list: href(listRoute), detail: detailRoute ? href(detailRoute) : "", main: "" }, saved);
  return (
    <div class="split" data-layout="wide">
      <aside class="sidebar">
        <Sidebar current={listRoute} />
      </aside>
      <div class="content">
        <header class="toolbar">
          <div class="toolbar-title">
            <h1 class="toolbar-name" data-testid="screen-title">
              {titleOf(listRoute, model, store)}
            </h1>
            <Freshness />
          </div>
          <div class="toolbar-tools">
            <Bell />
            <QuickAdd />
          </div>
        </header>
        <div class={detailRoute ? "panes" : "panes is-folded"} data-testid="panes">
          <section class="pane list-pane" ref={listRef} aria-label={titleOf(listRoute, model, store)}>
            <Screen route={listRoute} />
          </section>
          {detailRoute ? (
            <section class="pane detail-pane" ref={detailRef} aria-label={titleOf(detailRoute, model, store)} data-testid="detail-pane">
              <Screen route={detailRoute} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PhoneShell({ route, stack }: { route: Route; stack: readonly string[] }) {
  const { model, store } = useApp();
  const mainRef = useRef<HTMLDivElement>(null);
  const saved = (window.history.state?.scroll ?? {}) as Record<string, number>;
  useScrollKeeping({ main: mainRef }, { list: "", detail: "", main: href(route) }, saved);
  const parent = parentOf(route, stack);
  const isRoot = route.name === "home";
  const large = isRoot || isList(route);
  const goBack = () => {
    if (stack.length > 1) back();
    else navigate(parent, { replace: true });
  };
  return (
    <div class="stack" data-layout="phone" ref={mainRef}>
      <header class="navbar">
        {isRoot ? (
          <span />
        ) : (
          <button type="button" class="back" onClick={goBack} data-testid="back">
            <BackIcon />
            <span class="one-line">{titleOf(parent, model, store)}</span>
          </button>
        )}
        <div class="toolbar-tools">
          <Bell />
        </div>
      </header>
      <main class="phone-main">
        {large ? (
          <h1 class="large-title" data-testid="screen-title">
            {titleOf(route, model, store)}
          </h1>
        ) : null}
        <Screen route={route} />
      </main>
      <footer class="bottombar">
        <span />
        <Freshness />
        <QuickAdd />
      </footer>
    </div>
  );
}

export function App({ store }: { store: Store }) {
  const version = useStore(store);
  const tick = useClock();
  const now = Math.max(tick, nowSeconds());
  const wide = useWide();
  const nav = useNav();
  const minute = Math.floor(now / 60);
  const model = useMemo(() => buildModel(store.input(), now), [version, minute]);

  useEffect(() => startRefresh(() => void store.refresh()), [store]);
  useEffect(() => store.want(wantsFor(nav.route, store)), [nav.hash, version]);

  const context: AppContext = { model, store, now, wide, selected: isList(nav.route) ? null : nav.hash };
  return (
    <Ctx.Provider value={context}>
      {wide ? <WideShell route={nav.route} stack={nav.state.stack} /> : <PhoneShell route={nav.route} stack={nav.state.stack} />}
    </Ctx.Provider>
  );
}
