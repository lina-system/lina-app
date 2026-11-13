import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext } from "preact/hooks";
import type { WorkState } from "../api/client";
import type { Store } from "../data/store";
import type { CardRow, Model, Section } from "../model";
import { linkClick } from "../router";
import { ago, duration, total } from "../time";
import { KIND_WORD, SEP, STATE_WORD, stateLabel, W } from "../words";
import { ChevronIcon, CodeIcon, DeviceKindIcon, DocsIcon, ResearchIcon } from "./icons";
import type { CardKind } from "../model/kind";
import { useActions } from "./actions";

const KIND_ICON: Record<CardKind, () => JSX.Element> = { code: CodeIcon, docs: DocsIcon, research: ResearchIcon, device: DeviceKindIcon };

export interface AppContext {
  readonly model: Model;
  readonly store: Store;
  readonly now: number;
  readonly wide: boolean;
  /** The hash of the detail open beside the list, for the selected row. */
  readonly selected: string | null;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp outside the app shell");
  return value;
}

export function agentName(model: Model, id: string | null | undefined): string {
  return (id && model.names.get(id)) || "";
}

export function AgentMark({ id }: { id: string | null | undefined }) {
  const { model } = useApp();
  const agent = model.agents.find((candidate) => candidate.id === id);
  if (!agent) return <span class="mark mark-none" aria-hidden="true" />;
  return (
    <span class="mark" style={{ "--dot": `var(--agent-${agent.index % 6})` }} aria-hidden="true">
      {agent.letter}
    </span>
  );
}

/** A running card's to-dos as a thin bar and their count (▮▮▮▯▯ 3/5); the number is the text, the bar its picture. */
export function Progress({ done, total, word = false }: { done: number; total: number; word?: boolean }) {
  return (
    <span class="progress" data-testid="progress" aria-label={W.todoProgress(done, total)}>
      <span class="progress-bar" aria-hidden="true">
        <span class="progress-fill" style={{ width: `${Math.round((100 * Math.min(done, total)) / total)}%` }} />
      </span>
      <span class="progress-count" aria-hidden="true">
        {word ? W.todoProgress(done, total) : W.progress(done, total)}
      </span>
    </span>
  );
}

/** A work card's kind: its icon, and the kind word beside it in a detail head. */
export function KindMark({ work, word = false }: { work: CardKind; word?: boolean }) {
  return (
    <span class="kind-mark" data-testid="kind">
      <span class="kind" data-kind={work}>
        {KIND_ICON[work]()}
      </span>
      {word ? <span class="kind-name">{KIND_WORD[work]}</span> : null}
    </span>
  );
}

export function StateText({ state, reason, stop }: { state: WorkState; reason?: string | null; stop?: CardRow["stop"] }) {
  return (
    <span class={stop && !stop.known ? "state is-plain" : "state"} data-state={state} data-testid="state">
      {stateWords(state, reason, stop)}
    </span>
  );
}

/** A row's state words: a stopped row's few words of why and who it waits on (CardRow.stop), else the state label. */
export function stateWords(state: WorkState, reason?: string | null, stop?: CardRow["stop"]): string {
  return stop ? [STATE_WORD.stopped, stop.words].filter(Boolean).join(SEP) : stateLabel(state, reason);
}

/**
 * A card's time on a list: a running card counts up (n분째); every other card says how long ago, a finished one how
 * long ago it ended (완료 · 20분 전). How long a finished card took is in its detail (cardTook).
 */
export function cardTime(card: CardRow, now: number): string {
  // A planned card has not started: no time beside it at all.
  if (card.state === "planned") return "";
  if (card.state === "in_progress" && card.startedAt !== null) return duration(now - card.startedAt);
  if (card.state === "done") return card.endedAt !== null ? ago(now - card.endedAt) : "";
  return card.stateAt !== null ? ago(now - card.stateAt) : "";
}

/** How long a finished card took (20분 걸림), for its detail. */
export function cardTook(card: CardRow): string {
  return card.state === "done" && card.totalSeconds !== null ? W.took(total(card.totalSeconds)) : "";
}

export function sinceText(state: WorkState, since: number | null, now: number): string {
  if (since === null) return "";
  return state === "in_progress" ? duration(now - since) : ago(now - since);
}

export function Link({ href, class: className, label, children, current }: { href: string; class?: string; label?: string; children: ComponentChildren; current?: boolean }) {
  return (
    <a href={href} class={className} aria-label={label} aria-current={current ? "page" : undefined} onClick={linkClick}>
      {children}
    </a>
  );
}

export function StateTime({ state, reason, stop, time }: { state: WorkState; reason?: string | null; stop?: CardRow["stop"]; time: string }) {
  return (
    <span class="sub">
      <StateText state={state} reason={reason} stop={stop} />
      {time ? <span class="time">{`${SEP}${time}`}</span> : null}
    </span>
  );
}

export function CardRowView({ card, dim = false, bare = false, kindIcon = true, action, error }: { card: CardRow; dim?: boolean; bare?: boolean; kindIcon?: boolean; action?: ComponentChildren; error?: string }) {
  const { model, now, wide, selected } = useApp();
  const time = cardTime(card, now);
  const progress = wide && card.state === "in_progress" && card.progress ? card.progress : null;
  const label = [agentName(model, card.agent), card.name, card.sub ?? "", card.ask ?? "", stateWords(card.state, card.reason, card.stop), progress ? W.todoProgress(progress.done, progress.total) : ""].filter(Boolean).join(SEP);
  // No title: the kind word (a card's detail) or 제목 없음 (a list row) stands in its place, grey.
  const titleClass = card.title ? "title" : "title is-kind";
  return (
    <li class={`row card-row${card.state === "stopped" ? " is-stopped" : ""}${dim ? " is-dim" : ""}${action ? " has-action" : ""}`} data-testid="row">
      <Link href={card.href} label={label} current={selected === card.href}>
        {kindIcon ? <span class="kind" data-kind={card.work}>{KIND_ICON[card.work]()}</span> : null}
        <AgentMark id={card.agent} />
        {dim ? (
          <span class="lines">
            <span class="one-line">
              <span class={titleClass}>{card.name}</span>
              {bare ? null : <span class="sub">{SEP}</span>}
              {bare ? null : <StateTime state={card.state} reason={card.reason} stop={card.stop} time={time} />}
            </span>
          </span>
        ) : (
          <span class="lines">
            <span class={`${titleClass} one-line`}>{card.name}</span>
            {card.sub ? (
              <span class="sub row-sub one-line" data-testid="row-sub">
                {card.sub}
              </span>
            ) : null}
            {card.ask ? (
              <span class="sub stop-ask one-line" data-testid="stop-ask">
                {card.ask}
              </span>
            ) : null}
            <StateTime state={card.state} reason={card.reason} stop={card.stop} time={time} />
            {wide && card.now && card.state === "in_progress" ? <span class="sub now one-line">{card.now}</span> : null}
          </span>
        )}
        {progress ? <Progress done={progress.done} total={progress.total} /> : null}
      </Link>
      {action}
      <ErrorLine line={error} />
    </li>
  );
}

/**
 * The one way a count is drawn: the grey number of a list, then its stopped cards as a small red number,
 * never summed. The sidebar, section headings and the agent head all use it.
 */
export function CountPair({ count, stopped, showZero = false, countId = "count", stoppedId = "stopped-count" }: { count: number; stopped?: number; showZero?: boolean; countId?: string; stoppedId?: string }) {
  if (!count && !stopped && !showZero) return null;
  return (
    <span class="count-pair">
      {count || showZero ? (
        <span class="count" data-testid={countId}>
          {count}
        </span>
      ) : null}
      {stopped ? (
        <span class="count is-stopped-count" data-testid={stoppedId} aria-label={W.stoppedCount(stopped)}>
          {stopped}
        </span>
      ) : null}
    </span>
  );
}

export function SectionHead({ section }: { section: Section<unknown> }) {
  if (!section.title) return null;
  return (
    <h2 class="section-head" data-testid={`head-${section.id}`}>
      <span>{section.title}</span>
      <CountPair count={section.count} stopped={section.stopped} showZero />
    </h2>
  );
}

export function ListSection<T>({ section, render, label }: { section: Section<T>; render: (row: T) => ComponentChildren; label?: string }) {
  if (!section.count && !section.stopped) return null;
  return (
    <section class="list-section" data-testid={`section-${section.id}`}>
      <SectionHead section={section} />
      <ul class="rows" aria-label={label ?? section.title}>
        {section.rows.map(render)}
      </ul>
    </section>
  );
}

export function Box({ title, children, testid }: { title?: string; children: ComponentChildren; testid?: string }) {
  return (
    <section class="box" data-testid={testid}>
      {title ? <h2 class="box-head">{title}</h2> : null}
      {children}
    </section>
  );
}

/**
 * A to-do's round mark where pressing it does nothing (a work card's to-dos): a plain status mark, not a control. A
 * done one says 완료 to a screen reader; an open one says nothing beside its title (lina-app#128).
 */
export function CheckBox({ done }: { done: boolean }) {
  return (
    <>
      <span class={`check${done ? " is-done" : ""}`} aria-hidden="true" data-testid="todo-mark" />
      {done ? <span class="visually-hidden">{STATE_WORD.done}</span> : null}
    </>
  );
}

/**
 * The round check box of a goal or to-do (Things style). Unchecked: a tap marks it done at once. Checked by the
 * owner within the undo window: a tap takes it back. Otherwise it only shows the state. `onOpenTodos` runs instead
 * of marking when a goal still has open to-dos, so the page can ask first.
 */
export function DoneCheck({ id, title, done, undoUntil, withOpen = [], openTodos = 0, onOpenTodos }: { id: string; title: string; done: boolean; undoUntil?: number | null; withOpen?: readonly string[]; openTodos?: number; onOpenTodos?: () => void }) {
  const actions = useActions();
  const { now } = useApp();
  const shown = actions.isDone(id, done);
  const until = actions.undoUntil(id, undoUntil);
  const canUndo = shown && until !== null && now < until;
  const inert = shown && !canUndo;
  const click = () => {
    if (actions.busy(`done:${id}`) || inert) return;
    if (shown) void actions.undoDone(id, withOpen);
    else if (openTodos > 0 && onOpenTodos) onOpenTodos();
    else void actions.markDone(id);
  };
  return (
    <button
      type="button"
      class={`check${shown ? " is-done" : ""}`}
      role="checkbox"
      aria-checked={shown}
      aria-disabled={inert || actions.busy(`done:${id}`) ? "true" : undefined}
      aria-label={shown ? W.isDone(title) : W.markDone(title)}
      onClick={click}
      data-testid="done-check"
    />
  );
}

export function ErrorLine({ line }: { line: string | undefined }) {
  if (!line) return null;
  return (
    <p class="write-error" role="alert" data-testid="write-error">
      {line}
    </p>
  );
}

export function Dial({ done, totalCount }: { done: number; totalCount: number }) {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  const part = totalCount ? done / totalCount : 0;
  return (
    <svg class="dial" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r={r} class="dial-track" />
      {part > 0 ? <circle cx="10" cy="10" r={r} class="dial-fill" stroke-dasharray={`${circumference * part} ${circumference}`} transform="rotate(-90 10 10)" /> : null}
    </svg>
  );
}

export function Disclosure() {
  return (
    <span class="disclosure">
      <ChevronIcon />
    </span>
  );
}

/** A list with no rows: 없음, or 불러오는 중 while the first read of the lists has not answered yet. */
export function Empty() {
  const { store } = useApp();
  return <p class="empty">{store.version === 0 ? W.loading : W.empty}</p>;
}
