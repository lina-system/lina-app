import type { ComponentChildren } from "preact";
import type { Machine, QuotaAccount, QuotaService } from "../api/client";
import type { CardRow, DueRow, GoalRow, InboxRow } from "../model";
import { agentView, doneFor } from "../model";
import type { OpenCheck } from "../model/checks";
import { href, navigate } from "../router";
import { ago, dayLabel, until } from "../time";
import { useEffect, useState } from "preact/hooks";
import { KoreanInput } from "../korean-input";
import { useActions } from "../ui/actions";
import { AgentMark, agentName, CardRowView, CountPair, Dial, Disclosure, DoneCheck, Empty, ErrorLine, Link, ListSection, useApp } from "../ui/parts";
import { machineWhy, serviceName, SEP, W } from "../words";

type DecideRow = Extract<InboxRow, { type: "decide" }>;

/**
 * A decision expands in place: the full sentence, a link to its record, `진행 대기:` when to-dos wait on it, and
 * the answer buttons (the recommended one marked) or a field. Answering hides the row and holds the answer back
 * for the toast (see Actions.answer).
 */
function DecisionRow({ row }: { row: DecideRow }) {
  const { model, store, now } = useApp();
  const actions = useActions();
  const error = actions.error(row.key);
  const [open, setOpen] = useState(Boolean(error));
  const [text, setText] = useState(error?.text ?? "");
  useEffect(() => {
    if (open && row.target.kind === "item") store.ensure([["item", row.target.id]]);
  }, [open]);
  const name = agentName(model, row.agent);
  const kind = row.ask ? W.ask : W.act;
  const detail = row.target.kind === "item" ? store.get("item", row.target.id) : undefined;
  const choices = detail?.decision?.choices ?? [];
  const recommended = detail?.decision?.recommended ?? null;
  const waiting = (detail?.children ?? []).filter((child) => child.reason === "blocked_by_item").map((child) => child.title);
  const busy = actions.busy(row.key);
  const send = (answer: string) => {
    const body = answer.trim();
    if (body) actions.answer(row.key, row.target, body);
  };
  return (
    <li class={`row inbox-row decision-row${open ? " is-open" : ""}`} data-testid="row">
      <button type="button" class="row-button" aria-expanded={open} aria-label={[name, row.text, kind].filter(Boolean).join(SEP)} onClick={() => setOpen(!open)}>
        <AgentMark id={row.agent} />
        <span class="lines">
          {open ? null : <span class="context one-line">{row.context}</span>}
          <span class={open ? "title" : "title one-line"}>{row.text}</span>
        </span>
        <span class="trail">
          <span class="kind-word">{kind}</span>
          <span class="time">{ago(now - row.at)}</span>
        </span>
      </button>
      {open ? (
        <div class="decision-panel" data-testid="decision-panel">
          <Link href={row.href} class="context crumb">
            {row.context}
          </Link>
          {waiting.length ? <p class="sub" data-testid="waiting-on">{W.waitingOn(waiting.join(", "))}</p> : null}
          {choices.length ? (
            <div class="choices" role="group" aria-label={row.text}>
              {choices.map((choice) => (
                <button key={choice} type="button" class="choice" disabled={busy} aria-label={choice === recommended ? `${choice}${SEP}${W.recommended}` : choice} onClick={() => send(choice)}>
                  {choice}
                  {choice === recommended ? <span class="tag">{W.recommended}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <form
              class="comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                send(text);
              }}
            >
              <KoreanInput label={W.answerField} value={text} onValue={setText} inline />
              <button type="submit" class="text-button" disabled={busy || !text.trim()}>
                {W.send}
              </button>
            </form>
          )}
          <ErrorLine line={error?.line} />
        </div>
      ) : null}
    </li>
  );
}

function MineRow({ row }: { row: Extract<InboxRow, { type: "mine" }> }) {
  const { model, selected } = useApp();
  const actions = useActions();
  const name = agentName(model, row.agent);
  const shown = actions.isDone(row.id, row.done);
  return (
    <li class={`row inbox-row check-row${shown ? " is-checked" : ""}`} data-testid="row">
      <DoneCheck id={row.id} title={row.title} done={row.done} />
      <Link href={row.href} label={[name, row.title, W.mine].filter(Boolean).join(SEP)} current={selected === row.href}>
        <AgentMark id={row.agent} />
        <span class="lines">
          <span class="title one-line">{row.title}</span>
        </span>
        {row.due ? <DueDate day={row.due} /> : null}
      </Link>
      <ErrorLine line={actions.error(`done:${row.id}`)?.line} />
    </li>
  );
}

function InboxRowView({ row }: { row: InboxRow }) {
  if (row.type === "review") return <CardRowView card={row.card} kindIcon={false} />;
  if (row.type === "decide") return <DecisionRow row={row} />;
  return <MineRow row={row} />;
}

function DueDate({ day }: { day: string }) {
  const { model } = useApp();
  const tone = day < model.today ? " is-overdue" : day === model.today ? " is-today" : "";
  return <span class={`trail due-date${tone}`}>{dayLabel(day)}</span>;
}

export function InboxScreen() {
  const { model } = useApp();
  if (!model.counts.inbox) return <Empty />;
  return (
    <div class="list" data-testid="screen-inbox">
      {model.inbox.sections.map((section) => (
        <ListSection key={section.id} section={section} render={(row) => <InboxRowView key={row.key} row={row} />} />
      ))}
    </div>
  );
}

/** A stopped card asks its agent to try again: retry on its to-do, or a comment on a card with none. */
function RetryControl({ card }: { card: CardRow }) {
  const { model } = useApp();
  const actions = useActions();
  if (card.kind === "run" && !card.todo) return null;
  if (actions.requested(card.key))
    return (
      <span class="trail requested" data-testid="retry-requested">
        {W.requestedTo(agentName(model, card.agent))}
      </span>
    );
  return (
    <button type="button" class="text-button retry" aria-label={[card.name, W.retry].join(SEP)} onClick={() => void actions.retry(card)} data-testid="retry">
      {W.retry}
    </button>
  );
}

/**
 * The home: one line for the open decisions (only when there are any), the stopped and running cards (stopped on
 * top), the cards waiting on review or an answer, then finished cards, the last 24 hours first and older ones after.
 * Every number is its section's own row count, the same model the sidebar and the agent screens read.
 */
export function RunningScreen() {
  const { model } = useApp();
  const actions = useActions();
  const { home } = model;
  if (!home.decisions && !model.running.rows.length && !home.waiting.rows.length && !model.done.length) return <Empty />;
  return (
    <div class="list" data-testid="screen-running">
      {home.decisions ? (
        <ul class="rows" aria-label={W.inbox}>
          <li class="row" data-testid="home-decisions">
            <Link href={href({ name: "inbox" })} label={`${W.decide} ${home.decisions}`}>
              <span class="lines">
                <span class="title one-line">{W.decide}</span>
              </span>
              <CountPair count={home.decisions} />
              <Disclosure />
            </Link>
          </li>
        </ul>
      ) : null}
      <ListSection
        section={home.active}
        label={W.running}
        render={(card) => <CardRowView key={card.key} card={card} action={card.state === "stopped" ? <RetryControl card={card} /> : undefined} error={actions.error(`retry:${card.key}`)?.line} />}
      />
      {[home.waiting, home.recent, home.older].map((section) => (
        <ListSection key={section.id} section={section} render={(card) => <CardRowView key={card.key} card={card} />} />
      ))}
    </div>
  );
}

function DueRowView({ row }: { row: DueRow }) {
  const { model, selected } = useApp();
  return (
    <li class="row" data-testid="row">
      <Link href={row.href} label={[agentName(model, row.agent), row.title].filter(Boolean).join(SEP)} current={selected === row.href}>
        <AgentMark id={row.agent} />
        <span class="lines">
          <span class="title one-line">{row.title}</span>
        </span>
        {row.due ? <DueDate day={row.due} /> : null}
      </Link>
    </li>
  );
}

export function DueScreen() {
  const { model } = useApp();
  if (!model.counts.due) return <Empty />;
  return (
    <div class="list" data-testid="screen-due">
      {model.due.sections.map((section) => (
        <ListSection key={section.id} section={section} render={(row) => <DueRowView key={row.key} row={row} />} />
      ))}
    </div>
  );
}

/** An agent's latest activity, read from agentView: the agent screen and the filtered 완료 draw this same line. */
function LatestLine({ agentId, testid }: { agentId: string; testid: string }) {
  const { model, now } = useApp();
  const latest = agentView(model, agentId)?.latest ?? null;
  if (latest === null) return null;
  return (
    <span class="agent-latest" data-testid={testid}>
      {W.latest(ago(now - latest))}
    </span>
  );
}

/**
 * 완료, for every agent or one. The filter is the address (`#/done?agent=<id>`), so it survives a reload and every
 * live update; each choice's count is the length of the list it shows.
 */
export function DoneScreen({ agent }: { agent?: string }) {
  const { model } = useApp();
  if (!model.counts.done) return <Empty />;
  const shown = doneFor(model, agent);
  const choose = (id?: string) => navigate(id ? { name: "done", agent: id } : { name: "done" }, { replace: true, direction: "none" });
  const choices = [{ id: undefined as string | undefined, name: W.allAgents }, ...model.agents.map((each) => ({ id: each.id as string | undefined, name: each.name }))];
  return (
    <div class="list" data-testid="screen-done">
      <div class="filter" role="group" aria-label={W.agents} data-testid="done-filter">
        {choices.map((choice) => {
          const count = doneFor(model, choice.id).length;
          return (
            <button key={choice.id ?? "all"} type="button" class="choice" aria-pressed={choice.id === agent} aria-label={`${choice.name} ${count}`} onClick={() => choose(choice.id)}>
              {choice.name}
              <span class="count">{count}</span>
            </button>
          );
        })}
      </div>
      {agent ? <LatestLine agentId={agent} testid="done-latest" /> : null}
      {shown.length ? (
        <ul class="rows" aria-label={W.done}>
          {shown.map((card) => (
            <CardRowView key={card.key} card={card} />
          ))}
        </ul>
      ) : (
        <Empty />
      )}
    </div>
  );
}

function GoalLine({ goal, showAgent }: { goal: GoalRow; showAgent: boolean }) {
  const { model, selected } = useApp();
  const actions = useActions();
  const closed = goal.allDone;
  const shown = actions.isDone(goal.id, goal.state === "done");
  return (
    <li class={`row goal-row${closed ? " check-row" : ""}${closed && shown ? " is-checked" : ""}`} data-testid="row">
      {closed ? <DoneCheck id={goal.id} title={goal.title} done={goal.state === "done"} /> : null}
      <Link
        href={goal.href}
        label={[showAgent ? agentName(model, goal.agent) : "", goal.title, W.progress(goal.todosDone, goal.todosTotal)].filter(Boolean).join(SEP)}
        current={selected === goal.href}
      >
        {closed ? null : <Dial done={goal.todosDone} totalCount={goal.todosTotal} />}
        {showAgent ? <AgentMark id={goal.agent} /> : null}
        <span class="lines">
          <span class="title one-line">{goal.title}</span>
          {goal.doneCondition ? <span class="sub one-line">{goal.doneCondition}</span> : null}
        </span>
        {goal.runningCount ? <span class="trail">{W.runningCount(goal.runningCount)}</span> : null}
      </Link>
      {closed ? <ErrorLine line={actions.error(`done:${goal.id}`)?.line} /> : null}
    </li>
  );
}

export function GoalsScreen() {
  const { model } = useApp();
  if (!model.counts.goals) return <Empty />;
  return (
    <div class="list" data-testid="screen-goals">
      <ul class="rows" aria-label={W.goals}>
        {model.goals.map((goal) => (
          <GoalLine key={goal.id} goal={goal} showAgent />
        ))}
      </ul>
    </div>
  );
}

export function AgentScreen({ id }: { id: string }) {
  const { model } = useApp();
  const view = agentView(model, id);
  if (!view) return <p class="empty">{W.notFound}</p>;
  return (
    <div class="list" data-testid="screen-agent">
      <p class="agent-counts" data-testid="agent-counts">
        {[view.running, view.review, view.planned, view.goals].map((section, index) => (
          <span key={section.id} data-testid={`agent-count-${section.id}`}>
            {index ? SEP : ""}
            {section.title} <CountPair count={section.count} stopped={section.stopped} showZero />
          </span>
        ))}
      </p>
      <p class="agent-latest-line">
        <LatestLine agentId={id} testid="agent-latest" />
      </p>
      <ListSection section={view.running} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={view.review} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={view.planned} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={goal} showAgent={false} />} />
      <ul class="rows" aria-label={W.done}>
        <li class="row" data-testid="done-today">
          <Link href={href({ name: "done", agent: id })} label={W.doneToday(view.doneToday.count)}>
            <span class="lines">
              <span class="title">{W.doneToday(view.doneToday.count)}</span>
            </span>
            <Disclosure />
          </Link>
        </li>
      </ul>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <span class="mini-meter" data-testid="machine-meter">
      <span class="mini-label">{label}</span>
      {value === null ? (
        <span class="mini-none">{W.none}</span>
      ) : (
        <span class="meter" aria-hidden="true">
          <span class={`meter-fill${value >= 90 ? " is-high" : ""}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </span>
      )}
    </span>
  );
}

function MachineRow({ machine }: { machine: Machine }) {
  const word = W.machineState[machine.state] ?? "";
  const why = machineWhy(machine.why);
  const meters = [
    [W.cpu, machine.cpu],
    [W.memory, machine.memory],
    [W.disk, machine.disk],
  ] as const;
  const label = [machine.name, word, why, ...meters.map(([name, value]) => W.meter(name, value)), W.load(machine.running, machine.cap)].filter(Boolean).join(SEP);
  return (
    <li class={`row machine-row is-${machine.state}`} data-testid="row">
      <div class="row-body" aria-label={label}>
        <span class={`status-dot is-${machine.state}`} aria-hidden="true" />
        <span class="lines">
          <span class="title one-line">{machine.name}</span>
          <span class="sub">
            <span class="machine-state">{word}</span>
            {why ? <span class="machine-why">{`${SEP}${why}`}</span> : null}
          </span>
          <span class="mini-meters">
            {meters.map(([name, value]) => (
              <Meter key={name} label={name} value={value} />
            ))}
          </span>
        </span>
        <span class="trail">{W.load(machine.running, machine.cap)}</span>
      </div>
    </li>
  );
}

interface QuotaLine {
  readonly percent: number | null;
  readonly rate: number | null;
  readonly resetAt: number | null;
  readonly warn: boolean;
}

function mainWindow(account: QuotaAccount): QuotaAccount["windows"][number] | undefined {
  return account.windows.find((window) => window.key === account.mainWindow) ?? account.windows[0];
}

function QuotaParts({ line, now }: { line: QuotaLine; now: number }) {
  const parts: ComponentChildren[] = [];
  if (line.percent !== null) parts.push(<span key="p">{W.percent(line.percent)}</span>);
  if (line.rate !== null)
    parts.push(
      <span key="r" class="rate" title={W.rateTitle}>
        {W.ratePerHour(line.rate)}
      </span>,
    );
  if (line.resetAt !== null) parts.push(<span key="t">{until(line.resetAt - now)}</span>);
  return <>{parts.flatMap((part, index) => (index ? [SEP, part] : [part]))}</>;
}

function quotaText(line: QuotaLine, now: number): string[] {
  return [line.percent !== null ? W.percent(line.percent) : null, line.rate !== null ? W.ratePerHour(line.rate) : null, line.resetAt !== null ? until(line.resetAt - now) : null].filter((part): part is string => Boolean(part));
}

function QuotaMeter({ line }: { line: QuotaLine }) {
  return (
    <span class="meter" aria-hidden="true">
      <span class={`meter-fill${line.warn ? " is-high" : ""}`} style={{ width: `${Math.min(100, Math.max(0, line.percent ?? 0))}%` }} />
    </span>
  );
}

function QuotaRow({ service }: { service: QuotaService }) {
  const { now } = useApp();
  const name = serviceName(service.service);
  const resets = service.accounts.map((account) => mainWindow(account)?.resetAt ?? null).filter((at): at is number => at !== null);
  const line: QuotaLine = { percent: service.percent, rate: service.ratePerHour, resetAt: resets.length ? Math.min(...resets) : null, warn: service.accounts.some((account) => account.warn) };
  return (
    <li class={`row quota-row${line.warn ? " is-warn" : ""}`} data-testid="row">
      <details class="quota-fold">
        <summary class="row-body" aria-label={[name, ...quotaText(line, now), line.warn ? W.quotaWarn : ""].filter(Boolean).join(SEP)}>
          <span class="lines">
            <span class="title one-line">{name}</span>
            <span class="sub">
              <QuotaParts line={line} now={now} />
            </span>
          </span>
          {line.warn ? <span class="trail warn-mark">{W.quotaWarn}</span> : null}
          <Disclosure />
          <QuotaMeter line={line} />
        </summary>
        <ul class="accounts" aria-label={name}>
          {service.accounts.map((account) => {
            const window = mainWindow(account);
            const accountLine: QuotaLine = { percent: window?.percent ?? null, rate: window?.ratePerHour ?? null, resetAt: window?.resetAt ?? null, warn: account.warn };
            const flags = [account.paused ? W.quotaPaused : null, account.unavailable ? W.quotaUnavailable : null].filter((flag): flag is string => Boolean(flag));
            return (
              <li key={account.id} class={`account-row${account.warn ? " is-warn" : ""}`} data-testid="account" aria-label={[W.quotaAccount(account.number), ...flags, ...quotaText(accountLine, now), account.warn ? W.quotaWarn : ""].filter(Boolean).join(SEP)}>
                <span class="lines">
                  <span class="title one-line">{[W.quotaAccount(account.number), ...flags].join(SEP)}</span>
                  <span class="sub">
                    <QuotaParts line={accountLine} now={now} />
                  </span>
                </span>
                {account.warn ? <span class="trail warn-mark">{W.quotaWarn}</span> : null}
                <QuotaMeter line={accountLine} />
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

/** A failing, stale or unreadable check: one row, its name and line, then the state word and how long ago. */
function CheckRow({ check }: { check: OpenCheck }) {
  const { now } = useApp();
  const word = W.checkState[check.state] ?? "";
  return (
    <li class={`row check-row is-${check.state}`} data-testid="row">
      <div class="row-body" aria-label={[check.name, check.line, word, ago(now - check.at)].filter(Boolean).join(SEP)}>
        <span class="lines">
          <span class="title one-line">{[check.name, check.line].filter(Boolean).join(SEP)}</span>
        </span>
        <span class="trail">
          <span class={`check-state is-${check.state}`}>{word}</span>
          <span class="time">{ago(now - check.at)}</span>
        </span>
      </div>
    </li>
  );
}

export function StatusScreen() {
  const { model } = useApp();
  return (
    <div class="list" data-testid="screen-status">
      <section class="list-section" data-testid="section-machines">
        <h2 class="section-head">
          <span>{W.devices}</span>
        </h2>
        <ul class="rows" aria-label={W.devices}>
          {model.machines.map((machine) => (
            <MachineRow key={machine.name} machine={machine} />
          ))}
        </ul>
      </section>
      {model.quota.length ? (
        <section class="list-section" data-testid="section-quota">
          <h2 class="section-head">
            <span>{W.quota}</span>
          </h2>
          <ul class="rows" aria-label={W.quota}>
            {model.quota.map((service) => (
              <QuotaRow key={service.service} service={service} />
            ))}
          </ul>
        </section>
      ) : null}
      <section class="list-section" data-testid="section-checks">
        <h2 class="section-head">
          <span>{W.checks}</span>
        </h2>
        {model.checks.total ? (
          <ul class="rows" aria-label={W.checks}>
            {model.checks.open.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
            {model.checks.ok ? (
              <li class="row check-fold" data-testid="row">
                <div class="row-body" aria-label={W.checksOk(model.checks.ok)}>
                  <span class="lines">
                    <span class="sub">{W.checksOk(model.checks.ok)}</span>
                  </span>
                </div>
              </li>
            ) : null}
          </ul>
        ) : (
          <p class="empty" data-testid="checks-empty">
            {W.checksEmpty}
          </p>
        )}
      </section>
    </div>
  );
}
