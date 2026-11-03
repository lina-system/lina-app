import type { ComponentChildren } from "preact";
import type { ItemComment, ItemDetail } from "../api/client";
import { goalCards, runRow } from "../model";
import { href } from "../router";
import { ago } from "../time";
import { agentName, Box, CardRowView, CheckBox, Link, sinceText, StateText, StateTime, cardTime, useApp } from "../ui/parts";
import { REPLY_RESULT, SEP, stateLabel, W } from "../words";

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

function Thread({ comments }: { comments: readonly ItemComment[] }) {
  const { model, now } = useApp();
  return (
    <ul class="thread" aria-label={W.comments}>
      {comments.map((comment) => (
        <li key={comment.cid} class="comment" data-testid="comment">
          <p class="comment-text">{comment.text}</p>
          <span class="sub">{[agentName(model, comment.by), ago(now - comment.at)].filter(Boolean).join(SEP)}</span>
          {comment.replies.length ? (
            <ul class="replies">
              {comment.replies.map((reply, index) => (
                <li key={index} class="comment reply" data-testid="reply">
                  <p class="comment-text">{reply.text}</p>
                  <span class="sub">
                    {[agentName(model, reply.by), ago(now - reply.at), reply.result ? REPLY_RESULT[reply.result] : null].filter(Boolean).join(SEP)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
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
        <StateTime state={detail.state} reason={detail.reason} time={sinceText(detail.state, detail.stateSince, now)} />
      </Header>
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
              <li key={todo.id} class="row check-row" data-testid="row">
                <CheckBox title={todo.title} done={todo.state === "done"} />
                <Link href={href({ name: "item", id: todo.id })} label={[todo.title, stateLabel(todo.state, todo.reason)].join(SEP)}>
                  <span class="lines">
                    <span class="title one-line">{todo.title}</span>
                    <StateTime state={todo.state} reason={todo.reason} time={sinceText(todo.state, todo.stateSince, now)} />
                  </span>
                </Link>
              </li>
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
    </article>
  );
}

function TodoBody({ detail }: { detail: ItemDetail }) {
  const { model, now } = useApp();
  return (
    <article class="detail" data-testid="screen-item">
      <Header title={detail.title}>
        <div class="head-check">
          <CheckBox title={detail.title} done={detail.state === "done"} />
          <StateTime state={detail.state} reason={detail.reason} time={sinceText(detail.state, detail.stateSince, now)} />
        </div>
      </Header>
      {detail.decision && !detail.decision.answered ? (
        <Box title={W.decide}>
          <p class="box-text">{detail.decision.text}</p>
          <span class="sub">{[agentName(model, detail.agent), detail.decision.kind === "ask" ? W.ask : W.act, detail.decision.at ? ago(now - detail.decision.at) : null].filter(Boolean).join(SEP)}</span>
        </Box>
      ) : null}
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
      {detail.comments.length ? (
        <Box title={W.comments}>
          <Thread comments={detail.comments} />
        </Box>
      ) : null}
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

export function CardScreen({ id }: { id: string }) {
  const { model, store, now } = useApp();
  const detail = store.get("card", id);
  if (!detail) return store.status("card", id) === "missing" ? <Missing /> : <Loading />;
  const row = model.cards.get(id);
  return (
    <article class="detail" data-testid="screen-card">
      <Header title={detail.title}>
        <StateTime state={detail.state} reason={detail.reason} time={row ? cardTime(row, now) : ""} />
      </Header>
      {detail.now && detail.state === "in_progress" ? (
        <Box title={W.now}>
          <p class="box-text">{detail.now}</p>
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
        <Box title={W.workerRuns}>
          <ul class="rows" aria-label={W.workerRuns}>
            {detail.workerRuns.map((worker) => {
              const run = model.runs.get(worker.id);
              if (!run) return null;
              return <CardRowView key={worker.id} card={runRow(run)} dim />;
            })}
          </ul>
        </Box>
      ) : null}
      {detail.comments.length ? (
        <Box title={W.comments}>
          <ul class="thread" aria-label={W.comments}>
            {detail.comments.map((comment) => (
              <li key={comment.id} class="comment" data-testid="comment">
                <p class="comment-text">{comment.body}</p>
                <span class="sub">{[agentName(model, comment.author), ago(now - comment.createdAt)].filter(Boolean).join(SEP)}</span>
              </li>
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
      <Header title={run.title}>
        <StateTime state={run.state} reason={run.reason} time={cardTime(row, now)} />
      </Header>
      {run.now && run.state === "in_progress" ? (
        <Box title={W.now}>
          <p class="box-text">{run.now}</p>
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
