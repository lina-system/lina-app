import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { WorkState } from "../api/client";
import type { Store } from "../data/store";
import type { CardRow, Model, Section } from "../model";
import { linkClick } from "../router";
import { ago, duration, total } from "../time";
import { SEP, stateLabel, W } from "../words";
import { CardIcon, ChevronIcon, RunIcon } from "./icons";

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

export function StateText({ state, reason }: { state: WorkState; reason?: string | null }) {
  return (
    <span class="state" data-state={state} data-testid="state">
      {stateLabel(state, reason)}
    </span>
  );
}

export function cardTime(card: CardRow, now: number): string {
  if (card.state === "in_progress" && card.startedAt !== null) return duration(now - card.startedAt);
  if (card.state === "done") return card.totalSeconds !== null ? total(card.totalSeconds) : "";
  return card.stateAt !== null ? ago(now - card.stateAt) : "";
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

export function StateTime({ state, reason, time }: { state: WorkState; reason?: string | null; time: string }) {
  return (
    <span class="sub">
      <StateText state={state} reason={reason} />
      {time ? <span class="time">{`${SEP}${time}`}</span> : null}
    </span>
  );
}

export function CardRowView({ card, dim = false, kindIcon = true }: { card: CardRow; dim?: boolean; kindIcon?: boolean }) {
  const { model, now, wide, selected } = useApp();
  const time = cardTime(card, now);
  const label = [agentName(model, card.agent), card.title, stateLabel(card.state, card.reason)].filter(Boolean).join(SEP);
  return (
    <li class={`row card-row${card.state === "stopped" ? " is-stopped" : ""}${dim ? " is-dim" : ""}`} data-testid="row">
      <Link href={card.href} label={label} current={selected === card.href}>
        {kindIcon ? <span class="kind">{card.kind === "card" ? <CardIcon /> : <RunIcon />}</span> : null}
        <AgentMark id={card.agent} />
        {dim ? (
          <span class="lines">
            <span class="one-line">
              <span class="title">{card.title}</span>
              <span class="sub">{SEP}</span>
              <StateTime state={card.state} reason={card.reason} time={time} />
            </span>
          </span>
        ) : (
          <span class="lines">
            <span class="title one-line">{card.title}</span>
            <StateTime state={card.state} reason={card.reason} time={time} />
            {wide && card.now && card.state === "in_progress" ? <span class="sub now one-line">{card.now}</span> : null}
          </span>
        )}
      </Link>
    </li>
  );
}

export function SectionHead({ section }: { section: Section<unknown> }) {
  if (!section.title) return null;
  return (
    <h2 class="section-head" data-testid={`head-${section.id}`}>
      <span>{section.title}</span>
      <span class="count" data-testid="count">
        {section.count}
      </span>
    </h2>
  );
}

export function ListSection<T>({ section, render, label }: { section: Section<T>; render: (row: T) => ComponentChildren; label?: string }) {
  if (!section.count) return null;
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

export function CheckBox({ title, done }: { title: string; done: boolean }) {
  return (
    <span
      class={`check${done ? " is-done" : ""}`}
      role="checkbox"
      aria-checked={done}
      aria-disabled="true"
      aria-label={W.markDone(title)}
    />
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

export function Empty() {
  return <p class="empty">{W.empty}</p>;
}
