import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppLabel } from "./data/http-source";
import { LIVE_SETTLE_MS, startLive } from "./data/live";
import { nowSeconds } from "./data/source";
import { newestRun, SLOW_ROUTES, useClock, useStore, type Store, type Want } from "./data/store";
import { buildModel, runRow, type Model } from "./model";
import { back, baseOf, defaultListFor, href, isFrame, isList, linkClick, navigate, onSaveScroll, onStackMotion, parse, tabOf, tabRoot, TABS, useNav, type Route, type Tab } from "./router";
import { slideMotion } from "./stack-motion";
import { bindSwipeBack, isStandalone } from "./swipe-back";
import { AgentScreen, DoneScreen, DueScreen, GoalsScreen, InboxScreen, RestartSheet, RunningScreen, StatusScreen, TodayScreen } from "./screens/lists";
import { AgentCard, AgentTalk, TalkAgents, TalkHead, TalkNameLine, TalkPreview, talkRowName } from "./screens/talk";
import { CardScreen, GoalScreen, ItemScreen, RunScreen, workerTitle } from "./screens/details";
import { RollbackSheet, SettingPage, settingParent, SettingsScreen, settingTitle } from "./screens/settings";
import { SETTINGS_HISTORY } from "./api/client";
import { BackIcon, BellIcon, CalendarIcon, DeviceIcon, DoneIcon, GearIcon, GoalIcon, InboxIcon, MenuIcon, RunningIcon } from "./ui/icons";
import { AgentMark, CountPair, Ctx, Disclosure, useApp, type AppContext } from "./ui/parts";
import { ActionsCtx, useActions, useActionsFor } from "./ui/actions";
import { SettingsCtx, useSettingsEditsFor } from "./ui/settings-edits";
import { browserPushHost, type OpenRequest, type PushHost } from "./push";
import { PushCtx, PushRow, usePushFor } from "./ui/push-row";
import { APP_VERSION } from "./version";
import { SEP, STATE_WORD, W } from "./words";

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
    case "running":
      // The work list has one name, the tab's, on every header and back (lina-app#148).
      return W.tabWork;
    case "inbox":
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
      if (route.goal) return titleOf({ name: "goal", id: route.goal }, model, store);
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
    case "talk":
      return route.goal ? wantsFor({ name: "goal", id: route.goal }, store) : [];
    case "goal":
    case "item": {
      const detail = store.get("item", route.id);
      const goalCards = new Set((store.get("goals")?.goals ?? []).map((goal) => goal.id));
      return [["item", route.id], ...(detail?.workCards ?? []).filter((id) => goalCards.has(id)).map((id) => ["goal", id] as const)];
    }
    case "card": {
      // A card's detail and the records of its worker runs (the timeline). The record of the run seen last comes first
      // and alone: on a long card each run may serve the card's whole record again, 110 reads of 300 kB that the history
      // waited for on a phone (lina-app#232). The others are asked once it is in.
      const workers = store.get("card", route.id)?.workerRuns ?? [];
      const newest = newestRun(workers);
      const records = newest !== null && store.status("record", newest) === "pending" ? [newest] : workers.map((worker) => worker.id);
      return [["card", route.id], ...records.map((id) => ["record", id] as const)];
    }
    case "run": {
      // The card that started the run, named by its record: a run page opened on its own still finds its card.
      const cardId = store.get("record", route.id)?.cardId;
      return cardId ? [["record", route.id], ["card", cardId]] : [["record", route.id]];
    }
    case "status":
      // Its machines, quota, usage, OCX's state and checks are drawn on its first screen, so they come with the lists.
      return SLOW_ROUTES.filter(([name]) => name !== "settingsModels");
    case "settings":
    case "setting": {
      const want: Want = [["settings"], ["settingsModels"], ["settingsHistory", SETTINGS_HISTORY.recent]];
      return route.name === "setting" && route.page === "history" ? [...want, ["settingsHistory", SETTINGS_HISTORY.all]] : want;
    }
    default:
      return [];
  }
}

/**
 * Screens that list or count every finished card (완료, 오늘, an agent and its 대화 card, a goal's or to-do's cards, the
 * goals whose lines fold their cards (lina-app#237), a finished card's fold) read them all; the work tab reads the newest
 * few (lina-app#186). A card the list does not hold may be a finished one not read yet.
 */
function readsEveryFinished(route: Route, store: Store): boolean {
  switch (route.name) {
    case "goals":
    case "done":
    case "today":
    case "agent":
    case "talk":
    case "goal":
    case "item":
      return true;
    case "card": {
      if (store.status("cards") === "pending") return false;
      const card = store.get("cards")?.cards.find((each) => each.id === route.id);
      return card === undefined || card.state === "done";
    }
    case "run": {
      // A run's page names its card and links to it: an older finished card the page does not hold is read first.
      const cardId = store.get("record", route.id)?.cardId;
      if (cardId === undefined || store.status("cards") === "pending") return false;
      return !store.get("cards")?.cards.some((each) => each.id === cardId);
    }
    default:
      return false;
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <RunningScreen />;
    case "today":
      return <TodayScreen />;
    case "talks":
      return <TalkAgents />;
    case "talk":
      if (route.goal) return <GoalScreen id={route.goal} />;
      return (
        <AgentTalk key={route.id} agent={route.id}>
          {/* Pinned under the bar while the conversation scrolls, so the strip is never out of reach (lina-app#206). */}
          <div class="talk-strip">
            <AgentCard agent={route.id} folded />
          </div>
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

/**
 * One sidebar row. `stoppedMark` draws the stopped cards as their own words (`중단됨 13`) under the label, and the
 * number at the right edge counts running work only, so a lone red number never reads as running work (lina-app#156);
 * without it they are the small red number. A row whose own lines carry its counts (an agent's in 대화, TalkNameLine,
 * lina-app#219) passes none and gives its `name`.
 */
function NavRow({ to, icon, label, name, count, stopped, stoppedMark = false, current, testid, children }: { to: Route; icon?: ComponentChildren; label: string; name?: string; count?: number; stopped?: number; stoppedMark?: boolean; current: boolean; testid: string; children?: ComponentChildren }) {
  const { wide } = useApp();
  const target = href(to);
  return (
    <li class={`nav-row${current ? " is-current" : ""}`} data-testid={testid}>
      <a href={target} onClick={linkClick} aria-current={current ? "page" : undefined} aria-label={name ?? [count ? `${label} ${count}` : label, stopped ? W.stoppedCount(stopped) : ""].filter(Boolean).join(SEP)}>
        {icon ? <span class="nav-icon">{icon}</span> : null}
        {stoppedMark && stopped ? (
          <span class="lines nav-lines">
            <span class="nav-label one-line">{label}</span>
            <span class="nav-stopped-mark" data-testid="nav-stopped-mark">
              {`${STATE_WORD.stopped} `}
              <span data-testid="nav-stopped">{stopped}</span>
            </span>
          </span>
        ) : (
          (children ?? <span class="nav-label one-line">{label}</span>)
        )}
        <CountPair count={count ?? 0} stopped={stoppedMark ? 0 : stopped} countId="nav-count" stoppedId="nav-stopped" />
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

/** The sidebar of 상태: the machines line and 설정. The pressed tab is the screen's one name, so no head repeats it (lina-app#206). */
function StatusRows({ current }: { current?: Route }) {
  const { model } = useApp();
  const is = (name: string) => Boolean(current && current.name === name);
  const { all, ok, warn, down } = model.counts.devices;
  const devices = W.deviceLine(all, ok, warn, down);
  const deviceParts = [devices.all, devices.ok, warn ? devices.warn : "", down ? devices.down : ""].filter(Boolean);
  return (
    <ul class="nav-group" aria-label={W.status}>
      <NavRow to={{ name: "status" }} icon={<DeviceIcon />} label={deviceParts.join(SEP)} current={is("status")} testid="nav-status">
        <DeviceLine class="nav-label one-line" />
      </NavRow>
      <NavRow to={{ name: "settings" }} icon={<GearIcon />} label={W.settings} current={is("settings") || is("setting")} testid="nav-settings" />
    </ul>
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
    <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar" data-version={APP_VERSION}>
      <h2 class="nav-head">{W.agents}</h2>
      <ul class="nav-group" aria-label={W.agents}>
        {model.agents.map((agent) => {
          const { running = 0, stopped = 0 } = model.counts.agents[agent.id] ?? {};
          return (
            <NavRow key={agent.id} to={{ name: "talk", id: agent.id }} icon={<AgentMark id={agent.id} />} label={agent.name} name={talkRowName(agent.name, running, stopped)} current={Boolean(current && current.name === "talk" && current.id === agent.id)} testid={`nav-talk-${agent.index}`}>
              <span class="lines nav-lines">
                <TalkNameLine name={agent.name} nameClass="nav-label" running={running} stopped={stopped} />
                <TalkPreview agent={agent.id} />
              </span>
            </NavRow>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar({ current, tab = "work", settings = false }: { current?: Route; tab?: Tab; settings?: boolean }) {
  const { model } = useApp();
  const is = (name: string, id?: string) => Boolean(current && current.name === name && (id === undefined || ("id" in current && current.id === id)));
  if (tab === "talk") return <TalkRows current={current} />;
  if (tab === "status")
    return (
      <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar" data-version={APP_VERSION}>
        <StatusRows current={current} />
      </nav>
    );
  return (
    <nav class="sidebar-list" aria-label={W.sidebar} data-testid="sidebar" data-version={APP_VERSION}>
      <ul class="nav-group">
        <NavRow to={{ name: "today" }} icon={<CalendarIcon />} label={W.today} current={is("today")} testid="nav-today" />
      </ul>
      <ul class="nav-group">
        <NavRow to={{ name: "inbox" }} icon={<InboxIcon />} label={W.inbox} count={model.counts.inbox} current={is("inbox")} testid="nav-inbox" />
        <NavRow to={{ name: "running" }} icon={<RunningIcon />} label={W.running} count={model.counts.running} stopped={model.counts.stopped} stoppedMark current={is("running")} testid="nav-running" />
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
      {settings ? (
        <ul class="nav-group">
          <NavRow to={{ name: "settings" }} icon={<GearIcon />} label={W.settings} current={is("settings")} testid="nav-settings" />
        </ul>
      ) : null}
    </nav>
  );
}

/** How old the screens may be before the line says 갱신 지연. */
const STALE_AFTER_S = 30;

/**
 * The last moment each store's screens were known current. It belongs to the store, not to one drawn head: 작업 and
 * 대화 are two shells on a wide window, and a head drawn anew by a route change must not forget it (lina-app#176).
 */
const vouchedAt = new WeakMap<Store, number>();

export function Freshness() {
  const { model, store, now, wide } = useApp();
  // While the stream is open nothing is read until something changes, so the last read can be minutes old while the
  // screens are current. The last moment the stream vouched for them is when they were last known current
  // (lina-app#152): one failed read counts from there, not from the last change.
  // A kept copy is not current until the stream has caught up from its cursor (lina-app#194).
  const current = store.live === "open" && !store.catchingUp && !store.boardFailed && store.lastOk !== null && store.version > 0;
  if (current) vouchedAt.set(store, now);
  const since = Math.max(store.lastOk ?? 0, store.live === "open" ? (vouchedAt.get(store) ?? 0) : 0);
  let line: { text: string; tone: string };
  // A list whose reads all failed is not loading: the failure alone speaks, with the way to read again (lina-app#199).
  const unread = store.version > 0 && store.unread();
  if (store.offline || store.denied) line = { text: W.offline, tone: "is-red" };
  else if (unread) line = { text: "", tone: "" };
  else if (store.lastOk === null || store.version === 0) line = { text: W.loading, tone: "" };
  // A stream that was never open has nothing late yet: its first connection is still being made (lina-app#172).
  // A kept copy on screen says how old it is instead: it may be old, not merely waiting.
  // On a phone the word is a band over the screen's last rows: a first connection that opens within the settle time of
  // the first lists raises none (lina-app#199); one that takes longer reads 연결 중 from then on.
  else if (store.live === "connecting" && !store.catchingUp) line = { text: !wide && now - store.lastOk < LIVE_SETTLE_MS / 1000 ? "" : W.connecting, tone: "" };
  // A current screen needs no word: the head speaks only when something is wrong (lina-app#187).
  else if (current) line = { text: "", tone: "" };
  else if (store.live === "down" || now - since > STALE_AFTER_S) line = { text: W.stale, tone: "" };
  else line = { text: W.fresh(Math.max(0, Math.floor(now - since))), tone: "" };
  const failed = !store.offline && model.errors.length > 0;
  // With 다시 시도 the sources' words alone give way at a narrow width; the button is never cut off (lina-app#199).
  const again = failed && (unread || store.ensuredFailed());
  // Nothing to say: the phone's strip that holds this line draws nothing and takes no height (lina-app#187).
  return (
    <span class="freshness" data-testid="freshness" data-quiet={line.text || failed ? undefined : ""} style={again ? { display: "flex", alignItems: "baseline", justifyContent: wide ? "flex-start" : "center", minWidth: 0 } : undefined}>
      <span class={line.tone} data-testid="freshness-line">
        {line.text}
      </span>
      {failed ? (
        <span class="is-orange" data-testid="read-failed" style={again ? { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } : undefined}>
          {`${line.text ? SEP : ""}${W.readFailed(model.errors.join(", "))}`}
        </span>
      ) : null}
      {again ? (
        <button type="button" class="text-button" style={{ flex: "none" }} onClick={() => void store.readFailed()} data-testid="read-again">
          {W.retry}
        </button>
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

/** Which install the app is open on, in the operator's words; `test` has its own tint. No label, no element. */
export function InstallLabel() {
  const { label } = useApp();
  if (!label) return null;
  return (
    <span class={label.kind === "test" ? "install-label is-test" : "install-label"} data-kind={label.kind ?? undefined} data-testid="install-label">
      {label.text}
    </span>
  );
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

/**
 * 작업's menu on a phone (오늘, the lists, the agents, 목표): the first screen is the lines, and the menu opens from the
 * header as a sheet; choosing a row goes there and closes it (lina-app#124). The 대화 list has the same entry (lina-app#167),
 * and so has 상태, whose sheet ends with 설정 (lina-app#172). It is an icon, as in a chat app's list head (lina-app#193).
 */
function MenuButton({ tab }: { tab: Tab }) {
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
  return (
    <div class="menu" ref={ref}>
      <button type="button" class="tool menu-button" aria-label={W.sidebar} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} data-testid="menu">
        <MenuIcon />
      </button>
      {open ? <div class="sheet-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      {open ? (
        <div
          class="popover menu-sheet"
          role="dialog"
          aria-label={W.sidebar}
          data-testid="menu-sheet"
          onClick={(event) => {
            if ((event.target as Element).closest("a")) setOpen(false);
          }}
        >
          <Sidebar settings={tab === "status"} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The wide toolbar's title. A screen named like the pressed tab beside it (대화, 작업, 상태) is named by that tab: its
 * heading is for a screen reader only, so the toolbar never reads the tab's name twice (lina-app#193).
 */
function ToolbarName({ title, tab }: { title: string; tab: Tab }) {
  return (
    <h1 class={title === TAB_WORD[tab] ? "visually-hidden" : "toolbar-name"} data-testid="screen-title">
      {title}
    </h1>
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
  if (route.name === "talk" && route.goal) return { name: "talk", id: route.id };
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

/**
 * The one detail frame on a wide window (lina-app#142): a goal, a to-do, a work card or a run, in the right-hand pane
 * that scrolls on its own beside the list, so it opens where the owner is looking whatever the list's scroll.
 */
function PanelFrame({ route }: { route: Route }) {
  return (
    <div class="detail-frame" data-testid="detail-frame" data-frame="panel">
      {/* One record's screen at a time: a draft, a fold or an answer typed for one never shows on the next. */}
      <Screen key={href(route)} route={route} />
    </div>
  );
}

/**
 * 대화 on a wide window: the agents, the chosen agent's window in the middle and its card on the right. A goal chosen
 * on the card (`#/talk/<agent>?goal=<id>`, lina-app#143), or any detail opened from the card, opens in the one detail
 * frame in that right column, under a back control to the card; the window stays open.
 */
function TalkShell({ route, frame, stack }: { route: Route; frame: Route | null; stack: readonly string[] }) {
  const { model, store } = useApp();
  const agent = route.name === "talk" ? route.id : null;
  const windowRoute: Route = agent ? { name: "talk", id: agent } : route;
  // Back from the frame stands on the agent's card, or on the bare 대화 list when no agent is chosen.
  const toCard = () => {
    const card = href(agent ? { name: "talk", id: agent } : { name: "talks" });
    if (stack.length > 1 && stack[stack.length - 2] === card) back();
    else navigate(card, { replace: true });
  };
  return (
    <div class="split is-talk" data-layout="wide" data-tab="talk">
      <aside class="sidebar">
        <Sidebar tab="talk" current={route} />
      </aside>
      <div class="content">
        <header class="toolbar">
          <div class="toolbar-title">
            {agent ? (
              <TalkHead agent={agent} />
            ) : (
              <ToolbarName title={titleOf(windowRoute, model, store)} tab="talk" />
            )}
            <Freshness />
          </div>
          <Tabs current="talk" />
          <div class="toolbar-tools">
            <InstallLabel />
            <Bell />
          </div>
        </header>
        <div class="talk-panes" data-testid="panes">
          <section class="pane talk-pane" aria-label={titleOf(windowRoute, model, store)}>
            {agent ? <AgentTalk key={agent} agent={agent} /> : <p class="empty" data-testid="pick-agent">{W.pickAgent}</p>}
          </section>
          {frame ? (
            <aside key={href(frame)} class="pane card-pane is-goal" aria-label={titleOf(frame, model, store)} data-testid="card-pane">
              <button type="button" class="back card-back" onClick={toCard} data-testid="back">
                <BackIcon />
                <span class="one-line">{agent ? W.agentCard : W.talk}</span>
              </button>
              <PanelFrame route={frame} />
            </aside>
          ) : agent ? (
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
  // A detail opened from a list, the home or another tab's screen stands beside that screen and keeps its tab.
  const frame = isFrame(route) ? route : null;
  const base = baseOf(route, stack);
  const tab = tabOf(base);
  const listRoute: Route = base.name === "home" ? { name: "running" } : isList(base) ? base : (lastListIn(stack, tab) ?? defaultListFor(base));
  const detailRoute = frame ?? (isList(route) || route.name === "home" ? null : route);
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
            <ToolbarName title={titleOf(listRoute, model, store)} tab={tab} />
            <Freshness />
          </div>
          <Tabs current={tab} />
          <div class="toolbar-tools">
            <InstallLabel />
            <Bell />
          </div>
        </header>
        <div class={detailRoute ? "panes" : "panes is-folded"} data-testid="panes">
          <section class="pane list-pane" ref={listRef} aria-label={titleOf(listRoute, model, store)}>
            <Screen route={listRoute} />
          </section>
          {detailRoute ? (
            <section class="pane detail-pane" ref={detailRef} aria-label={titleOf(detailRoute, model, store)} data-testid="detail-pane">
              {frame ? <PanelFrame route={frame} /> : <Screen route={detailRoute} />}
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
  const sheetRef = useRef<HTMLDivElement>(null);
  // A detail is a sheet rising over the screen it was opened from (lina-app#142): that screen stays drawn under it,
  // with its own back, title and scroll; closing the sheet is one step back.
  const sheet = isFrame(route) ? route : null;
  const screen = baseOf(route, stack);
  const below = stack.slice(0, sheet ? -1 : stack.length);
  while (sheet && below.length && isFrame(parse(below[below.length - 1]))) below.splice(-1);
  const screenStack = below.length ? below : [href(screen)];
  // The scroll comes from the history entry the router read for this screen, not from whatever entry is current
  // when the swap finally renders.
  useScrollKeeping({ main: mainRef, detail: sheetRef }, { list: "", detail: sheet ? href(sheet) : "", main: href(screen) }, scroll);
  const parent = parentOf(screen, screenStack);
  const isRoot = isTabRoot(screen);
  const large = isRoot || isList(screen);
  // An agent's 대화 window has a chat app's bar: a back icon, the agent's mark and name, the chip and the bell (lina-app#191).
  const talkAgent = !sheet && screen.name === "talk" && !screen.goal ? screen.id : null;
  const goBack = () => {
    if (stack.length > 1) back();
    else navigate(sheet ? screen : parent, { replace: true, direction: sheet ? "none" : "pop" });
  };
  const current = useRef({ isRoot, goBack, sheet: Boolean(sheet) });
  current.current = { isRoot: isRoot && !sheet, goBack, sheet: Boolean(sheet) };
  useLayoutEffect(() => {
    const slide = slideMotion();
    // The sheet rises and falls by itself: the screen under it never slides.
    onStackMotion((direction, apply) => (current.current.sheet || isFrame(parse(window.location.hash)) ? void apply() : slide(direction, apply)));
    const unbind = bindSwipeBack({ standalone: () => isStandalone(), atRoot: () => current.current.isRoot, onBack: () => current.current.goBack() });
    return () => {
      onStackMotion(null);
      unbind();
    };
  }, []);
  return (
    <div class="stack" data-layout="phone">
      <header class={talkAgent ? "navbar is-talk" : "navbar"}>
        {talkAgent ? (
          <>
            <button type="button" class="back is-icon" onClick={goBack} aria-label={titleOf(parent, model, store)} data-testid="back">
              <BackIcon />
            </button>
            <TalkHead agent={talkAgent} />
          </>
        ) : sheet ? (
          // Back closes the sheet: it reads the screen under it, the one it returns to (the agent from a goal in 대화).
          <button type="button" class="back" onClick={goBack} data-testid="back">
            <BackIcon />
            <span class="one-line">{isRoot ? TAB_WORD[tabOf(screen)] : titleOf(screen, model, store)}</span>
          </button>
        ) : isRoot ? (
          <MenuButton tab={tabOf(screen)} />
        ) : (
          <button type="button" class="back" onClick={goBack} data-testid="back">
            <BackIcon />
            <span class="one-line">{titleOf(parent, model, store)}</span>
          </button>
        )}
        <div class="toolbar-tools">
          <InstallLabel />
          <Bell />
        </div>
      </header>
      <main class="phone-main" ref={mainRef}>
        {/* A tab's first screen is named by its pressed tab; its heading is for a screen reader only (lina-app#193). */}
        {large ? (
          <h1 class={isRoot ? "visually-hidden" : "large-title"} data-testid="screen-title">
            {isRoot ? TAB_WORD[tabOf(screen)] : titleOf(screen, model, store)}
          </h1>
        ) : null}
        {isRoot ? <Tabs current={tabOf(screen)} /> : null}
        {/* Under a goal chosen in 대화 stands the card it was chosen on, not the window and its field (lina-app#143). */}
        {sheet?.name === "talk" && screen.name === "talk" ? <AgentCard agent={screen.id} /> : <Screen route={screen} />}
        {screen.name === "status" ? <StatusMore /> : null}
      </main>
      <footer class="bottombar">
        <span />
        <Freshness />
        <span />
      </footer>
      {sheet ? (
        <>
          <div class="detail-scrim" aria-hidden="true" onClick={goBack} />
          <section class="detail-sheet" role="dialog" aria-modal="true" aria-label={titleOf(sheet, model, store)} data-testid="detail-frame" data-frame="sheet">
            <div class="detail-sheet-bar">
              <span class="detail-sheet-grabber" aria-hidden="true" />
              <button type="button" class="text-button" onClick={goBack} data-testid="frame-close">
                {W.close}
              </button>
            </div>
            <div class="detail-sheet-body" ref={sheetRef}>
              <Screen key={href(sheet)} route={sheet} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function App({ store, pushHost, label = null }: { store: Store; pushHost?: PushHost; label?: AppLabel | null }) {
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
  const push = usePushFor(store.source, host, store.painted, (request) => {
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

  // Before the first paint, not after it (lina-app#186): the reads leave while the browser draws the empty screen.
  useLayoutEffect(() => startLive(store), [store]);
  useLayoutEffect(() => {
    store.want(wantsFor(nav.route, store));
    if (readsEveryFinished(nav.route, store)) void store.showFinished(true);
  }, [nav.hash, version]);
  useEffect(() => {
    if (nav.route.name !== "settings" && nav.route.name !== "setting") settingsEdits.editRules(false);
  }, [nav.route.name]);

  // The row a closed detail was opened from stays highlighted while its screen is the one shown (lina-app#142).
  const base = baseOf(nav.route, nav.state.stack);
  const kept = useRef<{ base: string; hash: string } | null>(null);
  if (isFrame(nav.route)) kept.current = { base: href(base), hash: nav.hash };
  else if (kept.current && kept.current.base !== nav.hash) kept.current = null;
  const selected = isFrame(nav.route) ? nav.hash : (kept.current?.hash ?? (isList(nav.route) ? null : nav.hash));
  const context: AppContext = { model, store, now, wide, selected, label };
  return (
    <Ctx.Provider value={context}>
      <ActionsCtx.Provider value={actions}>
        <PushCtx.Provider value={push}>
          <SettingsCtx.Provider value={settingsEdits}>
            {wide && tabOf(base) === "talk" ? <TalkShell route={base} frame={isFrame(nav.route) ? nav.route : null} stack={nav.state.stack} /> : wide ? <WideShell route={nav.route} stack={nav.state.stack} scroll={nav.state.scroll} /> : <PhoneShell route={nav.route} stack={nav.state.stack} scroll={nav.state.scroll} />}
            <Toast />
            <RollbackSheet />
            <RestartSheet />
          </SettingsCtx.Provider>
        </PushCtx.Provider>
      </ActionsCtx.Provider>
    </Ctx.Provider>
  );
}
