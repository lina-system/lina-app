import type { ComponentChildren } from "preact";
import type { Machine, QuotaAccount, QuotaService } from "../api/client";
import type { DueRow, GoalRow, InboxRow } from "../model";
import { agentView } from "../model";
import { href } from "../router";
import { ago, dayLabel, until } from "../time";
import { AgentMark, agentName, CardRowView, CountPair, Dial, Disclosure, Empty, Link, ListSection, useApp } from "../ui/parts";
import { machineWhy, serviceName, SEP, W } from "../words";

function InboxRowView({ row }: { row: InboxRow }) {
  const { model, now, selected } = useApp();
  const name = agentName(model, row.agent);
  if (row.type === "review") return <CardRowView card={row.card} kindIcon={false} />;
  if (row.type === "decide") {
    const kind = row.ask ? W.ask : W.act;
    return (
      <li class="row inbox-row" data-testid="row">
        <Link href={row.href} label={[name, row.text, kind].filter(Boolean).join(SEP)} current={selected === row.href}>
          <AgentMark id={row.agent} />
          <span class="lines">
            <span class="context one-line">{row.context}</span>
            <span class="title">{row.text}</span>
          </span>
          <span class="trail">
            <span class="kind-word">{kind}</span>
            <span class="time">{ago(now - row.at)}</span>
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li class="row inbox-row" data-testid="row">
      <Link href={row.href} label={[name, row.title, W.mine].filter(Boolean).join(SEP)} current={selected === row.href}>
        <AgentMark id={row.agent} />
        <span class="lines">
          <span class="title one-line">{row.title}</span>
        </span>
        {row.due ? <DueDate day={row.due} /> : null}
      </Link>
    </li>
  );
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

export function RunningScreen() {
  const { model } = useApp();
  if (!model.counts.running) return <Empty />;
  return (
    <div class="list" data-testid="screen-running">
      <ul class="rows" aria-label={W.running}>
        {model.running.rows.map((card) => (
          <CardRowView key={card.key} card={card} />
        ))}
      </ul>
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

export function DoneScreen() {
  const { model } = useApp();
  if (!model.counts.done) return <Empty />;
  return (
    <div class="list" data-testid="screen-done">
      <ul class="rows" aria-label={W.done}>
        {model.done.map((card) => (
          <CardRowView key={card.key} card={card} />
        ))}
      </ul>
    </div>
  );
}

function GoalLine({ goal, showAgent }: { goal: GoalRow; showAgent: boolean }) {
  const { model, selected } = useApp();
  return (
    <li class="row goal-row" data-testid="row">
      <Link
        href={goal.href}
        label={[showAgent ? agentName(model, goal.agent) : "", goal.title, W.progress(goal.todosDone, goal.todosTotal)].filter(Boolean).join(SEP)}
        current={selected === goal.href}
      >
        <Dial done={goal.todosDone} totalCount={goal.todosTotal} />
        {showAgent ? <AgentMark id={goal.agent} /> : null}
        <span class="lines">
          <span class="title one-line">{goal.title}</span>
          {goal.doneCondition ? <span class="sub one-line">{goal.doneCondition}</span> : null}
        </span>
        {goal.runningCount ? <span class="trail">{W.runningCount(goal.runningCount)}</span> : null}
      </Link>
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
        {[view.running, view.review, view.goals].map((section, index) => (
          <span key={section.id} data-testid={`agent-count-${section.id}`}>
            {index ? SEP : ""}
            {section.title} <CountPair count={section.count} stopped={section.stopped} showZero />
          </span>
        ))}
      </p>
      <ListSection section={view.running} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={view.review} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={goal} showAgent={false} />} />
      <ul class="rows" aria-label={W.done}>
        <li class="row" data-testid="done-today">
          <Link href={href({ name: "done" })} label={W.doneToday(view.doneToday.count)}>
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
    </div>
  );
}
