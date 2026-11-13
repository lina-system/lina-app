import type { ComponentChildren } from "preact";
import { USAGE_RANGES, type Machine, type PersonDevice, type PowerStation, type PowerView, type QuotaAccount, type QuotaService, type RunnerCell, type UsageRange } from "../api/client";
import type { CardRow, DueRow, GoalRow, InboxRow, Section } from "../model";
import { agentView, doneFor, localDay } from "../model";
import type { OpenCheck } from "../model/checks";
import { stopReason } from "../model/stop-reason";
import { runnerName } from "../model/settings";
import type { UsageLine } from "../model/usage";
import { href, navigate } from "../router";
import { ago, dayLabel, until } from "../time";
import { useEffect, useState } from "preact/hooks";
import { useActions } from "../ui/actions";
import { AgentMark, agentName, CardRowView, CountPair, Dial, Disclosure, DoneCheck, Empty, ErrorLine, Link, ListSection, SectionHead, useApp } from "../ui/parts";
import { machineWhy, metricsReason, serviceName, SEP, versionOf, W } from "../words";
import { writeError } from "./write-error";

type DecideRow = Extract<InboxRow, { type: "decide" }>;

/**
 * A decision is one row that opens its record in the one detail frame at once (lina-app#142): the full sentence, `진행
 * 대기:` when to-dos wait on it, and the answer buttons (the recommended one marked) or a field stand there. Answering
 * hides the row and holds the answer back for the toast (see Actions.answer).
 */
function DecisionRow({ row }: { row: DecideRow }) {
  const { model, now, selected } = useApp();
  const name = agentName(model, row.agent);
  const kind = row.ask ? W.ask : W.act;
  return (
    <li class="row inbox-row decision-row" data-testid="row">
      <Link href={row.href} label={[name, row.text, kind].filter(Boolean).join(SEP)} current={selected === row.href}>
        <AgentMark id={row.agent} />
        <span class="lines">
          {row.context ? <span class="context one-line">{row.context}</span> : null}
          <span class="title one-line">{row.text}</span>
        </span>
        <span class="trail">
          <span class="kind-word">{kind}</span>
          <span class="time">{ago(now - row.at)}</span>
        </span>
      </Link>
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
 * The stopped cards' own group (lina-app#134): `중단됨` and one red number, its rows. 다시 시도 sits only on a row
 * running again can clear; a row waiting on an answer or a review opens its detail.
 */
function StoppedSection({ section }: { section: Section<CardRow> }) {
  const actions = useActions();
  if (!section.rows.length) return null;
  return (
    <section class="list-section" data-testid={`section-${section.id}`}>
      <h2 class="section-head" data-testid={`head-${section.id}`}>
        <span>{section.title}</span>
        <CountPair count={0} stopped={section.stopped} />
      </h2>
      <ul class="rows" aria-label={section.title}>
        {section.rows.map((card) => (
          <CardRowView key={card.key} card={card.stop ? { ...card, stop: { ...card.stop, words: stopReason(card).word } } : card} action={card.stop?.retry ? <RetryControl card={card} /> : undefined} error={actions.error(`retry:${card.key}`)?.line} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The owner's to-dos on the home: one line with their count, folded, so the stopped and running work reads first
 * (lina-app#141). Choosing the line opens the rows in place under it.
 */
function MineFold({ section }: { section: Section<InboxRow> }) {
  const [open, setOpen] = useState(false);
  if (!section.rows.length) return null;
  return (
    <section class="list-section" data-testid="home-mine">
      <ul class="rows" aria-label={section.title}>
        <li class={`row mine-fold${open ? " is-open" : ""}`}>
          <button type="button" class="row-button" aria-expanded={open} aria-label={`${section.title} ${section.count}`} onClick={() => setOpen(!open)}>
            <span class="lines">
              <span class="title one-line">{section.title}</span>
            </span>
            <CountPair count={section.count} />
            <Disclosure />
          </button>
        </li>
        {open ? section.rows.map((row) => <InboxRowView key={row.key} row={row} />) : null}
      </ul>
    </section>
  );
}

/**
 * The home (lina-app#141): one line for the open decisions (only when there are any) and the review items, the
 * stopped cards in their own group, the running cards (only when there are any), the cards waiting on an answer, the
 * owner's own to-dos folded to one line, then finished cards, the last 24 hours first and older ones after. Every
 * number is its section's own row count, the same model the sidebar and the agent screens read.
 */
export function RunningScreen() {
  const { model } = useApp();
  const { home } = model;
  if (!home.decisions && !home.review.rows.length && !home.mine.rows.length && !model.running.rows.length && !home.planned.rows.length && !home.waiting.rows.length && !model.done.length) return <Empty />;
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
      <ListSection section={home.review} render={(row) => <InboxRowView key={row.key} row={row} />} />
      <StoppedSection section={home.stopped} />
      <ListSection section={home.active} label={W.running} render={(card) => <CardRowView key={card.key} card={card} />} />
      {!home.active.rows.length && (home.stopped.rows.length || home.planned.rows.length) ? (
        // Nothing runs but work is stopped or planned: 진행 중 0 says the tab is alive (lina-app#148).
        <section class="list-section" data-testid="section-active">
          <SectionHead section={home.active} />
        </section>
      ) : null}
      <ListSection section={home.planned} render={(card) => <CardRowView key={card.key} card={card} />} />
      <ListSection section={home.waiting} render={(card) => <CardRowView key={card.key} card={card} />} />
      <MineFold section={home.mine} />
      {[home.recent, home.older].map((section) => (
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

export function GoalLine({ goal, showAgent }: { goal: GoalRow; showAgent: boolean }) {
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

/**
 * 오늘, the first row of 작업: one line per list the owner reads today, each the count of that list and a link to it.
 * The lists themselves stay where they are.
 */
export function TodayScreen() {
  const { model } = useApp();
  const decide = model.inbox.rows.filter((row) => row.type === "decide").length;
  const dueToday = model.due.sections.find((section) => section.id === "today")?.rows.length ?? 0;
  const doneToday = model.done.filter((card) => card.endedAt !== null && localDay(card.endedAt) === model.today).length;
  const rows: { id: string; to: string; text: string; stopped?: number }[] = [
    { id: "decide", to: href({ name: "inbox" }), text: W.todayDecide(decide) },
    { id: "running", to: href({ name: "running" }), text: W.todayRunning(model.counts.running), stopped: model.counts.stopped },
    { id: "due", to: href({ name: "due" }), text: W.todayDue(dueToday) },
    { id: "done", to: href({ name: "done" }), text: W.todayDone(doneToday) },
  ];
  return (
    <div class="list" data-testid="screen-today">
      <ul class="rows" aria-label={W.today}>
        {rows.map((row) => (
          <li key={row.id} class="row" data-testid={`today-${row.id}`}>
            <Link href={row.to} label={[row.text, row.stopped ? W.stoppedCount(row.stopped) : ""].filter(Boolean).join(SEP)}>
              <span class="lines">
                <span class="title">
                  {row.text}
                  {row.stopped ? <span class="is-red">{`${SEP}${W.stoppedCount(row.stopped)}`}</span> : null}
                </span>
              </span>
              <Disclosure />
            </Link>
          </li>
        ))}
      </ul>
    </div>
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

/** A reading: its bar and its percent beside it, as the old dashboard reads it; a missing one is a dash (lina-app#150). */
function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <span class="mini-meter" data-testid="machine-meter">
      <span class="mini-label">{label}</span>
      {value === null ? null : (
        <span class="meter" aria-hidden="true">
          <span class={`meter-fill${value >= 90 ? " is-high" : ""}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </span>
      )}
      <span class="mini-value">{value === null ? W.none : W.percent(value)}</span>
    </span>
  );
}

interface RestartAsk {
  device: string;
  step: "choose" | "worker" | "ocx";
}

interface DeviceNote {
  device: string;
  line: string;
}

/** The restart sheet is drawn beside the shell, so the phone screen does not clip it. The row reads the note from here. */
let restartAsk: RestartAsk | null = null;
let deviceNote: DeviceNote | null = null;
const restartListeners = new Set<() => void>();

function publishRestart(): void {
  for (const listener of restartListeners) listener();
}

function useRestartState(): { ask: RestartAsk | null; note: DeviceNote | null } {
  const [state, setState] = useState({ ask: restartAsk, note: deviceNote });
  useEffect(() => {
    const listener = () => setState({ ask: restartAsk, note: deviceNote });
    restartListeners.add(listener);
    return () => restartListeners.delete(listener);
  }, []);
  return state;
}

function openRestart(device: string): void {
  restartAsk = { device, step: "choose" };
  publishRestart();
}

function closeRestart(): void {
  if (!restartAsk) return;
  restartAsk = null;
  publishRestart();
}

function chooseRestart(step: "worker" | "ocx"): void {
  if (!restartAsk) return;
  restartAsk = { device: restartAsk.device, step };
  publishRestart();
}

/**
 * A fine runner shows its installed version and the signed-in mark. The core's ready decides it, whatever signIn says
 * (the hub serves magpie and unknown for ready runners); only when ready is null does a known signed-in value decide.
 * The sign-in button shows only for why sign_in, or for a signed-out runner with no why. Any other why shows its reason,
 * and an update its installed and fleet versions; a runner not ready with no reason of its own reads 준비 필요. No cell
 * reads 확인 중 (lina-app#144): a runner with no answer, or the core's unknown, shows its version alone, and one with no
 * version either reads 확인 안 됨 (lina-app#150). The runner reads by the settings screen's name, never by its id.
 * 로그인 중 has no button while the post is in flight or the core still reports signingIn. When that turns false,
 * a signed-in runner shows the mark; a sign-in cell shows the reason and the button again.
 */
function RunnerCellView({ machine, runner }: { machine: Machine; runner: RunnerCell }) {
  const { store } = useApp();
  const settings = store.get("settings")?.settings;
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const signingIn = posting || runner.signingIn;
  // The read right after 202 shows signingIn. One more read is the one that can show the sign-in ended.
  useEffect(() => {
    if (!runner.signingIn) return;
    void store.invalidate([["devices"]]);
  }, [runner.signingIn, store]);
  const signedIn = runner.signIn === "signed_in" || runner.signIn === "api_key" || runner.signIn === "ocx";
  const reason = runner.why && runner.why !== "unknown" && Object.hasOwn(W.runnerWhy, runner.why) ? W.runnerWhy[runner.why] : null;
  const installed = versionOf(runner.installed);
  const fleet = versionOf(runner.fleet);
  const fine = !signingIn && (runner.ready === true || (runner.ready === null && !runner.why && signedIn));
  const needsSignIn = !signingIn && (runner.why === "sign_in" || (runner.signIn === "signed_out" && runner.why == null));
  const signIn = () => {
    setError(undefined);
    // Leave the button through the click, then drop it. A click that unmounts its target is retried.
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setPosting(true);
      const result = await store.source.signInDevice(machine.name, runner.name);
      if (result.ok) await store.invalidate([["devices"]]);
      else setError(writeError("device", result));
      setPosting(false);
    })();
  };
  return (
    <div class="runner-cell" data-testid="runner-cell">
      <span class="runner-name">{settings ? runnerName(runner.name, settings) : W.runners}</span>
      {signingIn ? (
        <span class="runner-detail">{W.signingIn}</span>
      ) : fine ? (
        <>
          <span class="runner-detail">{runner.installed ?? W.none}</span>
          <span class="signed-mark" role="img" aria-label={W.signedIn}>
            ✓
          </span>
        </>
      ) : needsSignIn ? (
        <>
          <span class="runner-detail">{W.runnerWhy.sign_in}</span>
          <button type="button" class="text-button" onClick={signIn}>
            {W.signIn}
          </button>
        </>
      ) : runner.why === "update" ? (
        <>
          <span class="runner-detail">{W.runnerWhy.update}</span>
          {installed && fleet && installed !== fleet ? <span class="runner-detail">{W.versionGap(installed, fleet)}</span> : null}
        </>
      ) : reason ? (
        <span class="runner-detail">{reason}</span>
      ) : runner.ready === false ? (
        <span class="runner-detail">{W.runnerWhy.prepare}</span>
      ) : installed ? (
        <span class="runner-detail">{installed}</span>
      ) : (
        <span class="runner-detail">{W.runnerUnchecked}</span>
      )}
      {error ? <ErrorLine line={error} /> : null}
    </div>
  );
}

/** The hub serves `metricsWhy` beside the readings; the client schema does not name it yet (lina-app#144). */
type MachineReadings = Machine & { readonly metricsWhy?: string | null };

/**
 * A node the hub cannot reach reads its name, state and 연결 끊김 and nothing else: no readings, load, runners or restart.
 * A reachable node draws each reading as a bar with its percent, a dash for one it lacks, and then one reason from
 * `metricsWhy` (lina-app#150).
 * Restart names what it restarts and is gone while the node is down.
 */
function MachineRow({ machine }: { machine: MachineReadings }) {
  const { note } = useRestartState();
  const word = W.machineState[machine.state] ?? "";
  const offline = machine.reachable === false;
  const why = offline ? W.offline : machineWhy(machine.why);
  const readings = [
    [W.cpu, machine.cpu],
    [W.memory, machine.memory],
    [W.disk, machine.disk],
  ] as const;
  const missing = readings.some(([, value]) => value === null) ? metricsReason(machine.metricsWhy, machine.reachable) : null;
  const load = W.load(machine.running, machine.cap);
  const label = (offline ? [machine.name, word, why] : [machine.name, word, why, ...readings.map(([name, value]) => W.meter(name, value)), missing, load]).filter(Boolean).join(SEP);
  return (
    <li class={`row machine-row is-${machine.state}`} data-testid="row" data-role={machine.role}>
      <div class="row-body" aria-label={label}>
        <span class={`status-dot is-${machine.state}`} aria-hidden="true" />
        <span class="lines">
          <span class="title one-line">{machine.name}</span>
          <span class="sub">
            <span class="machine-state">{word}</span>
            {why ? <span class="machine-why">{`${SEP}${why}`}</span> : null}
          </span>
          {offline ? null : (
            <span class="mini-meters">
              {readings.map(([name, value]) => (
                <Meter key={name} label={name} value={value} />
              ))}
              {missing ? <span class="mini-none">{missing}</span> : null}
            </span>
          )}
        </span>
        {offline ? null : <span class="trail">{load}</span>}
      </div>
      {offline || machine.state === "down" ? null : (
        <div class="machine-restart">
          <button type="button" class="text-button" aria-label={W.restartServiceOf(machine.name)} onClick={() => openRestart(machine.name)}>
            {W.restartService}
          </button>
        </div>
      )}
      {offline ? null : (
        <div class="runner-grid" role="group" aria-label={`${machine.name} ${W.runners}`}>
          {machine.runners.map((runner) => (
            <RunnerCellView key={runner.name} machine={machine} runner={runner} />
          ))}
        </div>
      )}
      <ErrorLine line={note?.device === machine.name ? note.line : undefined} />
    </li>
  );
}

function personState(device: PersonDevice): string {
  if (device.reachable === true) return W.connected;
  if (device.reachable === false) return W.offline;
  return W.runnerWhy.unknown;
}

/** An owner's Mac: 연결 끊김 alone while unreachable; otherwise each tool once, with its version when the Mac read one. */
function PersonRow({ device }: { device: PersonDevice }) {
  const state = personState(device);
  const tools = device.reachable === false ? [] : device.tools.filter((tool, index) => device.tools.findIndex((other) => other.name === tool.name) === index);
  return (
    <li class="person-row">
      <span class="person-name">{device.name}</span>
      <span class={`person-state${device.reachable === false ? " is-off" : ""}`}>{state}</span>
      {tools.map((tool) => (
        <span key={tool.name} class="person-tool">
          {tool.installed ? `${tool.name} ${tool.installed}` : tool.name}
        </span>
      ))}
    </li>
  );
}

/** The watch's alert keys in words, each once: a station's own alert by its name, an unknown key as one 기타 경고. */
function powerAlertWords(power: PowerView): string[] {
  const name = (key: string) => power.stations.find((station) => station.key === key)?.name ?? W.powerAlert.device;
  const words = power.alerts.map((alert) => {
    const [kind, ...rest] = alert.split(":");
    const key = rest.join(":");
    if (alert === "power") return W.powerAlert.outage;
    if (alert === "watch:cloud") return W.powerAlert.cloud;
    if (kind === "temp" && key) return W.powerAlert.temp(name(key));
    if (kind === "offline" && key) return W.powerAlert.offline(name(key));
    if (kind === "watch" && rest[0] === "mqtt") return W.powerAlert.mqtt(name(rest.slice(1).join(":")));
    return W.powerAlert.other;
  });
  return [...new Set(words)];
}

/** A station's own alert keys name it after the colon (temp:<key>, offline:<key>, watch:mqtt:<key>). */
function stationAlerted(power: PowerView, station: PowerStation): boolean {
  return power.alerts.some((alert) => alert.split(":").at(-1) === station.key && alert.includes(":"));
}

/**
 * One power station: its battery level, input and output, temperature, charging state and the time left on battery.
 * A station without a battery reports only its link. A value too old to trust keeps its numbers, dimmed, with its age.
 */
function PowerStationRow({ power, station }: { power: PowerView; station: PowerStation }) {
  const state = station.connected === false ? "down" : stationAlerted(power, station) ? "warn" : "ok";
  const parts = station.battery
    ? [
        station.batteryPercent !== null ? W.percent(station.batteryPercent) : null,
        station.inputW !== null ? W.powerIn(station.inputW) : null,
        station.outputW !== null ? W.powerOut(station.outputW) : null,
        station.temperature !== null ? W.temperature(station.temperature) : null,
        station.charge ? W.powerCharge[station.charge] : null,
        station.remainingS !== null ? W.powerRunsOut(until(station.remainingS)) : null,
      ]
    : [station.connected === true ? W.connected : station.connected === false ? W.offline : W.runnerWhy.unknown];
  const line = parts.filter((part): part is string => Boolean(part));
  const age = station.stale ? (station.age !== null ? ago(station.age) : W.none) : null;
  return (
    <li class={`row power-row is-${state}${station.stale ? " is-stale" : ""}`} data-testid="power-station">
      <div class="row-body" aria-label={[station.name, ...line, age].filter(Boolean).join(SEP)}>
        <span class={`status-dot is-${state}`} aria-hidden="true" />
        <span class="lines">
          <span class="title one-line">{station.name}</span>
          <span class="sub">{line.join(SEP)}</span>
        </span>
        {age ? <span class="trail power-age">{age}</span> : null}
        {station.battery && station.batteryPercent !== null ? (
          <span class="meter" aria-hidden="true">
            <span class={`meter-fill${station.batteryPercent <= 20 ? " is-high" : ""}`} style={{ width: `${Math.min(100, Math.max(0, station.batteryPercent))}%` }} />
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** The hub's own line: its wall adapter, battery and uplink, dimmed when the watch stopped. */
function PowerHubRow({ hub }: { hub: NonNullable<PowerView["hub"]> }) {
  const line = [hub.wallAdapter !== null ? W.wallAdapter(hub.wallAdapter) : null, hub.batteryPercent !== null ? W.hubBattery(hub.batteryPercent) : null, hub.uplink ? W.uplink[hub.uplink] : null].filter(
    (part): part is string => Boolean(part),
  );
  return (
    <li class={`row power-hub${hub.stale ? " is-stale" : ""}`} data-testid="power-hub">
      <div class="row-body" aria-label={[W.hub, ...line].join(SEP)}>
        <span class="lines">
          <span class="title one-line">{W.hub}</span>
          <span class="sub">{line.join(SEP)}</span>
        </span>
      </div>
    </li>
  );
}

/** The record's age, or why it is not current: a stopped watch or a failed cloud read with its age, or no record. */
function powerHead(power: PowerView): string {
  const age = power.age !== null ? ago(power.age) : null;
  if (power.state === "missing") return W.powerMissing;
  if (power.state === "broken") return W.powerBroken;
  if (power.state === "stale") return [W.powerWhy[power.why ?? "stopped"] ?? W.powerWhy.stopped, age].filter(Boolean).join(SEP);
  return age ? W.powerFresh(age) : W.powerFresh(W.none);
}

/**
 * 전원: one card for the hub's power equipment, only when the core serves the section. Read only: no button, no form.
 * The head says how old the watch's record is; the stations follow, then the hub's own line, then the active alerts as
 * one red line.
 */
function PowerSection({ power }: { power: PowerView }) {
  const alerts = powerAlertWords(power);
  return (
    <section class={`list-section power-card is-${power.state}`} data-testid="section-power">
      <h2 class="section-head">
        <span>{W.power}</span>
      </h2>
      <p class={`power-head${power.state === "ok" ? "" : " is-late"}`} data-testid="power-head">
        {powerHead(power)}
      </p>
      {power.stations.length || power.hub ? (
        <ul class="rows" aria-label={W.power}>
          {power.stations.map((station) => (
            <PowerStationRow key={station.key} power={power} station={station} />
          ))}
          {power.hub ? <PowerHubRow hub={power.hub} /> : null}
        </ul>
      ) : null}
      {alerts.length ? (
        <p class="power-alerts warn-mark" data-testid="power-alerts">
          {W.powerAlerts(alerts)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One question before a restart: a bottom sheet on a phone, a small dialog on a wide window. Drawn beside the shell,
 * like the settings rollback, so the phone screen's view transition does not trap it.
 */
export function RestartSheet() {
  const { store } = useApp();
  const { ask } = useRestartState();
  useEffect(() => {
    return () => {
      restartAsk = null;
      deviceNote = null;
    };
  }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRestart();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask]);
  if (!ask) return null;
  const confirming = ask.step === "worker" || ask.step === "ocx";
  const send = () => {
    if (ask.step !== "worker" && ask.step !== "ocx") return;
    const { device, step } = ask;
    // Close before the post, so a second tap cannot send it twice. A 200 leaves the row as it was.
    restartAsk = null;
    publishRestart();
    void (async () => {
      const result = await store.source.restartDevice(device, step);
      deviceNote = result.ok ? null : { device, line: writeError("device", result) };
      publishRestart();
      await store.invalidate([["devices"]]);
    })();
  };
  return (
    <>
      <div class="settings-scrim" aria-hidden="true" onClick={closeRestart} />
      <div class="settings-sheet" role="dialog" aria-modal="true" aria-label={W.restart} data-testid="restart-sheet">
        {confirming ? (
          <>
            <p class="settings-sheet-text">{ask.step === "worker" ? W.restartWorkerConfirm : W.restartOcxConfirm}</p>
            <button type="button" class="settings-sheet-button" onClick={send}>
              {W.restart}
            </button>
          </>
        ) : (
          <>
            <button type="button" class="settings-sheet-button" onClick={() => chooseRestart("worker")}>
              {W.restartWorker}
            </button>
            <button type="button" class="settings-sheet-button" onClick={() => chooseRestart("ocx")}>
              {W.restartOcx}
            </button>
          </>
        )}
        <button type="button" class="settings-sheet-button" onClick={closeRestart}>
          {W.cancel}
        </button>
      </div>
    </>
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

/** A quota line's parts: the percent (or the word that stands in its place), the rate and the reset. */
function QuotaParts({ line, now, percent, rate = true }: { line: QuotaLine; now: number; percent: string | null; rate?: boolean }) {
  const parts: ComponentChildren[] = [];
  if (percent !== null) parts.push(<span key="p">{percent}</span>);
  if (rate && line.rate !== null)
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

/** An account's line: percent used, rate and reset as the service row reads them, or the state word that stands in. */
function AccountRow({ account, now }: { account: QuotaAccount; now: number }) {
  const window = mainWindow(account);
  const line: QuotaLine = { percent: window?.percent ?? null, rate: window?.ratePerHour ?? null, resetAt: window?.resetAt ?? null, warn: account.warn };
  // OCX cannot read an account that needs signing in again: nothing on it is current, so the row says only that. A
  // paused account keeps its reset (the window still resets) and drops the rate.
  const reauth = account.state === "reauth";
  const paused = account.state === "paused";
  const flags = [account.unavailable ? W.quotaUnavailable : null].filter((flag): flag is string => Boolean(flag));
  // One convention with the service row: the percent used. The state word stands in its place when OCX cannot use
  // the account, and the parts after it are the ones that still hold: the reset alone for a paused account.
  const percent = reauth ? W.quotaReauth : paused ? W.quotaPaused : line.percent !== null ? W.percent(line.percent) : null;
  const parts = [percent, !reauth && !paused && line.rate !== null ? W.ratePerHour(line.rate) : null, line.resetAt !== null ? until(line.resetAt - now) : null].filter((part): part is string => Boolean(part));
  const spoken = [W.quotaAccount(account.number), ...flags, ...parts, account.warn ? W.quotaWarn : null].filter(Boolean).join(SEP);
  return (
    <li class={`account-row${account.warn ? " is-warn" : ""}`} data-testid="account" aria-label={spoken}>
      <span class="lines">
        <span class="title one-line">{[W.quotaAccount(account.number), ...flags].join(SEP)}</span>
        <span class="sub">
          {reauth ? <span class="warn-mark">{W.quotaReauth}</span> : <QuotaParts line={line} now={now} percent={percent} rate={!paused} />}
        </span>
      </span>
      {account.warn ? <span class="trail warn-mark">{W.quotaWarn}</span> : null}
      {reauth ? null : <QuotaMeter line={line} />}
    </li>
  );
}

function QuotaRow({ service }: { service: QuotaService }) {
  const { now } = useApp();
  const name = serviceName(service.service);
  // The core's rule (lina_board_quota.quota_view) for a service row: the mean over the accounts that are not paused
  // and have a main window. The row's percent and rate come from the core; its reset and warning from those accounts.
  const live = service.accounts
    .filter((account) => !account.paused)
    .map((account) => mainWindow(account))
    .filter((window): window is QuotaAccount["windows"][number] => window !== undefined);
  const resets = live.map((window) => window.resetAt).filter((at): at is number => at !== null);
  const line: QuotaLine = { percent: service.percent, rate: service.ratePerHour, resetAt: resets.length ? Math.min(...resets) : null, warn: live.some((window) => window.warn) };
  return (
    <li class={`row quota-row${line.warn ? " is-warn" : ""}`} data-testid="row">
      <details class="quota-fold">
        <summary class="row-body" aria-label={[name, ...quotaText(line, now), line.warn ? W.quotaWarn : ""].filter(Boolean).join(SEP)}>
          <span class="lines">
            <span class="title one-line">{name}</span>
            <span class="sub">
              <QuotaParts line={line} now={now} percent={line.percent !== null ? W.percent(line.percent) : null} />
            </span>
          </span>
          {line.warn ? <span class="trail warn-mark">{W.quotaWarn}</span> : null}
          <Disclosure />
          <QuotaMeter line={line} />
        </summary>
        <ul class="accounts" aria-label={name}>
          {service.accounts.map((account) => (
            <AccountRow key={account.id} account={account} now={now} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/**
 * The writer of the checked lines stopped (lina-app#150): the owner cannot act on it, so it is one row here and never a
 * word beside the header.
 */
function SummariesRow() {
  return (
    <li class="row status-check-row is-stale" data-testid="summaries-check">
      <div class="row-body" aria-label={W.summariesStopped}>
        <span class="lines">
          <span class="title one-line">{W.summariesStopped}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * A failing, stale or unreadable check: one row, its name and line, then the state word and how long ago.
 * Its own class, not `check-row`: that one indents a to-do row past its check box and lets the text size the row.
 */
function CheckRow({ check }: { check: OpenCheck }) {
  const { now } = useApp();
  const word = W.checkState[check.state] ?? "";
  return (
    <li class={`row status-check-row is-${check.state}`} data-testid="row">
      <div class="row-body" aria-label={[check.title, word, ago(now - check.at)].filter(Boolean).join(SEP)}>
        <span class="lines">
          <span class="title one-line">{check.title}</span>
        </span>
        <span class="trail">
          <span class={`check-state is-${check.state}`}>{word}</span>
          <span class="time">{ago(now - check.at)}</span>
        </span>
      </div>
      {check.original ? (
        <details class="check-more">
          <summary>{W.checkMore}</summary>
          <p class="check-original">{check.original}</p>
        </details>
      ) : null}
    </li>
  );
}

/** One line of the usage panel: a model or a machine, its estimated cost and its tokens. */
function UsageRowView({ line }: { line: UsageLine }) {
  const text = W.usageLine(line.name, W.cost(line.cost), W.tokens(line.tokens));
  return (
    <li class="row usage-row" data-testid="row">
      <div class="row-body" aria-label={text}>
        <span class="lines">
          <span class="title one-line">{text}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * 사용량: one control per range (오늘 first), the range's totals, then its costliest models and machines. The core
 * serves no per-agent split (lina#232), so the panel draws none and says nothing about agents.
 */
function UsagePanel() {
  const { model } = useApp();
  const [range, setRange] = useState<UsageRange>("today");
  const view = model.usage.find((each) => each.range === range) ?? model.usage[0];
  if (!view) return null;
  return (
    <section class="list-section" data-testid="section-usage">
      <h2 class="section-head">
        <span>{W.usage}</span>
      </h2>
      <div class="usage-range" role="group" aria-label={W.usage}>
        {USAGE_RANGES.map((each) => (
          <button key={each} type="button" class="choice usage-range-choice" aria-pressed={each === view.range} onClick={() => setRange(each)}>
            {W.usageRange[each]}
          </button>
        ))}
      </div>
      <p class="usage-total" data-testid="usage-total">
        {W.usageTotal(W.cost(view.cost), W.tokens(view.tokens))}
      </p>
      <h3 class="usage-head">{W.usageByModel}</h3>
      <ul class="rows usage-list" aria-label={W.usageByModel}>
        {view.models.map((line) => (
          <UsageRowView key={line.name} line={line} />
        ))}
      </ul>
      <h3 class="usage-head">{W.usageByMachine}</h3>
      <ul class="rows usage-list" aria-label={W.usageByMachine}>
        {view.machines.map((line) => (
          <UsageRowView key={line.name} line={line} />
        ))}
      </ul>
    </section>
  );
}

/** A quota list row that is not a service: a service OCX holds no account for, or OCX's own line. */
function PlainQuotaRow({ text, testid }: { text: string; testid: string }) {
  return (
    <li class="row" data-testid={testid}>
      <div class="row-body" aria-label={text}>
        <span class="lines">
          <span class="title one-line">{text}</span>
        </span>
      </div>
    </li>
  );
}

export function StatusScreen() {
  const { model, store } = useApp();
  // The runners read by the settings screen's names, so the settings are read here too.
  useEffect(() => store.ensure([["settings"]]), [store]);
  // The quota panel is the service rows, then one row for each service OCX holds no account for, then OCX's own row.
  // A failed quota read leaves neither a service nor a missing service, so the panel stays away with OCX's row.
  const hasQuota = model.quota.length + model.quotaMissing.length > 0;
  // Work nodes, then the file node. Person devices are a group of their own and are not machine rows.
  const nodes = [...model.machines].sort((a, b) => Number(a.role === "files") - Number(b.role === "files"));
  const { all, ok, warn, down } = model.counts.devices;
  const connected = model.person.filter((device) => device.reachable === true).length;
  const offline = model.person.filter((device) => device.reachable === false).length;
  return (
    <div class="list" data-testid="screen-status">
      <section class="list-section" data-testid="section-machines">
        <h2 class="section-head">
          <span>{W.workDeviceHead(all, ok, warn, down)}</span>
        </h2>
        <ul class="rows" aria-label={W.devices}>
          {nodes.map((machine) => (
            <MachineRow key={machine.name} machine={machine} />
          ))}
        </ul>
      </section>
      {model.person.length ? (
        <section class="list-section" data-testid="section-person">
          <h2 class="section-head">
            <span>{W.personHead(model.person.length, connected, offline)}</span>
          </h2>
          <ul class="rows" aria-label={W.myDevices}>
            {model.person.map((device) => (
              <PersonRow key={device.name} device={device} />
            ))}
          </ul>
        </section>
      ) : null}
      {model.power ? <PowerSection power={model.power} /> : null}
      {hasQuota ? (
        <section class="list-section" data-testid="section-quota">
          <h2 class="section-head">
            <span>{W.quota}</span>
          </h2>
          <ul class="rows" aria-label={W.quota}>
            {model.quota.map((service) => (
              <QuotaRow key={service.service} service={service} />
            ))}
            {model.quotaMissing.map((service) => (
              <PlainQuotaRow key={service} testid="quota-missing" text={W.quotaMissing(serviceName(service))} />
            ))}
            {model.ocx ? <PlainQuotaRow testid="ocx-line" text={W.ocxLine(model.ocx.enabled, model.ocx.down)} /> : null}
          </ul>
        </section>
      ) : null}
      <UsagePanel />
      <section class="list-section" data-testid="section-checks">
        <h2 class="section-head">
          <span>{W.checks}</span>
        </h2>
        {model.checks.total || model.summariesStopped ? (
          <ul class="rows" aria-label={W.checks}>
            {model.summariesStopped ? <SummariesRow /> : null}
            {model.checks.open.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
            {model.checks.ok ? (
              <li class="row status-check-fold" data-testid="row">
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
