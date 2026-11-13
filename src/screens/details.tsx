import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ItemDetail, ItemSummary, WorkCardDetail, WorkState } from "../api/client";
import { KoreanInput } from "../korean-input";
import { cardName, cardTitle, goalCards, runRow, type CardRow, type Model } from "../model";
import { foldReason } from "../model/fold";
import { holds } from "../model/rounds";
import { stopReason } from "../model/stop-reason";
import { firstSentence, goalHistory, outcomeOf } from "../model/timeline";
import type { CardKind } from "../model/kind";
import { isRunId } from "../data/store";
import { href } from "../router";
import { ago, clockAt } from "../time";
import { useActions } from "../ui/actions";
import { agentName, Box, CardRowView, CheckBox, DoneCheck, ErrorLine, KindMark, Link, Progress, sinceText, StateText, StateTime, cardTime, cardTook, stateWords, useApp } from "../ui/parts";
import { SEP, STATE_WORD, stateLabel, W } from "../words";
import { PastEvents, RunModelLine, Timeline, type PastEvent } from "./timeline";
import { Comments, SendButton } from "./comments";
import { Talk } from "./talk";

function Missing() {
  return <p class="empty">{W.notFound}</p>;
}

function Loading() {
  return (
    <p class="empty" data-testid="detail-loading">
      {W.loading}
    </p>
  );
}

function Header({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="detail-head">
      <h1 class="detail-title">{title}</h1>
      {children}
    </header>
  );
}

/** A pending decision or a card's question, drawn the same way on a goal, a to-do or a work card. */
function DecisionBox({ text, agent, ask, at }: { text: string; agent: string | null; ask: boolean; at: number | null }) {
  const { model, now } = useApp();
  return (
    <Box title={W.decide} testid="decision">
      <p class="box-text">{text}</p>
      <span class="sub">{[agentName(model, agent), ask ? W.ask : W.act, at ? ago(now - at) : null].filter(Boolean).join(SEP)}</span>
    </Box>
  );
}

/**
 * Where the owner answers, in the detail frame (lina-app#142): the choices, or a field with 보내기. The answer goes
 * the way it goes from 수신함 (Actions.answer, keyed as its 수신함 row), so the row leaves there too.
 */
function AnswerPlace({ answerKey, target, label, choices = [], recommended = null, testid }: { answerKey: string; target: { kind: "item" | "card"; id: string }; label: string; choices?: readonly string[]; recommended?: string | null; testid: string }) {
  const actions = useActions();
  const error = actions.error(answerKey);
  const [text, setText] = useState(error?.text ?? "");
  const busy = actions.busy(answerKey);
  const send = (answer: string) => {
    const body = answer.trim();
    if (!body || busy) return;
    actions.answer(answerKey, target, body);
    setText("");
  };
  return (
    <div class="answer-place" data-testid={testid}>
      {choices.length ? (
        <div class="choices" role="group" aria-label={label}>
          {choices.map((choice) => (
            <button key={choice} type="button" class="choice" disabled={busy} aria-label={choice === recommended ? `${choice}${SEP}${W.recommended}` : choice} onClick={() => send(choice)}>
              {choice}
              {choice === recommended ? <span class="tag">{W.recommended}</span> : null}
            </button>
          ))}
          {busy ? (
            <span class="send-why" data-testid="send-why">
              {W.sendWhyBusy}
            </span>
          ) : null}
        </div>
      ) : (
        <form
          class="comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(text);
          }}
        >
          <KoreanInput label={label} value={text} onValue={setText} inline />
          <SendButton busy={busy} empty={!text.trim()} />
        </form>
      )}
      <ErrorLine line={error?.line} />
    </div>
  );
}

function ItemDecision({ detail }: { detail: ItemDetail }) {
  if (!detail.decision || detail.decision.answered) return null;
  return (
    <>
      <DecisionBox text={detail.decision.text} agent={detail.agent} ask={detail.decision.kind === "ask"} at={detail.decision.at} />
      <AnswerPlace answerKey={`decide:${detail.id}`} target={{ kind: "item", id: detail.id }} label={W.answerField} choices={detail.decision.choices} recommended={detail.decision.recommended} testid="decision-answer" />
    </>
  );
}

/** A history (기록) row: `time · one sentence` on one line (lina-app#123). */
function HistoryLine({ at, text, kind, who }: { at: number; text: string; kind?: string; who?: string }) {
  const { now } = useApp();
  return (
    <li class="history-row one-line" data-testid="history-row" data-kind={kind} title={who || undefined}>
      {[clockAt(at, now), text].join(SEP)}
    </li>
  );
}

/** The head's check box with its state line, 되돌리기 while the owner's mark can be taken back, and a goal's question. */
function DoneHead({ detail }: { detail: ItemDetail }) {
  const actions = useActions();
  const { now } = useApp();
  const [asking, setAsking] = useState(false);
  const open = detail.kind === "goal" ? detail.children.filter((child) => !actions.isDone(child.id, child.state === "done")).map((child) => child.id) : [];
  const withIds = detail.ownerDone?.with ?? [];
  const shown = actions.isDone(detail.id, detail.state === "done");
  const until = actions.undoUntil(detail.id, detail.ownerDone?.undoUntil);
  const showUndo = shown && until !== null && now < until && actions.toast?.owner !== detail.id;
  return (
    <>
      <div class="head-check">
        <DoneCheck id={detail.id} title={detail.title} done={detail.state === "done"} undoUntil={detail.ownerDone?.undoUntil} withOpen={withIds} openTodos={open.length} onOpenTodos={() => setAsking(true)} />
        <StateTime state={detail.state} reason={detail.reason} time={sinceText(detail.state, detail.stateSince, now)} />
        {showUndo ? (
          <button type="button" class="text-button head-undo" disabled={actions.busy(`done:${detail.id}`)} onClick={() => void actions.undoDone(detail.id, withIds)}>
            {W.undo}
          </button>
        ) : null}
      </div>
      {asking ? (
        <div class="confirm" role="group" aria-label={W.withOpenQuestion(open.length)} data-testid="with-open">
          <p class="box-text">{W.withOpenQuestion(open.length)}</p>
          <div class="confirm-buttons">
            <button
              type="button"
              class="text-button"
              onClick={() => {
                setAsking(false);
                void actions.markDone(detail.id, open);
              }}
            >
              {W.withOpen}
            </button>
            <button type="button" class="text-button is-plain" onClick={() => setAsking(false)}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : null}
      <ErrorLine line={actions.error(`done:${detail.id}`)?.line} />
    </>
  );
}

function TodoLine({ todo }: { todo: ItemSummary }) {
  const actions = useActions();
  const { now } = useApp();
  const shown = actions.isDone(todo.id, todo.state === "done");
  return (
    <li class={`row check-row${shown ? " is-checked" : ""}`} data-testid="row">
      <DoneCheck id={todo.id} title={todo.title} done={todo.state === "done"} />
      <Link href={href({ name: "item", id: todo.id })} label={[todo.title, stateLabel(todo.state, todo.reason)].join(SEP)}>
        <span class="lines">
          <span class="title one-line">{todo.title}</span>
          <StateTime state={todo.state} reason={todo.reason} time={sinceText(todo.state, todo.stateSince, now)} />
        </span>
      </Link>
      <ErrorLine line={actions.error(`done:${todo.id}`)?.line} />
    </li>
  );
}

function GoalBody({ detail }: { detail: ItemDetail }) {
  const { model, store } = useApp();
  const { cards, evidence } = goalCards(model, detail, {
    goals: detail.workCards.map((id) => store.get("goal", id)).filter((goal) => goal !== undefined),
  });
  const words = [detail.why, ...detail.basis.map((basis) => basis.text)].filter((text, index, all): text is string => Boolean(text) && all.indexOf(text) === index);
  // Its merges (the finished cards' evidence), question, runs, comments and close, one line each.
  const history = goalHistory(detail, evidence);
  return (
    <article class="detail" data-testid="screen-goal">
      <Header title={detail.title}>
        <DoneHead detail={detail} />
      </Header>
      <ItemDecision detail={detail} />
      {detail.doneCondition ? (
        <Box title={W.doneCondition}>
          <p class="box-text">{detail.doneCondition}</p>
        </Box>
      ) : null}
      {words.length ? (
        <details class="box fold">
          <summary class="box-head">{W.ownerWords}</summary>
          {words.map((text) => (
            <p key={text} class="box-text">
              {text}
            </p>
          ))}
        </details>
      ) : null}
      {detail.children.length ? (
        <Box title={W.todos}>
          <ul class="rows checklist" aria-label={W.todos}>
            {detail.children.map((todo) => (
              <TodoLine key={todo.id} todo={todo} />
            ))}
          </ul>
        </Box>
      ) : null}
      {cards.count ? (
        <Box title={W.cards}>
          <ul class="rows" aria-label={W.cards}>
            {cards.rows.map((card) => (
              <CardRowView key={card.key} card={card} />
            ))}
          </ul>
        </Box>
      ) : null}
      {history.length ? (
        <Box title={W.record} testid="goal-history">
          <ul class="history-rows" aria-label={W.record}>
            {history.map((row, index) => (
              <HistoryLine key={`${row.at}:${index}`} at={row.at} text={row.text} kind={row.kind} />
            ))}
          </ul>
        </Box>
      ) : null}
      <Comments detail={detail} />
      <Talk key={detail.id} detail={detail} />
    </article>
  );
}

function TodoBody({ detail }: { detail: ItemDetail }) {
  const { model } = useApp();
  return (
    <article class="detail" data-testid="screen-item">
      <Header title={detail.title}>
        <DoneHead detail={detail} />
      </Header>
      <ItemDecision detail={detail} />
      {detail.doneCondition ? (
        <Box title={W.doneCondition}>
          <p class="box-text">{detail.doneCondition}</p>
        </Box>
      ) : null}
      {detail.runs.length ? (
        <Box title={W.runs}>
          <ul class="rows" aria-label={W.runs}>
            {detail.runs.map((run) => {
              const owner = model.runOwner.get(run.id);
              const target = owner ? href({ name: "card", id: owner }) : href({ name: "run", id: run.id });
              return (
                <li key={run.id} class="row run-line" data-testid="row">
                  <Link href={target} label={[runName(model, run), stateLabel(run.state, run.reason)].join(SEP)}>
                    <span class="lines">
                      <span class="one-line">
                        <span class="title">{runName(model, run)}</span>
                        <span class="sub">
                          {SEP}
                          <StateText state={run.state} reason={run.reason} />
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Box>
      ) : null}
      <Comments detail={detail} />
      <Talk key={detail.id} detail={detail} />
    </article>
  );
}

export function ItemScreen({ id }: { id: string }) {
  const { store } = useApp();
  const detail = store.get("item", id);
  const status = store.status("item", id);
  if (!detail) return status === "missing" ? <Missing /> : <Loading />;
  return detail.kind === "goal" ? <GoalBody detail={detail} /> : <TodoBody detail={detail} />;
}

export const GoalScreen = ItemScreen;

/**
 * A work card's head: its kind icon and word, its name (the checked title, or the card's own title until that exists
 * and may be drawn; a run without a checked title keeps its kind word in grey) and its state line.
 */
function CardHead({ work, title, untitled, children }: { work: CardKind; title: string | null; untitled?: string; children: ComponentChildren }) {
  return (
    <header class="detail-head">
      <KindMark work={work} word />
      <h1 class={title ? "detail-title" : "detail-title is-kind"}>{title ? cardName(title, work) : (untitled ?? cardName(null, work))}</h1>
      {children}
    </header>
  );
}

interface Round {
  readonly n: number;
  /** Null when the round's start fell out of the kept history ('시작 기록 없음'). */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** The round's run still beats (the core's run_is_live). */
  readonly live: boolean;
  /** The line the round left (its summary), drawn dimmed under its head; null when it left none. */
  readonly line: string | null;
  readonly workers: readonly string[];
}

/**
 * The card's worker runs by follow-up round, newest round first: a worker run belongs to the round whose own start
 * and end hold its first sighting (a round with no start on record holds what was first seen before its end). The
 * one place the rounds' boundaries are decided. A round shows only when it holds content: a worker run, or for a
 * round with no start a line it said (its summary); a run that never started or a kept end alone draws nothing.
 * Worker runs outside every round follow, without a round head.
 */
export function workerRounds(detail: Pick<WorkCardDetail, "runs" | "workerRuns">): { rounds: Round[]; outside: string[] } {
  const startOf = (run: WorkCardDetail["runs"][number]) => (run.startedAt > 0 ? run.startedAt : null);
  const ordered = [...detail.runs].sort((a, b) => (startOf(a) ?? a.endedAt ?? 0) - (startOf(b) ?? b.endedAt ?? 0));
  const placed = new Set<string>();
  const rounds = ordered.map((run, index) => {
    const start = startOf(run);
    const workers = detail.workerRuns
      .filter((worker) => !placed.has(worker.id) && holds({ start, end: run.endedAt }, worker.firstSeenAt))
      .map((worker) => worker.id);
    for (const worker of workers) placed.add(worker);
    const content = workers.length > 0 || (start === null && Boolean(run.summary?.trim()));
    return { round: { n: index + 1, startedAt: start, endedAt: run.endedAt, live: run.live, line: run.summary?.trim() || null, workers } satisfies Round, content };
  });
  return {
    rounds: rounds.filter(({ content }) => content).map(({ round }) => round).reverse(),
    outside: detail.workerRuns.map((worker) => worker.id).filter((worker) => !placed.has(worker)),
  };
}

/**
 * A round's head: its own start and end, each with its day when that is not today (어제 23:41), with no round number
 * (lina-app#61).
 */
export function roundHead(round: Round, now: number): string {
  if (round.startedAt === null) return W.noStart;
  const span = round.endedAt === null ? clockAt(round.startedAt, now) : `${clockAt(round.startedAt, now)}–${clockAt(round.endedAt, now)}`;
  // A round with no end is running only while its run beats; otherwise it stopped, and the head says so.
  const state = round.endedAt !== null ? "" : round.live ? STATE_WORD.in_progress : STATE_WORD.stopped;
  return [span, state].filter(Boolean).join(SEP);
}

/**
 * One comment on a work card, one history line: its time and its first sentence, with any id, hash, path or command
 * taken out (lina-app#142); its author is the line's tooltip. Only a comment with no sentence left reads 접힌 댓글.
 */
function CardComment({ comment }: { comment: WorkCardDetail["comments"][number] }) {
  const { model } = useApp();
  return <HistoryLine at={comment.createdAt} text={firstSentence(comment.body) ?? W.folded} kind="comment" who={agentName(model, comment.author)} />;
}

/** A detail head's state line: a stopped one reads the words and the time its list row reads (stopReason, cardTime). */
function HeadState({ state, reason, row, time }: { state: WorkState; reason: string | null; row: CardRow | undefined; time: string }) {
  const stop = state === "stopped" && row?.stop ? { ...row.stop, words: stopReason(row).word } : undefined;
  return <StateTime state={state} reason={reason} stop={stop} time={time} />;
}

/**
 * A round's worker runs, one line each: when it started and what happened, never the card's title again (the card's
 * head carries it, lina-app#142). The board does not list the worker runs a card started (only runs outside any
 * card), so such a run is still drawn as a link to its own page: no worker row is ever left out because its target
 * is not in a list.
 */
function WorkerRows({ ids, model, seen, state }: { ids: readonly string[]; model: Model; seen: (runId: string) => number | null; state: (runId: string) => string }) {
  const { now } = useApp();
  return (
    <ul class="rows" aria-label={W.workerRuns}>
      {ids.map((workerId) => {
        const run = model.runs.get(workerId);
        const row = run ? runRow(run) : null;
        const at = run?.startedAt ?? seen(workerId);
        const line = [at ? clockAt(at, now) : "", row ? stateWords(row.state, row.reason, row.stop) : state(workerId)].filter(Boolean).join(SEP);
        return (
          <li key={workerId} class="row card-row is-dim" data-testid="row">
            <Link href={row?.href ?? href({ name: "run", id: workerId })} label={line}>
              <span class="lines">
                <span class="sub one-line">{line}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The title of a worker run the board does not list: the core serves no title of its own for it, so it reads the title
 * of the work card it ran for, or 제목 없음 when no card names it (never 코드 작업, lina-app#61 and #128).
 */
export function workerTitle(model: Model, cardId: string | null | undefined): string {
  return (cardId ? model.cards.get(cardId)?.own : null) || W.untitledRun;
}

/** A to-do's run by the one naming rule: its checked title when the board lists it, never raw text in its place. */
function runName(model: Model, run: ItemDetail["runs"][number]): string {
  const listed = model.runs.get(run.id);
  if (listed) return runRow(listed).name;
  return foldReason(run.title) ? workerTitle(model, model.runOwner.get(run.id)) : run.title;
}

/** Whether a worker run still goes: its own state, or for a run the board does not list, its card's. */
function runLive(model: Model, runId: string): boolean {
  const run = model.runs.get(runId);
  if (run) return run.state === "in_progress";
  const owner = model.runOwner.get(runId);
  return owner ? model.cards.get(owner)?.state === "in_progress" : false;
}

export function CardScreen({ id }: { id: string }) {
  const { model, store, now } = useApp();
  const detail = store.get("card", id);
  const row = model.cards.get(id);
  if (!detail) {
    if (store.status("card", id) === "missing") return <Missing />;
    if (!row) return <Loading />;
    // The card's detail is read only now that it is open: its list row's head and now line show while it comes.
    return (
      <article class="detail" data-testid="screen-card">
        <CardHead work={row.work} title={row.title}>
          <HeadState state={row.state} reason={row.reason} row={row} time={[cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP)} />
        </CardHead>
        {row.now && row.state === "in_progress" ? (
          <Box title={W.now} testid="card-now">
            <p class="box-text">{row.now}</p>
          </Box>
        ) : null}
        <Loading />
      </article>
    );
  }
  const questions = (store.get("inbox")?.questions ?? []).filter((question) => question.cardId === id);
  // A worker run id the hub served may be a word of a command in the card's text (status, wait): not a run, never
  // read or drawn; a run listed twice is one run (lina-app#128).
  const workerRuns = detail.workerRuns.filter((worker, index, all) => isRunId(worker.id) && all.findIndex((other) => other.id === worker.id) === index);
  const { rounds, outside } = workerRounds({ runs: detail.runs, workerRuns });
  // The state word of a worker run the board does not list: going while it beats, else how its round ended.
  const workerState = (runId: string) => {
    if (runLive(model, runId)) return STATE_WORD.in_progress;
    const round = rounds.find((candidate) => candidate.workers.includes(runId));
    if (!round) return W.outcome.unknown;
    return round.endedAt !== null ? W.outcome.ended : STATE_WORD.stopped;
  };
  const seen = (runId: string) => workerRuns.find((worker) => worker.id === runId)?.firstSeenAt ?? null;
  // A stop that waits on the owner's answer has the place to answer right here (lina-app#142).
  const ask = row ? stopReason(row).ask : undefined;
  // The worker run a round was: the same run its head opens. A card's 기록 holds several runs' rounds in one record.
  const roundRun = (runId: string, n: number) => rounds.find((round) => round.n === n)?.workers[0] ?? runId;
  // The goal (project) the card serves, in its head; a goal title that would show raw text is left out.
  const goal = store.get("goals")?.goals.find((candidate) => candidate.workCards.some((card) => card.id === id));
  const goalLine = goal && !foldReason(goal.title) ? goal.title : null;
  return (
    <article class="detail" data-testid="screen-card">
      <CardHead work={row?.work ?? "code"} title={cardTitle(detail.plain.title, detail.title, detail.state === "stopped")}>
        <HeadState state={detail.state} reason={detail.reason} row={row} time={row ? [cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP) : ""} />
        {goalLine ? (
          <span class="sub" data-testid="card-goal">
            {[W.goals, goalLine].join(SEP)}
          </span>
        ) : null}
        {detail.state === "in_progress" && detail.todoProgress.total > 0 ? <Progress done={detail.todoProgress.done} total={detail.todoProgress.total} word /> : null}
      </CardHead>
      {questions.map((question) => (
        <DecisionBox key={question.commentId} text={question.body} agent={question.agent} ask at={question.askedAt} />
      ))}
      {ask ? (
        <Box>
          <AnswerPlace answerKey={questions[0] ? `question:${id}:${questions[0].commentId}` : `answer:${id}`} target={{ kind: "card", id }} label={ask} testid="card-answer" />
        </Box>
      ) : null}
      {detail.plain.now && detail.state === "in_progress" ? (
        <Box title={W.now} testid="card-now">
          <p class="box-text">{detail.plain.now}</p>
        </Box>
      ) : null}
      {/* A box shows only when it adds something: the checked to-dos and the first open one are the list below, so
          끝난 것 carries only the result line and 다음 never repeats a to-do. */}
      {detail.plain.result ? (
        <Box title={W.doneSoFar} testid="card-done-so-far">
          <p class="box-text">{detail.plain.result}</p>
        </Box>
      ) : null}
      {detail.todos.length ? (
        <Box title={W.todos}>
          <ul class="rows checklist" aria-label={W.todos}>
            {detail.todos.map((todo) => (
              <li key={todo.id} class="row check-row" data-testid="row">
                <CheckBox done={todo.done} />
                <span class="lines">
                  <span class="title one-line">{todo.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </Box>
      ) : null}
      {/* One round list: the record's blocks (기록), each head the link to its worker run. 실행 stands only while the
          record is not shown, and under its error line when the read failed, so the worker links never disappear. */}
      <Timeline
        runs={workerRuns.map((worker) => worker.id)}
        live={(runId) => runLive(model, runId)}
        link={(runId, n) => href({ name: "run", id: roundRun(runId, n) })}
        modelRun={roundRun}
        fallback={
          workerRuns.length ? (
            <Box title={W.workerRuns} testid="worker-runs">
              {rounds.map((round) => (
                <section key={round.n} class={round.startedAt === null ? "round is-no-start" : "round"} data-testid="round">
                  <h3 class="round-head">{roundHead(round, now)}</h3>
                  {/* The round's own line is its content; one that would show a path or a command reads 접힌 댓글. */}
                  {round.line ? <p class="round-line" data-testid="round-line">{foldReason(round.line) ? W.folded : round.line}</p> : null}
                  {round.workers.length ? <WorkerRows ids={round.workers} model={model} seen={seen} state={workerState} /> : null}
                </section>
              ))}
              {outside.length ? <WorkerRows ids={outside} model={model} seen={seen} state={workerState} /> : null}
            </Box>
          ) : null
        }
      />
      {detail.comments.length ? (
        <Box title={W.comments} testid="card-comments">
          <ul class="history-rows" aria-label={W.comments}>
            {detail.comments.map((comment) => (
              <CardComment key={comment.id} comment={comment} />
            ))}
          </ul>
        </Box>
      ) : null}
    </article>
  );
}

/** A worker run a card started: the board does not list it, so its page is its card and its own record. */
function CardRunScreen({ id, cardId, cardLoading = false }: { id: string; cardId?: string | null; cardLoading?: boolean }) {
  const { model, store, now } = useApp();
  // The core serves no title for a card's worker run: it reads its card's title (lina-app#61).
  const title = workerTitle(model, cardId);
  // While its card is read, whether the run still goes is not known: its rounds wait rather than read 완료 기록 없음.
  if (cardLoading)
    return (
      <article class="detail" data-testid="screen-run">
        <CardHead work="code" title={title}>
          <RunModelLine runId={id} />
        </CardHead>
        <Loading />
      </article>
    );
  const card = cardId ? model.cards.get(cardId) : undefined;
  const newest = store.get("record", id)?.rounds[0];
  const live = runLive(model, id);
  const state = newest ? W.outcome[outcomeOf(newest, true, live, now)] : live ? STATE_WORD.in_progress : null;
  return (
    <article class="detail" data-testid="screen-run">
      <CardHead work="code" title={title}>
        {state ? (
          <span class="sub" data-testid="run-state">
            {state}
          </span>
        ) : null}
        <RunModelLine runId={id} />
      </CardHead>
      {card ? (
        <Box title={W.cards}>
          <ul class="rows" aria-label={W.cards}>
            <CardRowView card={card} />
          </ul>
        </Box>
      ) : null}
      <Timeline runs={[id]} live={(runId) => runLive(model, runId)} />
    </article>
  );
}

export function RunScreen({ id }: { id: string }) {
  const { model, store, now } = useApp();
  const run = model.runs.get(id);
  const cardId = model.runOwner.get(id);
  if (!run && cardId) return <CardRunScreen id={id} cardId={cardId} />;
  // A card's worker run opened before its card was: its record names the card, read now (wantsFor), and the page
  // stands on the record meanwhile. A card that cannot be read leaves the page on the record alone.
  const record = store.get("record", id);
  if (!run && record) return <CardRunScreen id={id} cardId={record.cardId} cardLoading={record.cardId ? store.status("card", record.cardId) === "pending" : false} />;
  if (!run && (!model.ready || store.status("record", id) === "pending")) return <Loading />;
  // A card's worker run with no record to read (an older run the core has none for): nothing names its card before
  // the card opens (the card list carries no worker runs), so the page keeps its head and says the record failed.
  if (!run)
    return (
      <article class="detail" data-testid="screen-run">
        <CardHead work="code" title={null} untitled={W.untitledRun}>
          {null}
        </CardHead>
        <p class="write-error" role="alert" data-testid="timeline-error">
          {W.readFailed(W.record)}
        </p>
      </article>
    );
  const row = runRow(run);
  // A finished run the core keeps no record for still lists its past events from its own card (lina-app#128: r7).
  const past: PastEvent[] = [
    ...(run.startedAt ? [{ at: run.startedAt, text: W.runStarted }] : []),
    ...(run.endedAt ? [{ at: run.endedAt, text: run.plain.result ?? W.outcome.ended }] : []),
  ];
  const todo = run.todo ? model.items.get(run.todo) : undefined;
  const owner = model.runOwner.get(run.id);
  const card = owner ? model.cards.get(owner) : undefined;
  // A lone stopped run is listed by the title the list resolved for it (its own, its to-do's); the page keeps it.
  const listed = model.running.rows.find((each) => each.kind === "run" && each.id === run.id);
  const listedTitle = listed?.title ?? null;
  return (
    <article class="detail" data-testid="screen-run">
      <CardHead work={row.work} title={run.plain.title ?? listedTitle}>
        <HeadState state={run.state} reason={run.reason} row={listed ?? row} time={[cardTime(listed ?? row, now), cardTook(row)].filter(Boolean).join(SEP)} />
        <RunModelLine runId={id} />
      </CardHead>
      {run.plain.now && run.state === "in_progress" ? (
        <Box title={W.now}>
          <p class="box-text">{run.plain.now}</p>
        </Box>
      ) : null}
      {run.plain.result ? (
        <Box title={W.doneSoFar}>
          <p class="box-text">{run.plain.result}</p>
        </Box>
      ) : null}
      {todo ? (
        <Box title={W.todo}>
          <ul class="rows" aria-label={W.todo}>
            <li class="row" data-testid="row">
              <Link href={href({ name: "item", id: todo.id })} label={[todo.title, stateLabel(todo.state, todo.reason)].join(SEP)}>
                <span class="lines">
                  <span class="title one-line">{todo.title}</span>
                  <StateTime state={todo.state} reason={todo.reason} time={sinceText(todo.state, todo.stateSince, now)} />
                </span>
              </Link>
            </li>
          </ul>
        </Box>
      ) : null}
      {card ? (
        <Box title={W.cards}>
          <ul class="rows" aria-label={W.cards}>
            <CardRowView card={card} />
          </ul>
        </Box>
      ) : null}
      <Timeline runs={[id]} live={(runId) => runLive(model, runId)} fallback={store.status("record", id) === "failed" ? null : <PastEvents events={past} />} />
    </article>
  );
}
