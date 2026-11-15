import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ItemDetail, ItemSummary, WorkCardDetail, WorkState } from "../api/client";
import { KoreanInput } from "../korean-input";
import { cardTitle, goalCards, goalState, runRow, type CardRow, type Model } from "../model";
import { foldedText, foldReason } from "../model/fold";
import { plainText } from "../model/plain";
import { holds } from "../model/rounds";
import { stopReason } from "../model/stop-reason";
import { answerOf, commentHistory, decisionHistory, goalHistory, historyLines, isMachineNotice, outcomeOf } from "../model/timeline";
import type { CardKind } from "../model/kind";
import { isRunId } from "../data/store";
import { back, baseOf, href, isFrame, navigate, parse, tabOf } from "../router";
import { ago, clockAt, dayLabel } from "../time";
import { useActions } from "../ui/actions";
import { agentName, Box, CardRowView, CheckBox, DoneCheck, ErrorLine, KindMark, Link, Progress, sinceText, StateText, StateTime, cardTime, cardTook, stateWords, useApp } from "../ui/parts";
import { BANNED_WORDS, DETAIL_WORD, reasonWord, RUN_LINE_WORD, SEP, STATE_WORD, stateLabel, W } from "../words";
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

/**
 * A detail head. `line` is its second line when the head reads the two lines of the row that was pressed
 * (lina-app#157); it is no `.sub`, so the state line stays the head's first grey line.
 */
function Header({ title, line, children }: { title: string; line?: string | null; children?: ComponentChildren }) {
  return (
    <header class="detail-head">
      <FrameClose />
      <h1 class="detail-title">{title}</h1>
      {line ? (
        <p class="head-line" data-testid="head-line">
          {line}
        </p>
      ) : null}
      {children}
    </header>
  );
}

/**
 * Closes the detail frame the way the phone sheet's 닫기 does, one step back (or to the screen under it when the frame
 * was opened directly), then puts focus back on the list row that opened it (lina-app#161). Every record opened in the
 * frame since it opened is one step: 닫기 goes back past them all, so the frame closes at once, and the list keeps the
 * scroll it has now (lina-app#166).
 */
function closeFrame() {
  const hash = window.location.hash || "#/";
  const stack = (window.history.state as { stack?: readonly string[] } | null)?.stack ?? [hash];
  let frames = 0;
  while (frames < stack.length && isFrame(parse(stack[stack.length - 1 - frames]))) frames += 1;
  const list = document.querySelector<HTMLElement>(".list-pane");
  const scroll = list?.scrollTop ?? null;
  const focusRow = () => {
    if (isFrame(parse(window.location.hash || "#/"))) return;
    const pane = document.querySelector<HTMLElement>(".list-pane");
    if (pane && scroll !== null) pane.scrollTop = scroll;
    [...document.querySelectorAll<HTMLAnchorElement>(".list-pane a")].find((link) => link.getAttribute("href") === hash)?.focus({ preventScroll: true });
  };
  if (frames < stack.length) {
    window.addEventListener("popstate", () => setTimeout(focusRow), { once: true });
    if (frames === 1) back();
    else window.history.go(-frames);
  } else {
    navigate(baseOf(parse(hash), stack), { replace: true });
    setTimeout(focusRow);
  }
}

/**
 * 닫기 in the head of the desktop pane, and Esc, which close it (lina-app#161). The phone sheet has its own 닫기 in its bar,
 * and a detail opened in 대화 its back control to the agent's card, so neither draws one here. Esc typed while a Korean
 * syllable is being composed, or while the bell's list is open, is theirs.
 */
function FrameClose() {
  const { wide } = useApp();
  const shown = wide && isFrame(parse(window.location.hash || "#/")) && !talkWindowOpen(wide);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || document.querySelector(".popover")) return;
      closeFrame();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown]);
  if (!shown) return null;
  return (
    <button type="button" class="text-button frame-close" onClick={closeFrame} data-testid="frame-close">
      {W.close}
    </button>
  );
}

/**
 * The 결정 필요 row an item's open decision is listed as in 수신함, when it reads a line 1 of its own: the item's head reads
 * that row's two lines, so the detail opens with the name of the row that was pressed (lina-app#157).
 */
function useDecisionRow(id: string): { context: string; text: string } | null {
  const { model } = useApp();
  const answering = useAnswering();
  const pressed = useRef<{ id: string; row: { context: string; text: string } } | null>(null);
  const row = model.inbox.rows.find((each) => each.type === "decide" && each.target.kind === "item" && each.target.id === id);
  const shown = row?.type === "decide" && row.context ? { context: row.context, text: row.text } : null;
  if (shown) pressed.current = { id, row: shown };
  // The row leaves 수신함 as its answer is sent; the head keeps the two lines that were pressed (lina-app#166).
  return shown ?? (answering(`decide:${id}`) && pressed.current?.id === id ? pressed.current.row : null);
}

/** A bracket with a time of day in a sentence (`(에이전트 16:5x)`, who wrote it and when): no part of what a history line reads. */
const WHO_WHEN = /\([^()]*\d{1,2}:\d[\dx][^()]*\)/g;
/** The bracketed tags that open a line (`[에이전트 · t 1a2b3c4d]`). */
const LEADING_TAGS = /^(?:\s*\[[^\]\n]*\])+\s*/;

/**
 * A history text through the fold comments go through (foldedText: withoutRefs, and a sentence left as debris dropped,
 * lina-app#157, #161): its card, goal and to-do ids,
 * references and hashes cut, and its leading tags and who-and-when brackets cut; a sentence holding a word the screens
 * never use (BANNED_WORDS) is left out. fold.ts has no export for the brackets or the sentences, so they are cut here.
 * Empty when nothing is left: the line folds.
 */
export function historyText(text: string): string {
  return plainText(text)
    .split("\n")
    .map((line) =>
      foldedText(line.replace(LEADING_TAGS, "").replace(WHO_WHEN, " "))
        .split(/(?<=[.!?。])\s+/)
        .filter((sentence) => !BANNED_WORDS.some((word) => sentence.includes(word)))
        .join(" ")
        .replace(/\s+([.!?,])/g, "$1"),
    )
    .filter(Boolean)
    .join("\n");
}

/** A comment's text for its history line: a machine notice keeps its own text, so it is still known as one and left out. */
function historyComment(text: string, author: string | null): string {
  return isMachineNotice(text, author) ? text : historyText(text);
}

/**
 * The item with its comments' markdown markers out (plainText): a comment that was only markers and spaces, with no
 * reply, is no comment at all, never an empty or folded row (lina-app#166).
 */
function plainItem(detail: ItemDetail): ItemDetail {
  const plain = <T extends { readonly text: string }>(entries: readonly T[]) => entries.map((entry) => ({ ...entry, text: plainText(entry.text) }));
  return { ...detail, comments: plain(detail.comments).map((comment) => ({ ...comment, replies: plain(comment.replies).filter((reply) => reply.text) })).filter((comment) => comment.text || comment.replies.length) };
}

/** The item with its comments' and its decision's text as history reads them (historyText), for its 기록 lines. */
function historyItem(detail: ItemDetail): ItemDetail {
  return {
    ...detail,
    comments: detail.comments.map((comment) => ({ ...comment, text: historyComment(comment.text, comment.by), replies: comment.replies.map((reply) => ({ ...reply, text: historyComment(reply.text, reply.by) })) })),
    decision: detail.decision ? { ...detail.decision, text: historyText(detail.decision.text) } : null,
  };
}

/** The item without its decision's answer among its comments: 질문 · 답 shows that answer, once (lina-app#157). */
function withoutAnswer(detail: ItemDetail): ItemDetail {
  const answer = answerOf(detail);
  if (!answer) return detail;
  return { ...detail, comments: detail.comments.filter((comment) => !(comment.kind === "answer" && comment.at === answer.at && comment.text === answer.text)) };
}

/**
 * A pending decision or a card's question, drawn the same way on a goal, a to-do or a work card. A goal's or a to-do's
 * head already says 결정 필요 and when it was asked, and its question when it reads the decision row's two lines: that
 * box has no head, no age and no sentence the head shows (lina-app#161).
 */
function DecisionBox({ text, agent, ask, at, title = W.decide }: { text: string | null; agent: string | null; ask: boolean; at: number | null; title?: string | null }) {
  const { model, now } = useApp();
  return (
    <Box title={title ?? undefined} testid="decision">
      {text ? <p class="box-text">{text}</p> : null}
      <span class="sub">{[agentName(model, agent), ask ? W.ask : W.act, at ? ago(now - at) : null].filter(Boolean).join(SEP)}</span>
    </Box>
  );
}

/**
 * Where the owner answers, in the detail frame (lina-app#142): the choices, or a field with 보내기. The answer goes
 * the way it goes from 수신함 (Actions.answer, keyed as its 수신함 row), so the row leaves there too.
 */
function AnswerPlace({ answerKey, target, label, choices = [], recommended = null, draft = null, onSend, testid }: { answerKey: string; target: { kind: "item" | "card"; id: string }; label: string; choices?: readonly string[]; recommended?: string | null; draft?: string | null; onSend?: (answer: string) => void; testid: string }) {
  const actions = useActions();
  const error = actions.error(answerKey);
  const [text, setText] = useState(error?.text ?? draft ?? "");
  const busy = actions.busy(answerKey);
  const send = (answer: string) => {
    const body = answer.trim();
    if (!body || busy) return;
    onSend?.(body);
    actions.answer(answerKey, target, body);
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

/** Whether an answer under this key waits for its toast: its decision leaves the frame as its row leaves 수신함. */
function useAnswering(): (key: string) => boolean {
  const actions = useActions();
  return (key) => actions.pending().hidden.has(key);
}

/**
 * An answered decision where its box stood (lina-app#153): its question and the owner's answer together. `sent` is an
 * answer still waiting for its toast (lina-app#166): it shows at once, with no age yet, and its question is not said
 * again when the head's second line (`headLine`) still reads it.
 */
function AnsweredDecision({ detail, headLine = null, sent = null }: { detail: ItemDetail; headLine?: string | null; sent?: string | null }) {
  const { model, now } = useApp();
  const answer = sent === null ? answerOf(detail) : { text: sent, at: null };
  if (!detail.decision) return null;
  return (
    <Box title={[detail.decision.kind === "ask" ? W.ask : W.act, W.answer].join(SEP)} testid="decision-answered">
      {headLine ? null : <p class="box-text">{plainText(detail.decision.text)}</p>}
      {answer ? <p class="box-text">{plainText(answer.text)}</p> : null}
      <span class="sub">{[agentName(model, detail.agent), W.answered, answer?.at ? ago(now - answer.at) : null].filter(Boolean).join(SEP)}</span>
    </Box>
  );
}

function ItemDecision({ detail, headLine }: { detail: ItemDetail; headLine?: string | null }) {
  const answering = useAnswering();
  const key = `decide:${detail.id}`;
  const [sent, setSent] = useState<string | null>(null);
  if (detail.decision?.answered) return <AnsweredDecision detail={detail} />;
  if (!detail.decision) return null;
  // While the answer waits for its toast, the question and the answer just sent stand where the box stood; 되돌리기
  // brings the box back with the answer in its field (lina-app#166).
  if (answering(key)) return <AnsweredDecision detail={detail} headLine={headLine} sent={sent} />;
  const waiting = detail.children.filter((child) => child.reason === "blocked_by_item").map((child) => child.title);
  return (
    <>
      <DecisionBox text={headLine ? null : plainText(detail.decision.text)} agent={detail.agent} ask={detail.decision.kind === "ask"} at={null} title={null} />
      {waiting.length ? (
        <p class="sub waiting-on" data-testid="waiting-on">
          {W.waitingOn(waiting.join(", "))}
        </p>
      ) : null}
      <AnswerPlace key={key} answerKey={key} target={{ kind: "item", id: detail.id }} label={W.answerField} choices={detail.decision.choices} recommended={detail.decision.recommended} draft={sent} onSend={setSent} testid="decision-answer" />
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
  const answering = useAnswering();
  const { model, store, now } = useApp();
  const [asking, setAsking] = useState(false);
  // A goal reads the same fold of its cards as the work tab: a stopped card makes it 중단됨 (lina-app#148).
  const head = detail.kind === "goal" ? goalState(model, detail, store.get("goals")) : detail;
  const open = detail.kind === "goal" ? detail.children.filter((child) => !actions.isDone(child.id, child.state === "done")).map((child) => child.id) : [];
  const withIds = detail.ownerDone?.with ?? [];
  const shown = actions.isDone(detail.id, detail.state === "done");
  const until = actions.undoUntil(detail.id, detail.ownerDone?.undoUntil);
  const showUndo = shown && until !== null && now < until && actions.toast?.owner !== detail.id;
  // An open decision dates the head as its 수신함 row does, from when it was asked (lina-app#149).
  const since = detail.decision && !detail.decision.answered && detail.decision.at ? detail.decision.at : head.stateSince;
  // An answered decision no longer waits on the owner: the head reads 답함 and when, until the item moves on (lina-app#153).
  // So does one whose answer waits for its toast (lina-app#166).
  const answered = (detail.decision?.answered || (detail.decision && answering(`decide:${detail.id}`))) && detail.state !== "done";
  const answer = answered && detail.decision?.answered ? answerOf(detail) : null;
  return (
    <>
      <div class="head-check">
        <DoneCheck id={detail.id} title={detail.title} done={detail.state === "done"} undoUntil={detail.ownerDone?.undoUntil} withOpen={withIds} openTodos={open.length} onOpenTodos={() => setAsking(true)} />
        {answered ? (
          <span class="sub">
            <span class="state" data-testid="state">
              {W.answered}
            </span>
            {answer ? <span class="time">{`${SEP}${ago(now - answer.at)}`}</span> : null}
          </span>
        ) : (
          <StateTime state={head.state} reason={head.reason} time={sinceText(head.state, since, now)} />
        )}
        {showUndo ? (
          <button type="button" class="text-button head-undo" disabled={actions.busy(`done:${detail.id}`)} onClick={() => void actions.undoDone(detail.id, withIds)}>
            {W.undo}
          </button>
        ) : null}
      </div>
      {/* The due date its row shows, in the same colours (lina-app#161). */}
      {detail.due ? (
        <span class="sub item-due" data-testid="item-due">
          {`${W.due}${SEP}`}
          <span class={`due-date${detail.due < model.today ? " is-overdue" : detail.due === model.today ? " is-today" : ""}`}>{dayLabel(detail.due)}</span>
        </span>
      ) : null}
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
  const { model, store, wide } = useApp();
  const { cards, evidence } = goalCards(model, detail, {
    goals: detail.workCards.map((id) => store.get("goal", id)).filter((goal) => goal !== undefined),
  });
  const words = [detail.why, ...detail.basis.map((basis) => basis.text)].filter((text, index, all): text is string => Boolean(text) && all.indexOf(text) === index);
  // Its merges (the finished cards' evidence), question, runs, comments and close, one line each, ids cut. An open
  // question is the box and the head above, so it is no history line until it is answered (lina-app#161).
  const open = detail.decision && !detail.decision.answered;
  const plain = plainItem(detail);
  const history = goalHistory(
    open ? { ...historyItem(plain), decision: null } : historyItem(plain),
    evidence.map((entry) => ({ ...entry, text: historyText(entry.text) })),
  );
  const decisionRow = useDecisionRow(detail.id);
  return (
    <article class="detail" data-testid="screen-goal">
      <Header title={decisionRow?.context ?? detail.title} line={decisionRow?.text}>
        <DoneHead detail={detail} />
      </Header>
      <ItemDecision key={detail.id} detail={detail} headLine={decisionRow?.text} />
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
      <Comments detail={withoutAnswer(plain)} />
      {talkWindowOpen(wide) ? null : <Talk key={detail.id} detail={detail} />}
    </article>
  );
}

/**
 * Whether the agent's own talk window stands beside the frame: a detail opened in 대화 on a wide window. The detail
 * then has no talk box of its own, so there is one place to talk to the agent (lina-app#153).
 */
function talkWindowOpen(wide: boolean): boolean {
  if (!wide) return false;
  const hash = window.location.hash || "#/";
  const stack = (window.history.state as { stack?: readonly string[] } | null)?.stack ?? [hash];
  return tabOf(baseOf(parse(hash), stack)) === "talk";
}

function TodoBody({ detail }: { detail: ItemDetail }) {
  const { model, wide } = useApp();
  // An answered decision's question and answer are history (lina-app#153); an open one is its box above.
  const plain = plainItem(detail);
  const history = detail.decision?.answered ? historyLines(decisionHistory(historyItem(plain))) : [];
  const decisionRow = useDecisionRow(detail.id);
  return (
    <article class="detail" data-testid="screen-item">
      <Header title={decisionRow?.context ?? detail.title} line={decisionRow?.text}>
        <DoneHead detail={detail} />
      </Header>
      <ItemDecision key={detail.id} detail={detail} headLine={decisionRow?.text} />
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
      {history.length ? (
        <Box title={W.record} testid="item-history">
          <ul class="history-rows" aria-label={W.record}>
            {history.map((row, index) => (
              <HistoryLine key={`${row.at}:${index}`} at={row.at} text={row.text ?? DETAIL_WORD.earlierRecords(row.folded)} kind={row.kind} />
            ))}
          </ul>
        </Box>
      ) : null}
      <Comments detail={withoutAnswer(plain)} />
      {talkWindowOpen(wide) ? null : <Talk key={detail.id} detail={detail} />}
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
 * A work card's head: its kind icon and word, its name (the name its row reads, else the checked title or the card's
 * own title, lina-app#153) and its state line. The kind is never the title (lina-app#149): with no title at all the
 * head reads 제목 없음 in grey. The core serves no kind of a card, and `code` is what cardKind reads when nothing
 * names one: a kind not known shows no kind, never 코드 (lina-app#153).
 */
function CardHead({ work, title, untitled, children }: { work: CardKind; title: string | null; untitled?: string; children: ComponentChildren }) {
  return (
    <header class="detail-head">
      <FrameClose />
      {work === "code" ? null : <KindMark work={work} word />}
      <h1 class={title ? "detail-title" : "detail-title is-kind"}>{title ?? untitled ?? W.untitled}</h1>
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

/** A round's own line as history reads it (historyText), or null when none of it may show (lina-app#157). */
function roundLine(line: string): string | null {
  const text = historyText(line);
  return text && !foldReason(text) ? text : null;
}

/**
 * The rounds in order, each run of rounds whose own line may not show gathered into one group (lina-app#161): it is one
 * 이전 기록 N건 row, not one row per round.
 */
function roundGroups(rounds: readonly Round[]): (Round | Round[])[] {
  const groups: (Round | Round[])[] = [];
  for (const round of rounds) {
    const last = groups.at(-1);
    if (round.line === null || roundLine(round.line) !== null) groups.push(round);
    else if (Array.isArray(last)) last.push(round);
    else groups.push([round]);
  }
  return groups;
}

/**
 * Why a stopped card stopped, above its run box (lina-app#161): its rounds may all read 완료 while the card is stopped.
 * The reason's word (결정 대기, 피드백 대기, else its own word), else the stop words its row reads (stopReason), so it
 * never says 이유 없음 where the head says why.
 */
function RunsStopWhy({ reason, row }: { reason: string | null; row: CardRow | undefined }) {
  const word = (reason ? (DETAIL_WORD.waitFor[reason] ?? reasonWord(reason)) : null) || (row ? stopReason(row).word : null) || DETAIL_WORD.noReason;
  return (
    <p class="sub runs-stop-why" data-testid="runs-stop-why">
      {[STATE_WORD.stopped, word].join(SEP)}
    </p>
  );
}

/**
 * A work card's comments, one history line each, newest first: its time and its first sentence a person may read,
 * with any id, hash, path or command taken out (lina-app#142, historyText #157); its author is the line's tooltip. A
 * machine notice is no line, and each run of comments with no sentence left is one 접힌 댓글 line with their count
 * (lina-app#149). A comment that was only markdown markers and spaces is no line at all (lina-app#166).
 */
function CardComments({ comments }: { comments: WorkCardDetail["comments"] }) {
  const { model } = useApp();
  const lines = commentHistory(comments.filter((comment) => plainText(comment.body)).map((comment) => ({ id: comment.id, at: comment.createdAt, author: comment.author, body: historyComment(comment.body, comment.author) })));
  if (!lines.length) return null;
  return (
    <Box title={W.comments} testid="card-comments">
      <ul class="history-rows" aria-label={W.comments}>
        {lines.map((line) => (
          <HistoryLine key={line.id} at={line.at} text={line.text ?? W.foldedRun(line.folded)} kind="comment" who={line.text ? agentName(model, line.author) : undefined} />
        ))}
      </ul>
    </Box>
  );
}

/** The one line a read-only card has where the owner would write (lina-app#149): it cannot be changed here (lina-app#153). */
function ReadOnlyLine() {
  return (
    <span class="sub" data-testid="read-only">
      {W.readOnlyHere}
    </span>
  );
}

/** The card's own title under its head's state line when the head reads another name, its row's (lina-app#153). */
function OwnTitleLine({ own, title }: { own: string | null; title: string | null }) {
  if (!own || own === title) return null;
  return (
    <span class="sub one-line" data-testid="card-own-title">
      {own}
    </span>
  );
}

/**
 * A detail head's state line: a stopped one reads the words and the time its list row reads (stopReason, cardTime).
 * A read-only card has no place to answer, so it makes no claim that the owner must act: the state word alone
 * (lina-app#153).
 */
/** Whether the state line already says why a stopped card stopped: its row's stop words follow 중단됨 there (lina-app#156). */
function stateSaysWhy(state: WorkState, reason: string | null, row: CardRow | undefined, readOnly: boolean): boolean {
  const onOwner = Boolean(row?.stop?.owner) || reason === "decision" || reason === "feedback";
  return state === "stopped" && Boolean(row?.stop) && !(readOnly && onOwner);
}

function HeadState({ state, reason, row, time, readOnly = false }: { state: WorkState; reason: string | null; row: CardRow | undefined; time: string; readOnly?: boolean }) {
  const onOwner = Boolean(row?.stop?.owner) || reason === "decision" || reason === "feedback";
  if (readOnly && onOwner) return <StateTime state={state} time={time} />;
  const stop = state === "stopped" && row?.stop ? { ...row.stop, words: stopReason(row).word } : undefined;
  return <StateTime state={state} reason={reason} stop={stop} time={time} />;
}

/**
 * Why a stopped card stopped, one line under its state line (lina-app#157): what it waits for by the core's reason
 * (결정 대기, 피드백 대기, else the reason's own word) and its ask; 이유 없음 when the card gives neither. When the newest
 * of its comments is the owner's, made after the stop, a second line says the owner decided and the state has not
 * moved yet.
 */
function StopWhy({ reason, words, carried, stoppedAt, comments = [] }: { reason: string | null; words: string | null | undefined; carried: boolean; stoppedAt: number | null; comments?: WorkCardDetail["comments"] }) {
  const { store } = useApp();
  const owner = store.get("items")?.owner?.id ?? "owner";
  const word = reason ? (DETAIL_WORD.waitFor[reason] ?? reasonWord(reason)) : null;
  const newest = comments.filter((comment) => !isMachineNotice(comment.body, comment.author)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const decided = stoppedAt !== null && newest !== undefined && (newest.author === owner || newest.author === "owner") && newest.createdAt > stoppedAt;
  return (
    <>
      {carried ? null : (
        <span class="sub" data-testid="stop-why">
          {words || word || DETAIL_WORD.noReason}
        </span>
      )}
      {decided ? (
        <span class="sub" data-testid="decided-since-stop">
          {DETAIL_WORD.decidedSinceStop}
        </span>
      ) : null}
    </>
  );
}

/**
 * A round's worker runs, one line each: when it started and what happened, never the card's title again (the card's
 * head carries it, lina-app#142). The board does not list the worker runs a card started (only runs outside any
 * card), so such a run is still drawn as a link to its own page: no worker row is ever left out because its target
 * is not in a list.
 */
function WorkerRows({ ids, model, seen, state }: { ids: readonly string[]; model: Model; seen: (runId: string) => number | null; state: (runId: string) => string }) {
  const { now } = useApp();
  // Newest first, as every history (lina-app#157).
  const startOf = (workerId: string) => model.runs.get(workerId)?.startedAt ?? seen(workerId);
  const ordered = [...ids].sort((a, b) => (startOf(b) ?? 0) - (startOf(a) ?? 0));
  return (
    <ul class="rows" aria-label={W.workerRuns}>
      {ordered.map((workerId) => {
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
  const answering = useAnswering();
  const detail = store.get("card", id);
  const row = model.cards.get(id);
  if (!detail) {
    if (store.status("card", id) === "missing") return <Missing />;
    if (!row) return <Loading />;
    // The card's detail is read only now that it is open: its list row's head and now line show while it comes.
    return (
      <article class="detail" data-testid="screen-card">
        <CardHead work={row.work} title={row.title}>
          <HeadState state={row.state} reason={row.reason} row={row} time={[cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP)} readOnly={row.readOnly} />
          {row.state === "stopped" ? <StopWhy reason={row.reason} words={row.stop?.words} carried={stateSaysWhy(row.state, row.reason, row, Boolean(row.readOnly))} stoppedAt={row.stateAt} /> : null}
          <OwnTitleLine own={row.own} title={row.title} />
          {row.readOnly ? <ReadOnlyLine /> : null}
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
  // Every question the card has, answered or not yet: the fallback answer place is for a card with none (lina-app#142).
  const everyQuestion = (store.get("inbox")?.questions ?? []).filter((question) => question.cardId === id);
  const questions = everyQuestion.filter((question) => !answering(`question:${id}:${question.commentId}`));
  // A worker run id the hub served may be a word of a command in the card's text (status, wait): not a run, never
  // read or drawn; a run listed twice is one run (lina-app#128).
  const workerRuns = detail.workerRuns.filter((worker, index, all) => isRunId(worker.id) && all.findIndex((other) => other.id === worker.id) === index);
  const { rounds, outside } = workerRounds({ runs: detail.runs, workerRuns });
  // The state word of a worker run the board does not list: going while it beats, else how its round ended.
  const workerState = (runId: string) => {
    if (runLive(model, runId)) return STATE_WORD.in_progress;
    const round = rounds.find((candidate) => candidate.workers.includes(runId));
    if (!round) return RUN_LINE_WORD.noResult;
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
  // A card from a board the core only reads (lina#481) has no place to answer and no other write (lina-app#149).
  const readOnly = Boolean(detail.readOnly || row?.readOnly);
  // An old done card the core keeps no history for (`detail: false`) says so instead of an empty frame.
  const kept = store.get("cards")?.cards.find((card) => card.id === id)?.detail !== false;
  // The head reads the name of the row that was tapped (its goal's title when the row leads with it); the card's own
  // title is the line under it when it differs (lina-app#153).
  const own = cardTitle(detail.plain.title, detail.title, detail.state === "stopped") ?? row?.own ?? null;
  const title = row?.title ?? own;
  // The head reads the state of the row that was pressed, the list's snapshot, until the next refresh moves both; the
  // detail read later may already say another (lina-app#157). A card with no row reads its detail's.
  const state = row?.state ?? detail.state;
  const reason = row ? row.reason : detail.reason;
  return (
    <article class="detail" data-testid="screen-card">
      <CardHead work={row?.work ?? "code"} title={title}>
        <HeadState state={state} reason={reason} row={row} time={row ? [cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP) : ""} readOnly={readOnly} />
        {state === "stopped" ? <StopWhy reason={reason} words={row?.stop?.words} carried={stateSaysWhy(state, reason, row, readOnly)} stoppedAt={row?.stateAt ?? detail.lastHeartbeatAt ?? null} comments={detail.comments} /> : null}
        <OwnTitleLine own={own} title={title} />
        {goalLine && goalLine !== title ? (
          <span class="sub" data-testid="card-goal">
            {[W.goals, goalLine].join(SEP)}
          </span>
        ) : null}
        {state === "in_progress" && detail.todoProgress.total > 0 ? <Progress done={detail.todoProgress.done} total={detail.todoProgress.total} word /> : null}
        {readOnly ? <ReadOnlyLine /> : null}
      </CardHead>
      {/* Each question with the place to answer it, keyed as its 수신함 row, so answering here hides that row too. */}
      {questions.map((question) => (
        <Fragment key={question.commentId}>
          <DecisionBox text={plainText(question.body)} agent={question.agent} ask at={question.askedAt} />
          {readOnly ? null : <AnswerPlace key={question.commentId} answerKey={`question:${id}:${question.commentId}`} target={{ kind: "card", id }} label={W.answerField} testid="decision-answer" />}
        </Fragment>
      ))}
      {ask && !readOnly && !everyQuestion.length && !answering(`answer:${id}`) ? (
        <Box>
          <AnswerPlace key={`answer:${id}`} answerKey={`answer:${id}`} target={{ kind: "card", id }} label={ask} testid="card-answer" />
        </Box>
      ) : null}
      {detail.plain.now && state === "in_progress" ? (
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
      {kept ? null : (
        <p class="empty" data-testid="no-history">
          {W.noHistory}
        </p>
      )}
      {state === "stopped" && workerRuns.length ? <RunsStopWhy reason={reason} row={row} /> : null}
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
              {/* A round's own line is its content, its ids cut; rounds whose line would show a path or a command are no
                  comment: each run of them is one folded 이전 기록 N건 row, their worker runs inside (lina-app#157, #161). */}
              {roundGroups(rounds).map((group) =>
                Array.isArray(group) ? (
                  <details key={`fold:${group[0].n}`} class="round-fold" data-testid="round-fold">
                    <summary class="round-head">{DETAIL_WORD.earlierRecords(group.length)}</summary>
                    {group.map((round) => (
                      <RoundSection key={round.n} round={round} line={null} workers={round.workers.length ? <WorkerRows ids={round.workers} model={model} seen={seen} state={workerState} /> : null} />
                    ))}
                  </details>
                ) : (
                  <RoundSection key={group.n} round={group} line={group.line} workers={group.workers.length ? <WorkerRows ids={group.workers} model={model} seen={seen} state={workerState} /> : null} />
                ),
              )}
              {outside.length ? <WorkerRows ids={outside} model={model} seen={seen} state={workerState} /> : null}
            </Box>
          ) : null
        }
      />
      <CardComments comments={detail.comments} />
    </article>
  );
}

/** One round of the 실행 box: its head, its own line when one may show, and its worker runs. */
function RoundSection({ round, line, workers }: { round: Round; line: string | null; workers: ComponentChildren }) {
  const { now } = useApp();
  return (
    <section class={round.startedAt === null ? "round is-no-start" : "round"} data-testid="round">
      <h3 class="round-head">{roundHead(round, now)}</h3>
      {line ? (
        <p class="round-line" data-testid="round-line">
          {roundLine(line)}
        </p>
      ) : null}
      {workers}
    </section>
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
      <CardHead work={row.work} title={run.plain.title ?? listedTitle ?? model.cards.get(id)?.title ?? null}>
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
