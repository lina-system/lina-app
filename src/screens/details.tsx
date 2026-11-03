import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ItemDetail, ItemSummary, WorkCardDetail } from "../api/client";
import { goalCards, runRow, type Model } from "../model";
import { foldReason } from "../model/fold";
import type { CardKind } from "../model/kind";
import { href } from "../router";
import { ago, clock } from "../time";
import { useActions } from "../ui/actions";
import { agentName, Box, CardRowView, CheckBox, DoneCheck, ErrorLine, KindMark, Link, Progress, sinceText, StateText, StateTime, cardTime, useApp } from "../ui/parts";
import { SEP, STATE_WORD, stateLabel, W } from "../words";
import { Comments } from "./comments";
import { Talk } from "./talk";

function Missing() {
  return <p class="empty">{W.notFound}</p>;
}

function Loading() {
  return <p class="empty">{W.loading}</p>;
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

function ItemDecision({ detail }: { detail: ItemDetail }) {
  if (!detail.decision || detail.decision.answered) return null;
  return <DecisionBox text={detail.decision.text} agent={detail.agent} ask={detail.decision.kind === "ask"} at={detail.decision.at} />;
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
  const { model, store, now } = useApp();
  const { cards, evidence } = goalCards(model, detail, {
    goals: detail.workCards.map((id) => store.get("goal", id)).filter((goal) => goal !== undefined),
  });
  const words = [detail.why, ...detail.basis.map((basis) => basis.text)].filter((text, index, all): text is string => Boolean(text) && all.indexOf(text) === index);
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
      {evidence.length ? (
        <Box title={W.evidence} testid="evidence">
          {evidence.map((entry) => (
            <div key={entry.key} class="comment">
              <p class="box-text">{entry.text}</p>
              {entry.at ? <span class="sub">{ago(now - entry.at)}</span> : null}
            </div>
          ))}
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
                  <Link href={target} label={[run.title, stateLabel(run.state, run.reason)].join(SEP)}>
                    <span class="lines">
                      <span class="one-line">
                        <span class="title">{run.title}</span>
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
 * A work card's head: its kind icon and word, its checked title (nothing when the core has none) and its state
 * line. The raw card title is never drawn.
 */
function CardHead({ work, title, children }: { work: CardKind; title: string | null; children: ComponentChildren }) {
  return (
    <header class="detail-head">
      <KindMark work={work} word />
      {title ? <h1 class="detail-title">{title}</h1> : null}
      {children}
    </header>
  );
}

interface Round {
  readonly n: number;
  /** Null when the round's start fell out of the kept history ('시작 기록 없음'). */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
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
      .filter((worker) => !placed.has(worker.id) && (start === null || worker.firstSeenAt >= start) && (run.endedAt === null || worker.firstSeenAt <= run.endedAt))
      .map((worker) => worker.id);
    for (const worker of workers) placed.add(worker);
    const content = workers.length > 0 || (start === null && Boolean(run.summary?.trim()));
    return { round: { n: index + 1, startedAt: start, endedAt: run.endedAt, workers } satisfies Round, content };
  });
  return {
    rounds: rounds.filter(({ content }) => content).map(({ round }) => round).reverse(),
    outside: detail.workerRuns.map((worker) => worker.id).filter((worker) => !placed.has(worker)),
  };
}

function roundHead(round: Round): string {
  if (round.startedAt === null) return [W.round(round.n), W.noStart].join(SEP);
  const span = round.endedAt === null ? clock(round.startedAt) : `${clock(round.startedAt)}–${clock(round.endedAt)}`;
  return [W.round(round.n), span, round.endedAt === null ? STATE_WORD.in_progress : ""].filter(Boolean).join(SEP);
}

/**
 * One comment on a work card: its sentence with author and time. A comment that would show a path, a command, a
 * hash, an issue number, an address or a cut-off fragment is one folded entry (접힌 댓글) instead; its text opens
 * only on demand.
 */
function CardComment({ comment }: { comment: WorkCardDetail["comments"][number] }) {
  const { model, now } = useApp();
  const meta = [agentName(model, comment.author), ago(now - comment.createdAt)].filter(Boolean).join(SEP);
  const reason = foldReason(comment.body);
  const [open, setOpen] = useState(false);
  if (!reason)
    return (
      <li class="comment" data-testid="comment">
        <p class="comment-text">{comment.body}</p>
        <span class="sub">{meta}</span>
      </li>
    );
  return (
    <li class="comment is-folded" data-testid="comment" data-folded={reason}>
      <details class="comment-fold" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary class="sub">{[W.folded, meta].join(SEP)}</summary>
        {open ? <p class="comment-raw">{comment.body}</p> : null}
      </details>
    </li>
  );
}

function WorkerRows({ ids, model }: { ids: readonly string[]; model: Model }) {
  return (
    <ul class="rows" aria-label={W.workerRuns}>
      {ids.map((workerId) => {
        const run = model.runs.get(workerId);
        return run ? <CardRowView key={workerId} card={runRow(run)} dim kindIcon={false} /> : null;
      })}
    </ul>
  );
}

export function CardScreen({ id }: { id: string }) {
  const { model, store, now } = useApp();
  const detail = store.get("card", id);
  if (!detail) return store.status("card", id) === "missing" ? <Missing /> : <Loading />;
  const row = model.cards.get(id);
  const questions = (store.get("inbox")?.questions ?? []).filter((question) => question.cardId === id);
  const finished = detail.todos.filter((todo) => todo.done);
  const next = detail.state === "done" ? undefined : detail.todos.find((todo) => !todo.done);
  const { rounds, outside } = workerRounds(detail);
  return (
    <article class="detail" data-testid="screen-card">
      <CardHead work={row?.work ?? "code"} title={detail.plain.title}>
        <StateTime state={detail.state} reason={detail.reason} time={row ? cardTime(row, now) : ""} />
        {detail.state === "in_progress" && detail.todoProgress.total > 0 ? <Progress done={detail.todoProgress.done} total={detail.todoProgress.total} /> : null}
      </CardHead>
      {questions.map((question) => (
        <DecisionBox key={question.commentId} text={question.body} agent={question.agent} ask at={question.askedAt} />
      ))}
      {detail.plain.now && detail.state === "in_progress" ? (
        <Box title={W.now} testid="card-now">
          <p class="box-text">{detail.plain.now}</p>
        </Box>
      ) : null}
      {detail.plain.result || finished.length ? (
        <Box title={W.doneSoFar} testid="card-done-so-far">
          {detail.plain.result ? <p class="box-text">{detail.plain.result}</p> : null}
          {finished.length ? (
            <ul class="rows checklist" aria-label={W.doneSoFar}>
              {finished.map((todo) => (
                <li key={todo.id} class="row check-row" data-testid="row">
                  <CheckBox title={todo.title} done />
                  <span class="lines">
                    <span class="title one-line">{todo.title}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Box>
      ) : null}
      {next ? (
        <Box title={W.next} testid="card-next">
          <p class="box-text">{next.title}</p>
        </Box>
      ) : null}
      {detail.todos.length ? (
        <Box title={W.todos}>
          <ul class="rows checklist" aria-label={W.todos}>
            {detail.todos.map((todo) => (
              <li key={todo.id} class="row check-row" data-testid="row">
                <CheckBox title={todo.title} done={todo.done} />
                <span class="lines">
                  <span class="title one-line">{todo.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </Box>
      ) : null}
      {detail.workerRuns.length ? (
        <Box title={W.workerRuns} testid="worker-runs">
          {rounds.map((round) => (
            <section key={round.n} class={round.startedAt === null ? "round is-no-start" : "round"} data-testid="round">
              <h3 class="round-head">{roundHead(round)}</h3>
              {round.workers.length ? <WorkerRows ids={round.workers} model={model} /> : null}
            </section>
          ))}
          {outside.length ? <WorkerRows ids={outside} model={model} /> : null}
        </Box>
      ) : null}
      {detail.comments.length ? (
        <Box title={W.comments}>
          <ul class="thread" aria-label={W.comments}>
            {detail.comments.map((comment) => (
              <CardComment key={comment.id} comment={comment} />
            ))}
          </ul>
        </Box>
      ) : null}
    </article>
  );
}

export function RunScreen({ id }: { id: string }) {
  const { model, now } = useApp();
  const run = model.runs.get(id);
  if (!run) return model.ready ? <Missing /> : <Loading />;
  const row = runRow(run);
  const todo = run.todo ? model.items.get(run.todo) : undefined;
  const owner = model.runOwner.get(run.id);
  const card = owner ? model.cards.get(owner) : undefined;
  return (
    <article class="detail" data-testid="screen-run">
      <CardHead work={row.work} title={run.plain.title}>
        <StateTime state={run.state} reason={run.reason} time={cardTime(row, now)} />
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
    </article>
  );
}
