import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { startLive } from "./data/live";
import { nowSeconds } from "./data/source";
import { useClock, useStore, type Store, type Want } from "./data/store";
import { buildModel, runRow, type Model } from "./model";
import { back, defaultListFor, href, isList, linkClick, navigate, onSaveScroll, onStackMotion, parse, tabOf, tabRoot, TABS, useNav, type Route, type Tab } from "./router";
import { slideMotion } from "./stack-motion";
import { bindSwipeBack, isStandalone } from "./swipe-back";
import { AgentScreen, DoneScreen, DueScreen, GoalsScreen, InboxScreen, RestartSheet, RunningScreen, StatusScreen, TodayScreen } from "./screens/lists";
import { AgentCard, AgentTalk, TalkAgents } from "./screens/talk";
import { CardScreen, GoalScreen, ItemScreen, RunScreen, workerTitle } from "./screens/details";
import { RollbackSheet, SettingPage, settingParent, SettingsScreen, settingTitle } from "./screens/settings";
import { SETTINGS_HISTORY } from "./api/client";
import { BackIcon, BellIcon, CalendarIcon, DeviceIcon, DoneIcon, GearIcon, GoalIcon, InboxIcon, PlusIcon, RunningIcon } from "./ui/icons";
import { AgentMark, CountPair, Ctx, Disclosure, useApp, type AppContext } from "./ui/parts";
import { ActionsCtx, useActions, useActionsFor } from "./ui/actions";
import { SettingsCtx, useSettingsEditsFor } from "./ui/settings-edits";
import { browserPushHost, type OpenRequest, type PushHost } from "./push";
import { PushCtx, PushRow, usePushFor } from "./ui/push-row";
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
      return W.tabWork;
    case "inbox":
    case "running":
    case "due":
    case "done":
    case "goals":
    case "status":
    case "settings":
    case "today":
      return W[route.name];
    case "talks":
      return W.talk;
    case "talk":
      return model.names.get(route.id) ?? W.talk;
    case "setting":
      return settingTitle(route.page);
    case "agent":
      return model.names.get(route.id) ?? W.agents;
    case "goal":
    case "item":
      return store.get("item", route.id)?.title ?? model.items.get(route.id)?.title ?? (route.name === "goal" ? W.goals : W.todo);
    case "card":
      return model.cards.get(route.id)?.name ?? W.cards;
    case "run": {
      const run = model.runs.get(route.id);
      // A card's worker run reads its card's title: the core serves none of its own (lina-app#61, #128).
      const cardId = model.runOwner.get(route.id) ?? store.get("record", route.id)?.cardId;
      return run ? runRow(run).name : cardId ? workerTitle(model, cardId) : W.cards;
    }
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
      // A card's detail and the records of its worker runs (the timeline).
      return [["card", route.id], ...(store.get("card", route.id)?.workerRuns ?? []).map((worker) => ["record", worker.id] as const)];
    case "run": {
      // The card that started the run, named by its record: a run page opened on its own still finds its card.
      const cardId = store.get("record", route.id)?.cardId;
      return cardId ? [["record", route.id], ["card", cardId]] : [["record", route.id]];
    }
    case "settings":
    case "setting": {
      const want: Want = [["settings"], ["settingsModels"], ["settingsHistory", SETTINGS_HISTORY.recent]];
      return route.name === "setting" && route.page === "history" ? [...want, ["settingsHistory", SETTINGS_HISTORY.all]] : want;
    }
    default:
      return [];
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Sidebar />;
    case "today":
      return <TodayScreen />;
    case "talks":
      return <TalkAgents />;
    case "talk":
      return (
        <AgentTalk key={route.id} agent={route.id} titled>
          <AgentCard agent={route.id} folded />
        </AgentTalk>
      );
    case "inbox":
      return <InboxScreen />;
    case "running":
      return <RunningScreen />;
    case "due":
      return <DueScreen />;
    case "done":
      return <DoneScreen agent={route.agent} />;
    case "goals":
      return <GoalsScreen />;
    case "status":
      return <StatusScreen />;
    case "settings":
      return <SettingsScreen />;
    case "setting":
      return <SettingPage page={route.page} />;
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
        <CountPair count={count ?? 0} stopped={stopped} countId="nav-count" stoppedId="nav-stopped" />
        {wide ? null : <Disclosure />}
      </a>
    </li>
  );
}

const TAB_WORD: Record<Tab, string> = { talk: W.tabTalk, work: W.tabWork, status: W.tabStatus };

/** The three tabs at the top. Each opens its own first screen; the tab of the screen shown is the current one. */
export function Tabs({ current }: { current: Tab }) {
  return (
    <nav class="tabs" aria-label={W.tabs} data-testid="tabs">
      {TABS.map((tab) => (
        <a key={tab} href={href(tabRoot(tab))} onClick={linkClick} class={`tab${tab === current ? " is-current" : ""}`} aria-current={tab === current ? "page" : undefined} data-testid={`tab-${tab}`}>
          {TAB_WORD[tab]}
        </a>
      ))}
    </nav>
  );
}

/** `기기 n · 정상 n · 경고 n · 꺼짐 n`, 경고 orange and 꺼짐 red, each only when not 0. */
function DeviceLine({ class: className }: { class: string }) {
  const { model } = useApp();
  const { all, ok, warn, down } = model.counts.devices;
  const devices = W.deviceLine(all, ok, warn, down);
  return (
    <span class={className} data-testid="device-line">
      {devices.all}
      {SEP}
      {devices.ok}
      {warn ? <span class="is-orange">{`${SEP}${devices.warn}`}</span> : null}
      {down ? <span class="is-red">{`${SEP}${devices.down}`}</span> : null}
    </span>
  );
}

/** The sidebar of 상태: the machines line and 설정. */
function StatusRows({ current }: { current?: Route }) {
  const { model } = useApp();
  const is = (name: string) => Boolean(current && current.name === name);
  const { all, ok, warn, down } = model.counts.devices;
  const devices = W.deviceLine(all, ok, warn, down);
  const deviceParts = [devices.all, devices.ok, warn ? devices.warn : "", down ? devices.down : ""].filter(Boolean);
  return (
    <>
      <h2 class="nav-head">{W.status}</h2>
      <ul class="nav-group" aria-label={W.status}>
        <NavRow to={{ name: "status" }} icon={<DeviceIcon />} label={deviceParts.join(SEP)} current={is("status")} testid="nav-status">
          <DeviceLine class="nav-label one-line" />
        </NavRow>
        <NavRow to={{ name: "settings" }} icon={<GearIcon />} label={W.settings} current={is("settings") || is("setting")} testid="nav-settings" />
      </ul>
    </>
  );
}

/** 설정 under the machines and quota on a phone, where 상태 opens straight on them. */
function StatusMore() {
  return (
    <nav class="sidebar-list status-more" aria-label={W.sidebar}>
      <ul class="nav-group">
        <NavRow to={{ name: "settings" }} icon={<GearIcon />} label={W.settings} current={false} testid="nav-settings" />
      </ul>
    </nav>
  );
}

/** The sidebar of 대화: one row per agent. Choosing one opens its window and its card. */
function TalkRows({ current }: { current?: Route }) {
  const { model } = useApp();
  return (
    <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar">
      <h2 class="nav-head">{W.agents}</h2>
      <ul class="nav-group" aria-label={W.agents}>
        {model.agents.map((agent) => (
          <NavRow key={agent.id} to={{ name: "talk", id: agent.id }} icon={<AgentMark id={agent.id} />} label={agent.name} count={model.counts.agents[agent.id]?.running} stopped={model.counts.agents[agent.id]?.stopped} current={Boolean(current && current.name === "talk" && current.id === agent.id)} testid={`nav-talk-${agent.index}`} />
        ))}
      </ul>
      <p class="version" data-testid="version">
        {APP_VERSION}
      </p>
    </nav>
  );
}

export function Sidebar({ current, tab = "work" }: { current?: Route; tab?: Tab }) {
  const { model } = useApp();
  const is = (name: string, id?: string) => Boolean(current && current.name === name && (id === undefined || ("id" in current && current.id === id)));
  if (tab === "talk") return <TalkRows current={current} />;
  if (tab === "status")
    return (
      <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar">
        <StatusRows current={current} />
        <p class="version" data-testid="version">
          {APP_VERSION}
        </p>
      </nav>
    );
  return (
    <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar">
      <ul class="nav-group">
        <NavRow to={{ name: "today" }} icon={<CalendarIcon />} label={W.today} current={is("today")} testid="nav-today" />
      </ul>
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
      <p class="version" data-testid="version">
        {APP_VERSION}
      </p>
    </nav>
  );
}

export function Freshness() {
  const { model, store, now } = useApp();
  let line: { text: string; tone: string };
  if (store.offline || store.denied) line = { text: W.offline, tone: "is-red" };
  else if (store.lastOk === null || store.version === 0) line = { text: W.loading, tone: "" };
  else if (store.live === "open" && !store.boardFailed) line = { text: W.live, tone: "" };
  else if (store.live === "down" || now - store.lastOk > 30) line = { text: W.stale, tone: "" };
  else line = { text: W.fresh(Math.max(0, Math.floor(now - store.lastOk))), tone: "" };
  return (
    <span class="freshness" data-testid="freshness">
      <span class={line.tone} data-testid="freshness-line">
        {line.text}
      </span>
      {!store.offline && model.summariesStopped ? (
        <span class="is-orange" data-testid="summaries-stopped">
          {`${SEP}${W.summariesStopped}`}
        </span>
      ) : null}
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

/** Where a chosen notification opens: a decision in 수신함, a reply on its goal or to-do, a stopped card on its page. */
export function pushHref(model: Model, request: OpenRequest): string {
  if (request.kind === "ask") return href({ name: "inbox" });
  if (request.kind === "reply") return noticeHref(model, request.target);
  if (request.kind === "blocked" || request.kind === "question") return href({ name: "card", id: request.target });
  return request.hash;
}

/**
 * The bell: the badge is the core's unread count, the dialog lists the notices with read ones dimmed. Choosing a
 * notice opens its item and marks it read on the core; 모두 읽음 marks them all. Read marks live on the core only,
 * so every device shows the same number after its next refresh.
 */
export function Bell() {
  const { model } = useApp();
  const actions = useActions();
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
  const marking = model.notices.filter((notice) => !notice.read && actions.isRead(notice.key, false)).length;
  const count = Math.max(0, model.counts.unread - marking);
  return (
    <div class="bell" ref={ref}>
      <button type="button" class="tool" aria-label={count ? `${W.bell} ${count}` : W.bell} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} data-testid="bell">
        <BellIcon />
        {count ? (
          <span class="badge" data-testid="bell-count">
            {count}
          </span>
        ) : null}
      </button>
      {open ? <div class="sheet-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      {open ? (
        <div class="popover" role="dialog" aria-label={W.bell} data-testid="notices">
          <div class="popover-bar">
            <h2 class="popover-title" data-testid="unread-count">
              {W.unread(count)}
            </h2>
            <div class="popover-tools">
              <button type="button" class="text-button" disabled={!count || actions.busy("notices")} onClick={() => void actions.readNotices("all")} data-testid="read-all">
                {W.readAll}
              </button>
              <button type="button" class="text-button is-plain" onClick={() => setOpen(false)} data-testid="close-notices">
                {W.close}
              </button>
            </div>
          </div>
          <ul class="rows" aria-label={W.bell}>
            {model.notices.map((notice) => {
              const read = actions.isRead(notice.key, notice.read);
              return (
                <li key={notice.key} class={`row notice-row${read ? " is-read" : ""}`} data-testid="row" data-read={read ? "true" : "false"}>
                  <a
                    href={noticeHref(model, notice.target)}
                    onClick={(event) => {
                      setOpen(false);
                      if (!read) void actions.readNotices([notice.key]);
                      linkClick(event);
                    }}
                  >
                    <span class={read ? "notice-dot" : "notice-dot is-unread"} aria-hidden="true" />
                    <span class="lines">
                      <span class="title">{notice.line}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {actions.noticesError ? <p class="write-error notice-error" role="alert" data-testid="write-error">{actions.noticesError}</p> : null}
          <PushRow />
        </div>
      ) : null}
    </div>
  );
}

/** The one toast: what was just done and 되돌리기, for five seconds. */
export function Toast() {
  const actions = useActions();
  const toast = actions.toast;
  return (
    <div class="toast-slot" aria-live="polite">
      {toast ? (
        <div class="toast" role="status" data-testid="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.onUndo ? (
            <button type="button" class="toast-undo" onClick={() => actions.undoToast()}>
              {W.undo}
            </button>
          ) : null}
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

/** The last list in the stack that belongs to `tab`: a list of another tab never stands beside this tab's detail. */
function lastListIn(stack: readonly string[], tab: Tab): Route | null {
  for (let index = stack.length - 2; index >= 0; index -= 1) {
    const route = parse(stack[index]);
    if (isList(route) && tabOf(route) === tab) return route;
  }
  return null;
}

/** The first screen of each tab: on a phone it shows the tabs and no back control. */
function isTabRoot(route: Route): boolean {
  return route.name === "home" || route.name === "talks" || route.name === "status";
}

function parentOf(route: Route, stack: readonly string[]): Route {
  if (stack.length > 1) return parse(stack[stack.length - 2]);
  if (isTabRoot(route)) return route;
  if (isList(route)) return tabRoot(tabOf(route));
  if (route.name === "setting") return settingParent(route.page);
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

/** 대화 on a wide window: the agents, the chosen agent's window in the middle and its card on the right. */
function TalkShell({ route }: { route: Route }) {
  const { model, store } = useApp();
  const agent = route.name === "talk" ? route.id : null;
  return (
    <div class="split is-talk" data-layout="wide" data-tab="talk">
      <aside class="sidebar">
        <Sidebar tab="talk" current={route} />
      </aside>
      <div class="content">
        <header class="toolbar">
          <div class="toolbar-title">
            <h1 class="toolbar-name" data-testid="screen-title">
              {titleOf(route, model, store)}
            </h1>
            <Freshness />
          </div>
          <Tabs current="talk" />
          <div class="toolbar-tools">
            <Bell />
          </div>
        </header>
        <div class="talk-panes" data-testid="panes">
          <section class="pane talk-pane" aria-label={titleOf(route, model, store)}>
            {agent ? <AgentTalk key={agent} agent={agent} /> : <p class="empty" data-testid="pick-agent">{W.pickAgent}</p>}
          </section>
          {agent ? (
            <aside class="pane card-pane" aria-label={W.agentCard} data-testid="card-pane">
              <AgentCard agent={agent} />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WideShell({ route, stack, scroll }: { route: Route; stack: readonly string[]; scroll: Readonly<Record<string, number>> }) {
  const { model, store } = useApp();
  const tab = tabOf(route);
  const listRoute: Route = route.name === "home" ? { name: "running" } : isList(route) ? route : (lastListIn(stack, tabOf(route)) ?? defaultListFor(route));
  const detailRoute = isList(route) || route.name === "home" ? null : route;
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  useScrollKeeping({ list: listRef, detail: detailRef }, { list: href(listRoute), detail: detailRoute ? href(detailRoute) : "", main: "" }, scroll);
  return (
    <div class="split" data-layout="wide">
      <aside class="sidebar">
        <Sidebar tab={tab} current={listRoute} />
      </aside>
      <div class="content">
        <header class="toolbar">
          <div class="toolbar-title">
            <h1 class="toolbar-name" data-testid="screen-title">
              {titleOf(listRoute, model, store)}
            </h1>
            <Freshness />
          </div>
          <Tabs current={tab} />
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

function PhoneShell({ route, stack, scroll }: { route: Route; stack: readonly string[]; scroll: Readonly<Record<string, number>> }) {
  const { model, store } = useApp();
  const mainRef = useRef<HTMLElement>(null);
  // The scroll comes from the history entry the router read for this screen, not from whatever entry is current
  // when the swap finally renders.
  useScrollKeeping({ main: mainRef }, { list: "", detail: "", main: href(route) }, scroll);
  const parent = parentOf(route, stack);
  const isRoot = isTabRoot(route);
  const large = isRoot || isList(route);
  const goBack = () => {
    if (stack.length > 1) back();
    else navigate(parent, { replace: true, direction: "pop" });
  };
  const current = useRef({ isRoot, goBack });
  current.current = { isRoot, goBack };
  useLayoutEffect(() => {
    onStackMotion(slideMotion());
    const unbind = bindSwipeBack({ standalone: () => isStandalone(), atRoot: () => current.current.isRoot, onBack: () => current.current.goBack() });
    return () => {
      onStackMotion(null);
      unbind();
    };
  }, []);
  return (
    <div class="stack" data-layout="phone">
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
      <main class="phone-main" ref={mainRef}>
        {large ? (
          <h1 class="large-title" data-testid="screen-title">
            {isRoot ? TAB_WORD[tabOf(route)] : titleOf(route, model, store)}
          </h1>
        ) : null}
        {isRoot ? <Tabs current={tabOf(route)} /> : null}
        {route.name === "status" ? (
          <p class="status-sum">
            <DeviceLine class="one-line" />
          </p>
        ) : null}
        <Screen route={route} />
        {route.name === "status" ? <StatusMore /> : null}
      </main>
      <footer class="bottombar">
        <span />
        <Freshness />
        <QuickAdd />
      </footer>
    </div>
  );
}

export function App({ store, pushHost }: { store: Store; pushHost?: PushHost }) {
  const host = useMemo(() => pushHost ?? browserPushHost(), []);
  const version = useStore(store);
  const tick = useClock();
  const now = Math.max(tick, nowSeconds());
  const wide = useWide();
  const nav = useNav();
  const minute = Math.floor(now / 60);
  const actions = useActionsFor(store, (match) => host.close(match));
  const settingsEdits = useSettingsEditsFor(store, actions);
  const model = useMemo(() => buildModel({ ...store.input(), pending: actions.pending() }, now), [version, minute, actions.version]);
  const latest = useRef(model);
  latest.current = model;
  const push = usePushFor(store.source, host, (request) => {
    navigate(pushHref(latest.current, request));
    // A reply's tag is the key the core read-marks, which closes that notification on every device. Opening a
    // decision, a stopped card or a question sends nothing: those close when the owner answers or retries.
    if (request.kind === "reply" && request.tag) void actions.readNotices([request.tag]);
  });

  useEffect(() => {
    // A new window opened from a notification carries the tag in `?open=`, because the worker may have restarted
    // before this page loaded. Read it once and drop it, so a reload does not mark the reply again.
    const url = new URL(window.location.href);
    const tag = url.searchParams.get("open");
    if (tag === null) return;
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (tag.startsWith("reply:")) void actions.readNotices([tag]);
  }, [actions]);

  useEffect(() => startLive(store), [store]);
  useEffect(() => store.want(wantsFor(nav.route, store)), [nav.hash, version]);
  useEffect(() => {
    if (nav.route.name !== "settings" && nav.route.name !== "setting") settingsEdits.editRules(false);
  }, [nav.route.name]);

  const context: AppContext = { model, store, now, wide, selected: isList(nav.route) ? null : nav.hash };
  return (
    <Ctx.Provider value={context}>
      <ActionsCtx.Provider value={actions}>
        <PushCtx.Provider value={push}>
          <SettingsCtx.Provider value={settingsEdits}>
            {wide && tabOf(nav.route) === "talk" ? <TalkShell route={nav.route} /> : wide ? <WideShell route={nav.route} stack={nav.state.stack} scroll={nav.state.scroll} /> : <PhoneShell route={nav.route} stack={nav.state.stack} scroll={nav.state.scroll} />}
            <Toast />
            <RollbackSheet />
            <RestartSheet />
          </SettingsCtx.Provider>
        </PushCtx.Provider>
      </ActionsCtx.Provider>
    </Ctx.Provider>
  );
}
