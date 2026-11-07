import type { ComponentChildren } from "preact";
import { USAGE_RANGES, type Machine, type PersonDevice, type QuotaAccount, type QuotaService, type RunnerCell, type UsageRange } from "../api/client";
import type { CardRow, DueRow, GoalRow, InboxRow } from "../model";
import { agentView, doneFor } from "../model";
import type { OpenCheck } from "../model/checks";
import type { UsageLine } from "../model/usage";
import { href, navigate } from "../router";
import { ago, dayLabel, until } from "../time";
import { useEffect, useState } from "preact/hooks";
import { KoreanInput } from "../korean-input";
import { useActions } from "../ui/actions";
import { AgentMark, agentName, CardRowView, CountPair, Dial, Disclosure, DoneCheck, Empty, ErrorLine, Link, ListSection, useApp } from "../ui/parts";
import { machineWhy, runnerReason, serviceName, SEP, W } from "../words";
import { writeError } from "./write-error";

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
 * A fine runner shows its installed version and the signed-in mark.
 * The sign-in button shows only for why sign_in, or for a signed-out runner with no why. Any other why shows its reason.
 * 로그인 중 has no button while the post is in flight or the core still reports signingIn. When that turns false,
 * a signed-in runner shows the mark; a sign-in cell shows the reason and the button again.
 */
function RunnerCellView({ machine, runner }: { machine: Machine; runner: RunnerCell }) {
  const { store } = useApp();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const signingIn = posting || runner.signingIn;
  // The read right after 202 shows signingIn. One more read is the one that can show the sign-in ended.
  useEffect(() => {
    if (!runner.signingIn) return;
    void store.invalidate([["devices"]]);
  }, [runner.signingIn, store]);
  const fine = !signingIn && !runner.why && (runner.signIn === "signed_in" || runner.signIn === "api_key" || runner.signIn === "ocx");
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
      <span class="runner-name">{runner.name}</span>
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
      ) : (
        <span class="runner-detail">{runnerReason(runner.why)}</span>
      )}
      {error ? <ErrorLine line={error} /> : null}
    </div>
  );
}

function MachineRow({ machine }: { machine: Machine }) {
  const { note } = useRestartState();
  const word = W.machineState[machine.state] ?? "";
  const why = machineWhy(machine.why);
  const meters = [
    [W.cpu, machine.cpu],
    [W.memory, machine.memory],
    [W.disk, machine.disk],
  ] as const;
  const label = [machine.name, word, why, ...meters.map(([name, value]) => W.meter(name, value)), W.load(machine.running, machine.cap)].filter(Boolean).join(SEP);
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
          <span class="mini-meters">
            {meters.map(([name, value]) => (
              <Meter key={name} label={name} value={value} />
            ))}
          </span>
        </span>
        <span class="trail">{W.load(machine.running, machine.cap)}</span>
      </div>
      <div class="machine-restart">
        <button type="button" class="text-button" aria-label={W.restartOf(machine.name)} onClick={() => openRestart(machine.name)}>
          {W.restart}
        </button>
      </div>
      <div class="runner-grid" role="group" aria-label={`${machine.name} ${W.runners}`}>
        {machine.runners.map((runner) => (
          <RunnerCellView key={runner.name} machine={machine} runner={runner} />
        ))}
      </div>
      <ErrorLine line={note?.device === machine.name ? note.line : undefined} />
    </li>
  );
}

function personState(device: PersonDevice): string {
  if (device.reachable === true) return W.connected;
  if (device.reachable === false) return W.offline;
  return W.runnerWhy.unknown;
}

function PersonRow({ device }: { device: PersonDevice }) {
  const state = personState(device);
  return (
    <li class="person-row">
      <span class="person-name">{device.name}</span>
      <span class={`person-state${device.reachable === false ? " is-off" : ""}`}>{state}</span>
      {device.tools.map((tool) => (
        <span key={tool.name} class="person-tool">
          {`${tool.name} ${tool.installed ?? W.none}`}
        </span>
      ))}
    </li>
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
 * A failing, stale or unreadable check: one row, its name and line, then the state word and how long ago.
 * Its own class, not `check-row`: that one indents a to-do row past its check box and lets the text size the row.
 */
function CheckRow({ check }: { check: OpenCheck }) {
  const { now } = useApp();
  const word = W.checkState[check.state] ?? "";
  return (
    <li class={`row status-check-row is-${check.state}`} data-testid="row">
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
  const { model } = useApp();
  // The quota panel is the service rows, then one row for each service OCX holds no account for, then OCX's own row.
  // A failed quota read leaves neither a service nor a missing service, so the panel stays away with OCX's row.
  const hasQuota = model.quota.length + model.quotaMissing.length > 0;
  // Work nodes, then the file node. Person devices are a group of their own and are not machine rows.
  const nodes = [...model.machines].sort((a, b) => Number(a.role === "files") - Number(b.role === "files"));
  return (
    <div class="list" data-testid="screen-status">
      <section class="list-section" data-testid="section-machines">
        <h2 class="section-head">
          <span>{W.devices}</span>
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
            <span>{W.myDevices}</span>
          </h2>
          <ul class="rows" aria-label={W.myDevices}>
            {model.person.map((device) => (
              <PersonRow key={device.name} device={device} />
            ))}
          </ul>
        </section>
      ) : null}
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
        {model.checks.total ? (
          <ul class="rows" aria-label={W.checks}>
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
