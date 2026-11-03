import type { DueRow, GoalRow, InboxRow } from "../model";
import { agentView } from "../model";
import { href } from "../router";
import { ago, dayLabel, until } from "../time";
import { AgentMark, agentName, CardRowView, Dial, Disclosure, Empty, Link, ListSection, useApp } from "../ui/parts";
import { MACHINE_WHY, SEP, W } from "../words";

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
            {section.title} <span class="count">{section.count}</span>
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

export function StatusScreen() {
  const { model, now } = useApp();
  return (
    <div class="list" data-testid="screen-status">
      <section class="list-section" data-testid="section-machines">
        <h2 class="section-head">
          <span>{W.devices}</span>
        </h2>
        <ul class="rows" aria-label={W.devices}>
          {model.machines.map((machine) => {
            const word = W.machineState[machine.state] ?? "";
            const why = machine.why ? MACHINE_WHY[machine.why] : null;
            return (
              <li key={machine.name} class={`row machine-row is-${machine.state}`} data-testid="row">
                <div class="row-body" aria-label={[machine.name, word, why].filter(Boolean).join(SEP)}>
                  <span class={`status-dot is-${machine.state}`} aria-hidden="true" />
                  <span class="lines">
                    <span class="title one-line">{machine.name}</span>
                    <span class="sub">
                      <span class="machine-state">{word}</span>
                      {why ? `${SEP}${why}` : ""}
                    </span>
                  </span>
                  <span class="trail">{W.load(machine.running, machine.cap)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {model.quota.length ? (
        <section class="list-section" data-testid="section-quota">
          <h2 class="section-head">
            <span>{W.quota}</span>
          </h2>
          <ul class="rows" aria-label={W.quota}>
            {model.quota.map((service) => {
              const warn = service.accounts.some((account) => account.warn);
              const resets = service.accounts.flatMap((account) => account.windows.filter((window) => window.key === account.mainWindow)).map((window) => window.resetAt).filter((at): at is number => at !== null);
              const reset = resets.length ? Math.min(...resets) : null;
              const parts = [
                service.percent !== null ? W.percent(service.percent) : null,
                service.ratePerHour !== null ? W.ratePerHour(service.ratePerHour) : null,
                reset !== null ? W.resetIn(until(reset - now)) : null,
              ].filter(Boolean);
              return (
                <li key={service.service} class={`row quota-row${warn ? " is-warn" : ""}`} data-testid="row">
                  <div class="row-body" aria-label={[service.service, ...parts, warn ? W.quotaWarn : ""].filter(Boolean).join(SEP)}>
                    <span class="lines">
                      <span class="title one-line">{service.service}</span>
                      <span class="sub">{parts.join(SEP)}</span>
                    </span>
                    {warn ? <span class="trail warn-mark">{W.quotaWarn}</span> : null}
                    <span class="meter" aria-hidden="true">
                      <span class="meter-fill" style={{ width: `${Math.min(100, service.percent ?? 0)}%` }} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
