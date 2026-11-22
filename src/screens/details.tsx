import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ItemDetail, ItemSummary, RecordRow, WorkCardDetail, WorkState } from "../api/client";
import { KoreanInput } from "../korean-input";
import { cardNow, doneFor, goalCards, goalState, isRetryRequest, itemContext, itemLine, itemWords, ownTitle, runRow, todoState, waitsOnOwner, wholeTitle, type CardRow, type CardSummary, type ItemLine, type Model, type StopReasonText } from "../model";
import { foldReason, wholeText } from "../model/fold";
import { plainText } from "../model/plain";
import { holds } from "../model/rounds";
import { stopReason } from "../model/stop-reason";
import { answerOf, commentHistory, decisionHistory, goalHistory, historyLines, isMachineNotice, outcomeOf, ownerWrote, roundResult, roundSentence } from "../model/timeline";
import type { CardKind } from "../model/kind";
import { isRunId, newestFirst, type Store } from "../data/store";
import { back, baseOf, href, isFrame, navigate, parse, tabOf, type Route } from "../router";
import { ago, clockAt, dayLabel } from "../time";
import { useActions } from "../ui/actions";
import { agentName, Box, CardRowView, CheckBox, DoneCheck, ErrorLine, itemTime, KindMark, Link, Progress, sinceText, StateText, StateTime, cardTime, cardTook, stateWords, useApp } from "../ui/parts";
import { DETAIL_WORD, reasonWord, ROUND11_WORD, ROUND9_WORD, RUN_LINE_WORD, SEP, STATE_WORD, stateLabel, W, waitWord } from "../words";
import { PastEvents, RunModelLine, Timeline, type PastEvent } from "./timeline";
import { Comments, FoldLine, SendButton } from "./comments";
import { FinishedLine } from "./lists";
import { Talk } from "./talk";
import { CardReports } from "../report/viewer";

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
 * An item's head title: its goal's name, then its own (itemContext), in every state, the line 1 its 결정 필요 row reads
 * (lina-app#157, #170); the record's title when neither may be drawn. The head never changes as a decision is answered.
 */
function itemHead(model: Model, detail: ItemDetail): string {
  return itemContext(model.items, detail) || detail.title;
}

/**
 * The 결정 필요 row an item's open decision is listed as in 수신함: the item's head reads that row's question as its second
 * line, under the name the row reads (itemHead), so the detail opens with the row that was pressed (lina-app#157).
 */
function useDecisionRow(id: string): { text: string } | null {
  const { model } = useApp();
  const answering = useAnswering();
  const pressed = useRef<{ id: string; row: { text: string } } | null>(null);
  const row = model.inbox.rows.find((each) => each.type === "decide" && each.target.kind === "item" && each.target.id === id);
  const shown = row?.type === "decide" ? { text: row.text } : null;
  if (shown) pressed.current = { id, row: shown };
  // The row leaves 수신함 as its answer is sent; the head keeps the line that was pressed (lina-app#166).
  return shown ?? (answering(`decide:${id}`) && pressed.current?.id === id ? pressed.current.row : null);
}

/**
 * The item with its comments' markdown markers out (plainText), the owner's left as saved (lina-app#226): a comment that
 * was only markers and spaces, with no reply, is no comment at all, never an empty or folded row (lina-app#166).
 */
function plainItem(detail: ItemDetail, owner: string | null | undefined): ItemDetail {
  const plain = <T extends { readonly text: string; readonly by: string }>(entries: readonly T[]) => entries.map((entry) => ({ ...entry, text: ownerWrote(entry.by, owner) ? (entry.text.trim() ? entry.text : "") : plainText(entry.text) }));
  return { ...detail, comments: plain(detail.comments).map((comment) => ({ ...comment, replies: plain(comment.replies).filter((reply) => reply.text) })).filter((comment) => comment.text || comment.replies.length) };
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
 * box has no head, no age, no state word and no sentence the head shows (lina-app#161, #179: the head's state line is the
 * word its 수신함 row reads). A card's question names the decision's wait, as its 수신함 row does.
 */
function DecisionBox({ text, agent, at, word = ROUND11_WORD.decisionWait, title = W.decide }: { text: string | null; agent: string | null; at: number | null; word?: string | null; title?: string | null }) {
  const { model, now } = useApp();
  return (
    <Box title={title ?? undefined} testid="decision">
      {text ? <p class="box-text">{text}</p> : null}
      <span class="sub">{[agentName(model, agent), word, at ? ago(now - at) : null].filter(Boolean).join(SEP)}</span>
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
      <DecisionBox text={headLine ? null : plainText(detail.decision.text)} agent={detail.agent} at={null} word={null} title={null} />
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

/**
 * A goal's or to-do's state line on its own page (itemLine): a goal reads the same fold of its cards as the work tab, a
 * stopped card makes it 중단됨 (lina-app#148); so does a to-do, of the cards its runs take it on in (lina-app#170). An open
 * decision dates it as its 수신함 row does, from when it was asked (lina-app#149, #179).
 */
function useItemLine(detail: ItemDetail): ItemLine {
  const { model, store } = useApp();
  // A goal's head reads the fold its rows read, the lists' one snapshot (lina-app#157, #231); only a goal no list holds
  // folds its detail's own cards.
  const goal = detail.kind === "goal" ? (model.goals.find((each) => each.id === detail.id) ?? goalState(model, detail, store.get("goals"))) : null;
  return itemLine(model, detail.id, goal ?? todoState(model, detail), detail.decision, detail.due);
}

/** A goal's or to-do's state line with its time: its state words, 지남 when it is overdue (itemWords, lina-app#221). */
function ItemState({ line, time }: { line: ItemLine; time: string }) {
  return (
    <span class="sub">
      <span class="state" data-state={line.state} data-testid="state">
        {itemWords(line)}
      </span>
      {time ? <span class="time">{`${SEP}${time}`}</span> : null}
    </span>
  );
}

/** The head's check box with its state line, 되돌리기 while the owner's mark can be taken back, and a goal's question. */
function DoneHead({ detail }: { detail: ItemDetail }) {
  const actions = useActions();
  const answering = useAnswering();
  const { model, now } = useApp();
  const [asking, setAsking] = useState(false);
  const line = useItemLine(detail);
  const open = detail.kind === "goal" ? detail.children.filter((child) => !actions.isDone(child.id, child.state === "done")).map((child) => child.id) : [];
  const withIds = detail.ownerDone?.with ?? [];
  const shown = actions.isDone(detail.id, detail.state === "done");
  const until = actions.undoUntil(detail.id, detail.ownerDone?.undoUntil);
  const showUndo = shown && until !== null && now < until && actions.toast?.owner !== detail.id;
  // An answered decision no longer waits on the owner: the head reads 답함 and when, until the item moves on (lina-app#153).
  // So does one whose answer waits for its toast (lina-app#166).
  const answered = (detail.decision?.answered || (detail.decision && answering(`decide:${detail.id}`))) && detail.state !== "done";
  const answer = answered && detail.decision?.answered ? answerOf(detail) : null;
  // A goal whose record disagrees with itself says how in one line under its state, as its rows do (lina-app#237, #242).
  const why = detail.kind === "goal" ? (model.goals.find((each) => each.id === detail.id)?.why ?? null) : null;
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
          <ItemState line={line} time={itemTime(line, now)} />
        )}
        {showUndo ? (
          <button type="button" class="text-button head-undo" disabled={actions.busy(`done:${detail.id}`)} onClick={() => void actions.undoDone(detail.id, withIds)}>
            {W.undo}
          </button>
        ) : null}
      </div>
      {why ? (
        <span class="sub" data-testid="goal-why">
          {why}
        </span>
      ) : null}
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

/**
 * A goal's to-do line, in its goal page from 작업 and from 대화: its state is the work tab's fold (todoState, lina-app#170),
 * and the to-do's own head's line while a decision on it is open (itemLine, lina-app#179).
 */
function TodoLine({ todo }: { todo: ItemSummary }) {
  const actions = useActions();
  const { model, now } = useApp();
  const shown = actions.isDone(todo.id, todo.state === "done");
  const line = itemLine(model, todo.id, todoState(model, todo), undefined, todo.due);
  return (
    <li class={`row check-row${shown ? " is-checked" : ""}`} data-testid="row">
      <DoneCheck id={todo.id} title={todo.title} done={todo.state === "done"} />
      <Link href={href({ name: "item", id: todo.id })} label={[todo.title, itemWords(line)].join(SEP)}>
        <span class="lines">
          <span class="title one-line">{todo.title}</span>
          <ItemState line={line} time={itemTime(line, now)} />
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
  // Its merges (the finished cards' evidence), question, runs, comments and close, one line each. An open
  // question is the box and the head above, so it is no history line until it is answered (lina-app#161).
  const open = detail.decision && !detail.decision.answered;
  const owner = store.get("items")?.owner?.id;
  const plain = plainItem(detail, owner);
  const history = goalHistory(open ? { ...plain, decision: null } : plain, evidence, owner);
  const decisionRow = useDecisionRow(detail.id);
  // The sentence its row draws under its name, by the one rule (wholeTitle, lina-app#231): no issue reference shows.
  const condition = wholeTitle(detail.doneCondition);
  return (
    <article class="detail" data-testid="screen-goal">
      <Header title={itemHead(model, detail)} line={decisionRow?.text}>
        <DoneHead detail={detail} />
      </Header>
      <ItemDecision key={detail.id} detail={detail} headLine={decisionRow?.text} />
      {condition ? (
        <Box title={W.doneCondition}>
          <p class="box-text">{condition}</p>
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
      {/* Every linked card, a stopped one too (`count` leaves those out): the rows the work tab shows (lina-app#170). */}
      {cards.rows.length ? (
        <Box title={W.cards}>
          <ul class="rows" aria-label={W.cards}>
            {/* The finished cards nothing names are one line, drawn as 완료 draws it (lina-app#242). */}
            {cards.rows.map((card) => (card.repeat ? <FinishedLine key={card.key} line={card} /> : <CardRowView key={card.key} card={card} />))}
          </ul>
        </Box>
      ) : null}
      {history.length ? (
        <Box title={W.record} testid="goal-history">
          <ul class="history-rows" aria-label={W.record}>
            {history.map((row, index) =>
              row.held.length ? (
                <li key={`${row.at}:${index}`} class="history-row" data-testid="history-row" data-kind={row.kind}>
                  <FoldLine label={row.text} held={row.held} at={row.at} />
                </li>
              ) : (
                <HistoryLine key={`${row.at}:${index}`} at={row.at} text={row.text} kind={row.kind} />
              ),
            )}
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
  const { model, store, wide } = useApp();
  // An answered decision's question and answer are history (lina-app#153); an open one is its box above.
  const owner = store.get("items")?.owner?.id;
  const plain = plainItem(detail, owner);
  const history = detail.decision?.answered ? historyLines(decisionHistory(plain)) : [];
  const decisionRow = useDecisionRow(detail.id);
  return (
    <article class="detail" data-testid="screen-item">
      <Header title={itemHead(model, detail)} line={decisionRow?.text}>
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

/**
 * Each round's own line as history reads it, newest first (lina-app#157, #236, criterion 2): its line when it stands on
 * it (roundResult), else the one sentence of it that does (roundSentence), else none: never a comment's (lina-app#269).
 */
function roundLines(rounds: readonly Round[]): Map<Round, string | null> {
  const used = new Set<string>();
  return new Map(rounds.map((round) => [round, roundResult(round.line) ?? roundSentence({ result: round.line, said: [] }, used)]));
}

/**
 * The rounds in order, every round whose own line may not show gathered into one group after the last (lina-app#161,
 * criterion 2): it is one 이전 기록 N건 row, not one row per round, and never a row between two rounds' lines.
 */
function roundGroups(rounds: readonly Round[], lines: Map<Round, string | null>): (Round | Round[])[] {
  const shows = (round: Round) => round.line === null || Boolean(lines.get(round));
  const folded = rounds.filter((round) => !shows(round));
  return [...rounds.filter(shows), ...(folded.length ? [folded] : [])];
}

/**
 * A work card's comments, one history line each, newest first: its time and the owner's words as saved, or a bot's
 * whole text when it stands whole (wholeText, lina-app#236); its author is the line's tooltip. A machine notice is no
 * line, each run of comments that do not stand whole is one 접힌 댓글 line with their count (lina-app#149), and a line
 * drawn more than once is one line with `×n` (commentHistory, lina-app#230). A comment that was only markdown markers and
 * spaces is no line at all (lina-app#166). `records` are the comment rows of its worker runs' records (lina-app#174):
 * each is drawn once, and never when the card holds the comment it was cut from. A record row has no author: the core
 * makes it from a receipt's note (a verdict note, a cancel reason, which on the hub an agent writes), joined to one line
 * and cut at 300 characters with no mark, so it goes through the one gate as any comment whose author is not the owner:
 * a cut one is longer than a whole line may be, and folds. Only a comment whose author is the owner is drawn as saved (lina-app#226).
 */
export function cardCommentLines(comments: WorkCardDetail["comments"], records: readonly RecordRow[], owner: string | undefined) {
  const oneLine = (text: string) => plainText(text).split(/\s+/).join(" ").trim();
  const held = comments.map((comment) => oneLine(comment.body));
  const recorded = records.filter((row, index, all) => {
    const text = oneLine(row.text ?? "");
    return row.kind === "comment" && !held.some((body) => body.startsWith(text)) && all.findIndex((other) => other.at === row.at && other.text === row.text) === index;
  });
  const own = comments.filter((comment) => plainText(comment.body)).map((comment) => ({ id: String(comment.id), at: comment.createdAt, author: comment.author, body: comment.body }));
  const fromRecord = recorded.filter((row) => plainText(row.text ?? "")).map((row, index) => ({ id: `record:${row.at}:${index}`, at: row.at, author: null, body: row.text ?? "" }));
  return commentHistory([...own, ...fromRecord], owner);
}

function CardComments({ lines }: { lines: ReturnType<typeof cardCommentLines> }) {
  const { model } = useApp();
  if (!lines.length) return null;
  return (
    <Box title={W.comments} testid="card-comments">
      <ul class="history-rows" aria-label={W.comments}>
        {lines.map((line) =>
          line.text === null ? (
            <li key={line.id} class="history-row" data-testid="history-row" data-kind="comment">
              <FoldLine label={W.foldedRun(line.folded)} held={line.held.map((held) => ({ at: held.at, by: held.author, text: held.body }))} at={line.at} />
            </li>
          ) : (
            <HistoryLine key={line.id} at={line.at} text={line.count > 1 ? `${line.text} ${W.repeated(line.count)}` : line.text} kind="comment" who={agentName(model, line.author)} />
          ),
        )}
      </ul>
    </Box>
  );
}

/**
 * Where to answer a read-only card that waits on the owner (lina-app#171): the 대화 of the agent that owns it, when the card
 * names one the app knows. Text and a link only: a read-only card has no write control at all (lina-app#149), so no line
 * says it cannot be changed (G138).
 */
function AnswerWhere({ agent = null }: { agent?: string | null }) {
  const { model } = useApp();
  const owner = model.agents.find((each) => each.id === agent);
  return owner ? (
    <span class="sub answer-where" data-testid="answer-where">
      {`${ROUND9_WORD.answerWhere}${SEP}`}
      <Link href={href({ name: "talk", id: owner.id })}>{ROUND9_WORD.talkWith(owner.name)}</Link>
    </span>
  ) : null;
}

/** What a card does now as its 지금 box says it (cardNow): none on a stopped card whose head already says the same words. */
function nowShown(text: string | null | undefined, state: WorkState, stop: CardRow["stop"]): string | null {
  if (!text) return null;
  return state === "stopped" && [stop?.words, stop?.reason?.text].some((said) => said?.includes(text)) ? null : text;
}

/**
 * The cards a folded line stands for (lina-app#171), in the detail it opens: one `time · state · sentence` line each, the
 * opened card first, then newest first, each the link to its own card. The sentence is its result line, else the first
 * sentence of its latest note a person may read, else its own name. The cards nothing names, when they are several
 * agents', say how many each agent has instead, each the link to that agent's 완료 (lina-app#237).
 */
function FoldMembers({ id, fold, byAgent }: { id: string; fold: readonly CardRow[] | undefined; byAgent: boolean }) {
  const { model, store, now } = useApp();
  if (!fold) return null;
  if (byAgent) {
    const counts = new Map<string, number>();
    for (const card of fold) counts.set(card.agent ?? "", (counts.get(card.agent ?? "") ?? 0) + 1);
    return (
      <Box title={ROUND9_WORD.foldMembers(fold.length)} testid="fold-members">
        <ul class="history-rows" aria-label={ROUND9_WORD.foldMembers(fold.length)}>
          {[...counts].sort((a, b) => b[1] - a[1]).map(([agent, count]) => (
            <li key={agent} class="history-row" data-testid="fold-agent">
              <Link href={href(agent ? { name: "done", agent } : { name: "done" })}>{[agentName(model, agent), W.cardsCount(count)].filter(Boolean).join(SEP)}</Link>
            </li>
          ))}
        </ul>
      </Box>
    );
  }
  const note = (cardId: string) => wholeText(store.get("cards")?.cards.find((card) => card.id === cardId)?.now);
  const cards = [...fold.filter((card) => card.id === id), ...fold.filter((card) => card.id !== id)];
  // A card nothing names has no sentence of its own: its line is its time and state, never the kind word (lina-app#242).
  return (
    <Box title={ROUND9_WORD.foldMembers(cards.length)} testid="fold-members">
      <ul class="history-rows" aria-label={ROUND9_WORD.foldMembers(cards.length)}>
        {cards.map((card) => {
          const at = card.endedAt ?? card.stateAt ?? card.startedAt;
          const line = [at === null ? "" : clockAt(at, now), stateWords(card.state, card.reason, card.stop), card.result ?? note(card.id) ?? card.own ?? (card.title === null ? "" : card.name)].filter(Boolean).join(SEP);
          return (
            <li key={card.id} class="history-row" data-testid="fold-member">
              <Link href={card.href}>{line}</Link>
            </li>
          );
        })}
      </ul>
    </Box>
  );
}

/**
 * The line of the cards nothing names that a group's address names (lina-app#244): the one its list draws with that
 * card newest, from that list (every agent's 완료, one agent's, or a goal's work list), never another list's.
 */
export function groupOf(route: Extract<Route, { name: "group" }>, model: Model, store: Store): CardRow | undefined {
  const goal = route.goal ? store.get("item", route.goal) : undefined;
  const rows = route.goal
    ? goal
      ? goalCards(model, goal, { goals: goal.workCards.map((id) => store.get("goal", id)).filter((each) => each !== undefined) }).cards.rows
      : []
    : route.agent
      ? doneFor(model, route.agent)
      : model.home.finished.rows;
  return rows.find((line) => line.title === null && line.id === route.id && line.fold);
}

/**
 * The detail of a line of the cards nothing names, opened from that line (lina-app#242) at its own address (lina-app#244):
 * it speaks of the line, never of the one card it opens first. Its head is the line's name (how many cards), 완료 with
 * the newest card's time said as such, and how many agents' cards it holds (or the one agent's name); under it the cards
 * by agent (FoldMembers).
 */
export function GroupScreen({ route }: { route: Extract<Route, { name: "group" }> }) {
  const { model, store, now } = useApp();
  const line = groupOf(route, model, store);
  // A list read only in part, or a goal not read yet, may still hold the line.
  if (!line?.fold) return !model.finished.all || (route.goal && store.status("item", route.goal) === "pending") ? <Loading /> : <Missing />;
  const fold = line.fold;
  const agents = new Set(fold.map((card) => card.agent)).size;
  return (
    <article class="detail" data-testid="screen-card">
      <Header title={line.name}>
        <span class="sub" data-testid="group-head">
          <span class="state" data-state="done">
            {STATE_WORD.done}
          </span>
          {line.endedAt === null ? null : <span class="time">{`${SEP}${W.newest(ago(now - line.endedAt))}`}</span>}
        </span>
        <span class="sub" data-testid="group-agents">
          {agents > 1 ? W.agentsCount(agents) : agentName(model, line.agent)}
        </span>
      </Header>
      <FoldMembers id={line.id} fold={fold} byAgent={agents > 1} />
    </article>
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
  return state === "stopped" && Boolean(row?.stop) && !(readOnly && waitsOnOwner(state, reason, row));
}

function HeadState({ state, reason, row, time, readOnly = false }: { state: WorkState; reason: string | null; row: CardRow | undefined; time: string; readOnly?: boolean }) {
  if (readOnly && waitsOnOwner(state, reason, row)) return <StateTime state={state} time={time} />;
  // A reason longer than the row says is said whole under the state line, which keeps the words before it (lina-app#171).
  const stop = state === "stopped" && row?.stop ? { ...row.stop, words: row.stop.reason?.lead ?? stopReason(row).word } : undefined;
  return <StateTime state={state} reason={reason} stop={stop} time={time} />;
}

/**
 * Why a stopped card stopped, one line under its state line (lina-app#157): what it waits for by the core's reason
 * (결정 대기, 피드백 대기, else the reason's own word) and its ask; 이유 없음 when the card gives neither. A reason longer
 * than its row says (`whole`) is said once, all of it, wrapped, under the words before it (lina-app#171). When the newest
 * of its comments is the owner's, made after the stop, a second line says the owner decided and the state has not
 * moved yet. The owner's 다시 시도 is no decision (lina-app#211): while its row reads `<agent>에게 요청함`, the head
 * says the same words; a decision as well still has its own line.
 */
function StopWhy({ reason, words, whole = null, carried, stoppedAt, comments = [], card }: { reason: string | null; words: string | null | undefined; whole?: StopReasonText | null; carried: boolean; stoppedAt: number | null; comments?: WorkCardDetail["comments"]; card?: CardRow }) {
  const { model, store } = useApp();
  const actions = useActions();
  const owner = store.get("items")?.owner?.id ?? "owner";
  const word = waitWord(reason) ?? reasonWord(reason);
  // The row's own rule (RetryControl in lists.tsx): a card it offers 다시 시도 on, asked in its comments or from this page.
  const requested = Boolean(card?.stop?.retry && (card.asked || actions.requested(card.key)));
  const newest = comments.filter((comment) => !isMachineNotice(comment.body, comment.author) && !isRetryRequest(comment, owner)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const decided = stoppedAt !== null && newest !== undefined && (newest.author === owner || newest.author === "owner") && newest.createdAt > stoppedAt;
  return (
    <>
      {carried ? null : (
        <span class="sub" data-testid="stop-why">
          {whole?.lead || words || word || DETAIL_WORD.noReason}
        </span>
      )}
      {whole?.folded ? <FoldLine label={DETAIL_WORD.foldedReason} held={[{ at: stoppedAt, by: card?.agent ?? null, text: whole.text }]} /> : whole ? <WholeReason text={whole.text} /> : null}
      {requested && card ? (
        <span class="sub" data-testid="requested-since-stop">
          {W.requestedTo(agentName(model, card.agent))}
        </span>
      ) : null}
      {decided ? (
        <span class="sub" data-testid="decided-since-stop">
          {DETAIL_WORD.decidedSinceStop}
        </span>
      ) : null}
    </>
  );
}

/**
 * A stop's reason that the one gate passes, all of it (lina-app#241): three lines at most until 더 보기 opens it, so the
 * question it asks the owner is always in it or one tap away; 더 보기 shows only when the three lines cut it.
 */
function WholeReason({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const reason = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const measure = () => setCut(Boolean(reason.current && reason.current.scrollHeight > reason.current.clientHeight + 1));
    if (!open) measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, open]);
  return (
    <>
      <span ref={reason} class={open ? "sub wrap-line stop-reason" : "sub wrap-line stop-reason is-clamped"} data-testid="stop-reason">
        {text}
      </span>
      {cut || open ? (
        <button type="button" class="fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? DETAIL_WORD.close : DETAIL_WORD.more}
        </button>
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
function WorkerRows({ ids, model, seen, state, link }: { ids: readonly string[]; model: Model; seen: (runId: string) => number | null; state: (runId: string) => string; link: (runId: string) => string }) {
  const { now } = useApp();
  // Newest first, as every history (lina-app#157).
  const startOf = (workerId: string) => model.runs.get(workerId)?.startedAt ?? seen(workerId);
  const ordered = [...ids].sort((a, b) => (startOf(b) ?? 0) - (startOf(a) ?? 0));
  return (
    <ul class="rows" aria-label={W.record}>
      {ordered.map((workerId) => {
        const run = model.runs.get(workerId);
        const row = run ? runRow(run) : null;
        const at = run?.startedAt ?? seen(workerId);
        const line = [at ? clockAt(at, now) : "", row ? stateWords(row.state, row.reason, row.stop) : state(workerId)].filter(Boolean).join(SEP);
        return (
          <li key={workerId} class="row card-row is-dim" data-testid="row">
            <Link href={link(workerId)} label={line}>
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
 * The title of a worker run the board does not list: the core serves no title of its own for it, so it reads the name of
 * the work card it ran for as that card's row reads it (its goal's title first, lina-app#122, else its own title, else its
 * kind word, lina-app#248), or 제목 없음 when the board does not know the card (lina-app#61 and #128).
 */
export function workerTitle(model: Model, cardId: string | null | undefined): string {
  return (cardId ? model.cards.get(cardId)?.name : undefined) ?? W.untitledRun;
}

/**
 * A to-do's run by the one naming rule: its checked title when the board lists it, a card's worker run its card's name
 * as its page reads it (lina-app#248), never raw text in its place.
 */
function runName(model: Model, run: ItemDetail["runs"][number]): string {
  const listed = model.runs.get(run.id);
  if (listed) return runRow(listed).name;
  const owner = model.runOwner.get(run.id);
  return owner || foldReason(run.title) ? workerTitle(model, owner) : run.title;
}

/** The round of its card a worker run the board does not list was, once the card's detail is read. */
function workerRound(model: Model, store: Store, runId: string): Round | undefined {
  const owner = model.runOwner.get(runId);
  const detail = owner ? store.get("card", owner) : undefined;
  return detail ? workerRounds(detail).rounds.find((round) => round.workers.includes(runId)) : undefined;
}

/** Whether a worker run still goes: its own state, or for a run the board does not list, its card's. */
function runLive(model: Model, runId: string): boolean {
  const run = model.runs.get(runId);
  if (run) return run.state === "in_progress";
  const owner = model.runOwner.get(runId);
  return owner ? model.cards.get(owner)?.state === "in_progress" : false;
}

/**
 * The state word of a worker run, its own end and not its card's state (lina-app#61): going while it beats, and for a run
 * the board does not list only while its own round has no end (a running card's earlier runs ended with their rounds),
 * else how its round ended.
 */
function workerState(model: Model, store: Store, runId: string): string {
  const round = workerRound(model, store, runId);
  if (runLive(model, runId) && (model.runs.has(runId) || !round || round.endedAt === null)) return STATE_WORD.in_progress;
  if (!round) return RUN_LINE_WORD.noResult;
  return round.endedAt !== null ? W.outcome.ended : STATE_WORD.stopped;
}

export function CardScreen({ id }: { id: string }) {
  const { model, store, now } = useApp();
  const answering = useAnswering();
  // The card whose history and comments stand on screen: a record read after that adds to them in place.
  const drawn = useRef<string | null>(null);
  const detail = store.get("card", id);
  const row = model.cards.get(id);
  // The work tab's row of the card: one of several under one title, in its group or another, leads with its own name
  // (lina-app#242), so the head reads that name and its goal's title is the 목표 line under it. A finished card reads
  // the 완료 line it stands in.
  const listed =
    [...model.running.rows, ...model.home.planned.rows, ...model.home.waiting.rows, ...model.home.review.rows.flatMap((each) => (each.type === "review" ? [each.card] : []))].find((card) => card.id === id) ??
    model.home.finished.rows.find((line) => line.title !== null && (line.fold ?? [line]).some((card) => card.id === id));
  const led = listed && listed.title !== null && listed.name !== listed.title ? { name: listed.name, goal: listed.title } : null;
  if (!detail) {
    if (store.status("card", id) === "missing") return <Missing />;
    if (!row) return <Loading />;
    // The card's detail is read only now that it is open: its list row's head and now line show while it comes.
    return (
      <article class="detail" data-testid="screen-card">
        <CardHead work={row.work} title={led?.name ?? row.title}>
          <HeadState state={row.state} reason={row.reason} row={row} time={[cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP)} readOnly={row.readOnly} />
          {row.state === "stopped" ? <StopWhy reason={row.reason} words={row.stop?.words} whole={row.stop?.reason} carried={stateSaysWhy(row.state, row.reason, row, Boolean(row.readOnly))} stoppedAt={row.stateAt} card={row} /> : null}
          <OwnTitleLine own={row.own} title={led?.name ?? row.title} />
          {led ? (
            <span class="sub" data-testid="card-goal">
              {[W.goals, led.goal].join(SEP)}
            </span>
          ) : null}
          {row.readOnly && waitsOnOwner(row.state, row.reason, row) ? <AnswerWhere agent={row.agent} /> : null}
        </CardHead>
        {nowShown(row.now, row.state, row.stop) ? (
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
  // The history and comments wait for the records of the card's worker runs, read only once its detail named them
  // (lina-app#217): drawn from the detail alone they read `이전 기록 N건` and then grow when the records land. The
  // records are read newest run first (lina-app#232, #253): once those in so far, up to the first still out, hold a round,
  // the history draws from them, and each later one adds below in place (an older run's rounds are older, and the history
  // is newest first); the comments, which take theirs too, wait for them all. Only that first draw holds back the runs
  // not yet landed: a card already drawn that gains a newer run keeps every record on screen while the new one is read.
  const pending = drawn.current !== id && workerRuns.some((worker) => store.status("record", worker.id) === "pending");
  const order = newestFirst(workerRuns);
  const out = order.findIndex((runId) => store.status("record", runId) === "pending");
  const landed = new Set(out < 0 ? order : order.slice(0, out));
  const filling = pending && [...landed].some((runId) => Boolean(store.get("record", runId)?.rounds.length));
  const reading = pending && !filling;
  if (!pending) drawn.current = id;
  const workerStateOf = (runId: string) => workerState(model, store, runId);
  const seen = (runId: string) => workerRuns.find((worker) => worker.id === runId)?.firstSeenAt ?? null;
  // A stop that waits on the owner's answer has the place to answer right here (lina-app#142).
  const ask = row ? stopReason(row).ask : undefined;
  // The worker run a record block was, the same run its head opens (lina-app#245): the run whose record holds it. Each
  // run's record numbers its rounds from 1; only when the card round of the same number and time holds other runs and
  // not this one does the block stand for that round's run (one run serving the card's one record, lina-app#153).
  const roundRun = (runId: string, n: number, at: number) => {
    const round = rounds.find((candidate) => candidate.n === n && holds({ start: candidate.startedAt, end: candidate.endedAt }, at));
    return round?.workers.length && !round.workers.includes(runId) ? round.workers[0] : runId;
  };
  const workerLink = (runId: string) => workerHref(detail, runId);
  // The goal (project) the card serves, in its head; a goal title that would show raw text is left out.
  const goal = store.get("goals")?.goals.find((candidate) => candidate.workCards.some((card) => card.id === id));
  const goalLine = (goal && !foldReason(goal.title) ? goal.title : null) ?? led?.goal ?? null;
  // A card from a board the core only reads (lina#481) has no place to answer and no other write (lina-app#149).
  const readOnly = Boolean(detail.readOnly || row?.readOnly);
  // An old done card the core keeps no history for (`detail: false`) says so instead of an empty frame.
  const kept = store.get("cards")?.cards.find((card) => card.id === id)?.detail !== false;
  // The head reads the name of the row that was tapped (its goal's title when the row leads with it); the card's own
  // title is the line under it when it differs (lina-app#153), read by its row's rule (ownTitle).
  const own = ownTitle(detail) ?? row?.own ?? null;
  // A card opened by its address before the list holds its row: its name is the row's, so the head reads 불러오는 중 until
  // the list is read, never 제목 없음 (lina-app#253), which stays for a card the board does not know. A list read that
  // failed is no read out: the head reads its goal's title first, as its row would (lina-app#122, #258), then the
  // detail's title, instead of waiting for a read nothing repeats.
  const cardsStatus = store.status("cards");
  const unlisted = !row && (cardsStatus === "pending" || (!model.finished.all && cardsStatus !== "failed"));
  const title = unlisted ? null : (led?.name ?? row?.title ?? (!row && cardsStatus === "failed" ? goalLine : null) ?? own);
  // The head reads the state of the row that was pressed, the list's snapshot, until the next refresh moves both; the
  // detail read later may already say another (lina-app#157). A card with no row reads its detail's.
  const state = row?.state ?? detail.state;
  const reason = row ? row.reason : detail.reason;
  // One 댓글 section (lina-app#174): the card's comments box also holds the comments between rounds that only its worker
  // runs' record has, once each; one the card holds (a machine notice it leaves out too) is never drawn again.
  const records = workerRuns.flatMap((worker) => store.get("record", worker.id)?.comments ?? []);
  const ownerId = store.get("items")?.owner?.id;
  const commentLines = cardCommentLines(detail.comments, records, ownerId);
  const lines = roundLines(rounds);
  const foldLine = model.home.finished.rows.find((line) => line.fold?.some((card) => card.id === id));
  const fold = foldLine?.fold;
  const askHere = Boolean(ask && !readOnly && !everyQuestion.length && !answering(`answer:${id}`));
  // What the card does now (G138), from the one function its row reads too: the 지금 box and its going round's line in 기록.
  const summary = store.get("cards")?.cards.find((card) => card.id === id) as CardSummary | undefined;
  const doing = cardNow({ state, plain: detail.plain, reason, waitingOn: summary?.waitingOn, retry: summary?.retry }, everyQuestion.length > 0);
  const nowLine = nowShown(doing?.text, state, row?.stop);
  const nothing = cardShowsNothing({ kept, fold: Boolean(fold), questions: questions.length + (askHere ? 1 : 0), now: Boolean(nowLine), result: Boolean(detail.plain.result), todos: detail.todos.length, steps: detail.plain.history?.length ?? 0, workers: workerRuns.length, comments: commentLines.length });
  return (
    <article class="detail" data-testid="screen-card">
      <CardHead work={row?.work ?? "code"} title={title} untitled={unlisted ? W.loading : undefined}>
        <HeadState state={state} reason={reason} row={row} time={row ? [cardTime(row, now), cardTook(row)].filter(Boolean).join(SEP) : ""} readOnly={readOnly} />
        {state === "stopped" ? <StopWhy reason={reason} words={row?.stop?.words} whole={row?.stop?.reason} carried={stateSaysWhy(state, reason, row, readOnly)} stoppedAt={row?.stateAt ?? detail.lastHeartbeatAt ?? null} comments={detail.comments} card={row} /> : null}
        {unlisted ? null : <OwnTitleLine own={own} title={title} />}
        {goalLine && goalLine !== title ? (
          <span class="sub" data-testid="card-goal">
            {[W.goals, goalLine].join(SEP)}
          </span>
        ) : null}
        {state === "in_progress" && detail.todoProgress.total > 0 ? <Progress done={detail.todoProgress.done} total={detail.todoProgress.total} word /> : null}
        {readOnly && waitsOnOwner(state, reason, row) ? <AnswerWhere agent={row?.agent ?? detail.agent} /> : null}
      </CardHead>
      <FoldMembers id={id} fold={fold} byAgent={foldLine?.title === null && new Set(fold?.map((card) => card.agent)).size > 1} />
      <CardReports id={id} />
      {/* Each question with the place to answer it, keyed as its 수신함 row, so answering here hides that row too. */}
      {questions.map((question) => (
        <Fragment key={question.commentId}>
          <DecisionBox text={plainText(question.body)} agent={question.agent} at={question.askedAt} />
          {readOnly ? null : <AnswerPlace key={question.commentId} answerKey={`question:${id}:${question.commentId}`} target={{ kind: "card", id }} label={W.answerField} testid="decision-answer" />}
        </Fragment>
      ))}
      {ask && askHere ? (
        <Box>
          <AnswerPlace key={`answer:${id}`} answerKey={`answer:${id}`} target={{ kind: "card", id }} label={ask} testid="card-answer" />
        </Box>
      ) : null}
      {nowLine ? (
        <Box title={W.now} testid="card-now">
          <p class="box-text">{nowLine}</p>
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
      {nothing ? (
        <p class="empty" data-testid="card-nothing">
          {ROUND11_WORD.nothingYet}
        </p>
      ) : null}
      {/* One round list, one name (기록, lina-app#179): the record's blocks, each head the link to its worker run. The worker
          runs' box stands only while the record is not shown, and under the 기록 box's error line, with no head of its own,
          when the read failed, so the worker links never disappear. */}
      {reading ? (
        <Loading />
      ) : (
        <>
          <Timeline
            runs={workerRuns.map((worker) => worker.id).filter((runId) => !pending || landed.has(runId))}
            boxed
            history={detail.plain.history ?? []}
            workers={{ ids: workerRuns.map((worker) => worker.id), href: workerLink, draw: (ids) => <WorkerRows ids={ids} model={model} seen={seen} state={workerStateOf} link={workerLink} /> }}
            doing={doing?.text ?? null}
            live={(runId) => runLive(model, runId)}
            link={(runId, n, at) => workerLink(roundRun(runId, n, at))}
            modelRun={roundRun}
            fallback={
              workerRuns.length ? (
                <Box testid="worker-runs">
                  {/* A round's own line is its content, its ids cut; rounds whose line would show a path or a command are no
                      comment: each run of them is one folded 이전 기록 N건 row, their worker runs inside (lina-app#157, #161). */}
                  {roundGroups(rounds, lines).map((group) =>
                    Array.isArray(group) ? (
                      <details key={`fold:${group[0].n}`} class="round-fold" data-testid="round-fold">
                        <summary class="round-head">{DETAIL_WORD.earlierRecords(group.length)}</summary>
                        {group.map((round) => (
                          <RoundSection key={round.n} round={round} line={null} workers={round.workers.length ? <WorkerRows ids={round.workers} model={model} seen={seen} state={workerStateOf} link={workerLink} /> : null} />
                        ))}
                      </details>
                    ) : (
                      <RoundSection key={group.n} round={group} line={lines.get(group) ?? null} workers={group.workers.length ? <WorkerRows ids={group.workers} model={model} seen={seen} state={workerStateOf} link={workerLink} /> : null} />
                    ),
                  )}
                  {outside.length ? <WorkerRows ids={outside} model={model} seen={seen} state={workerStateOf} link={workerLink} /> : null}
                </Box>
              ) : null
            }
          />
          {filling ? <Loading /> : <CardComments lines={commentLines} />}
        </>
      )}
    </article>
  );
}

/**
 * Whether a card has nothing of its own to show yet (lina-app#179), the one place its 아직 기록 없음 line is decided: no
 * folded line, question or answer place, now or result line, to-do, step (G138), worker run (each linked from 기록:
 * CardWorkers) or comment. An old card the core keeps no history for says 기록 보관 안 됨 instead.
 */
function cardShowsNothing(card: { readonly kept: boolean; readonly fold: boolean; readonly questions: number; readonly now: boolean; readonly result: boolean; readonly todos: number; readonly steps: number; readonly workers: number; readonly comments: number }): boolean {
  return card.kept && !card.fold && !card.questions && !card.now && !card.result && !card.todos && !card.steps && !card.workers && !card.comments;
}

/** One round of the worker runs' 기록 box: its head, its own line when one may show, and its worker runs. */
function RoundSection({ round, line, workers }: { round: Round; line: string | null; workers: ComponentChildren }) {
  const { now } = useApp();
  return (
    <section class={round.startedAt === null ? "round is-no-start" : "round"} data-testid="round">
      <h3 class="round-head">{roundHead(round, now)}</h3>
      {line ? (
        <p class="round-line" data-testid="round-line">
          {line}
        </p>
      ) : null}
      {workers}
    </section>
  );
}

/** A worker run a card started: the board does not list it, so its page is its card and its own record. */
function CardRunScreen({ id, cardId, cardLoading = false }: { id: string; cardId?: string | null; cardLoading?: boolean }) {
  const { model, store, now } = useApp();
  // The core serves no title for a card's worker run: it reads its card's name (lina-app#61, #248), grey when that is
  // its kind word or 제목 없음, as a card's head is.
  const card = cardId ? model.cards.get(cardId) : undefined;
  const title = card?.title ?? null;
  const untitled = workerTitle(model, cardId);
  // While its card is read, whether the run still goes is not known: its rounds wait rather than read 완료 기록 없음.
  if (cardLoading)
    return (
      <article class="detail" data-testid="screen-run">
        <CardHead work="code" title={title} untitled={untitled}>
          <RunModelLine runId={id} />
        </CardHead>
        <Loading />
      </article>
    );
  const newest = store.get("record", id)?.rounds[0];
  const live = runLive(model, id);
  // Its own end, never its card's state (lina-app#61): its record's newest round, else the round of its card it was.
  const cardRead = cardId ? store.get("card", cardId) : undefined;
  const state = newest ? W.outcome[outcomeOf(newest, true, live, now)] : cardRead ? workerState(model, store, id) : live ? STATE_WORD.in_progress : null;
  // A run the core keeps no record for says so in one line, however its page was opened (lina-app#110).
  const unread = store.status("record", id) === "missing";
  return (
    <article class="detail" data-testid="screen-run">
      <CardHead work="code" title={title} untitled={untitled}>
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
      {unread ? (
        <p class="write-error" role="alert" data-testid="timeline-error">
          {W.readFailed(W.record)}
        </p>
      ) : (
        <Timeline runs={[id]} live={(runId) => runLive(model, runId)} doing={card?.now ?? null} />
      )}
    </article>
  );
}

function UnreadRun() {
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
}

/** The worker run a card's round address names (lina-app#238): its place among the card's worker runs, once the card is read. */
export function roundRunId(store: Store, card: string, n: number): string | null {
  return store.get("card", card)?.workerRuns[n - 1]?.id ?? null;
}

/** A card's worker run's address: the card and the run's place among its worker runs, never the run's own id (lina-app#238). */
function workerHref(detail: WorkCardDetail, runId: string): string {
  const at = detail.workerRuns.findIndex((worker) => worker.id === runId);
  return at < 0 ? href({ name: "run", id: runId }) : href({ name: "round", card: detail.id, n: at + 1 });
}

/** A round's address opens its worker run's page once the card says which run stands at that place. */
export function RoundScreen({ card, n }: { card: string; n: number }) {
  const { store } = useApp();
  const id = roundRunId(store, card, n);
  if (id) return <RunScreen id={id} />;
  return store.status("card", card) === "pending" ? <Loading /> : <UnreadRun />;
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
  if (!run) return <UnreadRun />;
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
      <CardHead work={row.work} title={run.plain.title ?? listedTitle ?? card?.title ?? model.cards.get(id)?.title ?? null} untitled={workerTitle(model, owner)}>
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
      <Timeline runs={[id]} live={(runId) => runLive(model, runId)} doing={run.state === "in_progress" ? run.plain.now : null} fallback={store.status("record", id) === "failed" ? null : <PastEvents events={past} />} />
    </article>
  );
}
