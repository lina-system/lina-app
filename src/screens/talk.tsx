import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgentTalkHistory, ItemDetail } from "../api/client";
import type { Source, TalkResult } from "../data/source";
import { KoreanInput } from "../korean-input";
import { agentView } from "../model";
import { href } from "../router";
import { AgentMark, agentName, Box, CountPair, Disclosure, ErrorLine, Link, ListSection, useApp } from "../ui/parts";
import { SEP, W } from "../words";
import { GoalLine } from "./lists";

interface Turn {
  readonly key: number;
  readonly mine: string;
  readonly reply: string;
  readonly agent: string | null;
  readonly state: "streaming" | "done" | "failed";
}

/** The one line a refused turn shows; the message stays in the field. */
export function talkError(result: Extract<TalkResult, { ok: false }>): string {
  if (result.code === "unknown_agent") return W.talkUnknownAgent;
  switch (result.status) {
    case 502:
      return W.talkRefusedKey;
    case 429:
      return W.talkBusy;
    case 503:
      return W.talkDown;
    case 409:
      return W.talkNoAgent;
    case 413:
      return W.talkTooLong;
    case 404:
      return W.notFound;
    case 0:
      return W.offline;
    default:
      return W.writeFailed;
  }
}

/**
 * 대화 on a goal or to-do: the owner talks with the agent that owns it, in that agent's app conversation. The page
 * shows only the turns since it opened (the core has no route to read that conversation back). The owner's words sit
 * on the right, the reply streams in on the left under the agent's mark, and once the core carries the exchange into
 * the agent's own chat one line says so under the latest reply.
 */
export function Talk({ detail }: { detail: ItemDetail }) {
  const { model, store } = useApp();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [carried, setCarried] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const running = useRef<AbortController | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    setCarried(null);
    const result = await store.source.talk(detail.id, { message }, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setBusy(false);
      setError(talkError(result));
      return;
    }
    const key = nextKey.current++;
    const update = (patch: (turn: Turn) => Partial<Turn>) => setTurns((all) => all.map((turn) => (turn.key === key ? { ...turn, ...patch(turn) } : turn)));
    setText("");
    setTurns((all) => [...all, { key, mine: message, reply: "", agent: detail.agent, state: "streaming" }]);
    let completed = false;
    let failed = false;
    try {
      for await (const event of result.events) {
        switch (event.event) {
          case "talk.started":
            update(() => ({ agent: event.data.agent }));
            break;
          case "assistant.delta":
            update((turn) => ({ reply: turn.reply + event.data.delta }));
            break;
          case "assistant.completed":
            completed = true;
            update(() => ({ reply: event.data.content, state: "done" }));
            break;
          case "talk.carried":
            setCarried(key);
            break;
          case "error":
          case "run.failed":
          case "run.cancelled":
            failed = true;
            break;
        }
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      failed = true;
      console.warn("talk stream ended early", reason);
    }
    if (!completed || failed) {
      update(() => ({ state: "failed" }));
      setError(W.talkFailed);
    }
    setBusy(false);
  };

  const last = turns.at(-1)?.key;
  return (
    <Box title={W.talk} testid="talk">
      {turns.length ? (
        <ol class="talk" aria-label={W.talk}>
          {turns.map((turn) => {
            const name = agentName(model, turn.agent) || turn.agent || "";
            return [
              <li key={`${turn.key}-mine`} class="talk-turn is-mine" data-testid="talk-mine">
                <p class="talk-bubble">{turn.mine}</p>
              </li>,
              turn.reply || turn.state === "streaming" ? (
                <li key={`${turn.key}-reply`} class="talk-turn is-agent" data-testid="talk-reply" aria-busy={turn.state === "streaming" ? "true" : undefined}>
                  <AgentMark id={turn.agent} />
                  <div class="talk-lines">
                    <p class="talk-bubble">
                      {turn.reply}
                      {turn.state === "streaming" ? (
                        <span class="talk-live" data-testid="talk-live">
                          <span class="visually-hidden">{W.replying}</span>
                        </span>
                      ) : null}
                    </p>
                    {carried === turn.key && turn.key === last ? (
                      <span class="sub" role="status" data-testid="talk-carried">
                        {W.carried(name)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ) : null,
            ];
          })}
        </ol>
      ) : null}
      <div class="comment-form talk-form">
        <KoreanInput label={W.talkField} value={text} onValue={setText} onEnter={() => void send()} inline />
        <button type="button" class="text-button" disabled={busy || !text.trim()} onClick={() => void send()}>
          {W.send}
        </button>
      </div>
      <ErrorLine line={error ?? undefined} />
    </Box>
  );
}

/** One line in the owner's window on an agent: a kept message, or this page's turn while its reply streams. */
interface Line {
  readonly key: string;
  readonly mine: boolean;
  readonly text: string;
  readonly state: "kept" | "streaming" | "done" | "failed";
}

/** The core puts "[LINA app]" on the first line of the owner's turns in this window; the owner never typed it. */
export function ownText(content: string): string {
  return content.replace(/^\[LINA app\][^\n]*\n?/, "");
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/**
 * The first line of each agent's last message, for its row in the agent list (lina-app#143): "" when it has none.
 * A row reads it on mount; an open window keeps it current as turns go out and replies settle.
 */
const lastLines = new WeakMap<Source, Map<string, string>>();
const lastLineWatchers = new Set<() => void>();

function lastLinesOf(source: Source): Map<string, string> {
  let lines = lastLines.get(source);
  if (!lines) lastLines.set(source, (lines = new Map()));
  return lines;
}

/** How many times each agent's preview was published: a read that began before a newer preview must not overwrite it. */
const lastLineRevisions = new WeakMap<Source, Map<string, number>>();

function revisionOf(source: Source, agent: string): number {
  return lastLineRevisions.get(source)?.get(agent) ?? 0;
}

function keepLastLine(source: Source, agent: string, line: string | undefined) {
  let revisions = lastLineRevisions.get(source);
  if (!revisions) lastLineRevisions.set(source, (revisions = new Map()));
  revisions.set(agent, revisionOf(source, agent) + 1);
  if (line === undefined) lastLinesOf(source).delete(agent);
  else lastLinesOf(source).set(agent, line);
  for (const watcher of lastLineWatchers) watcher();
}

function lastLineOf(history: AgentTalkHistory): string {
  const last = history.messages.at(-1);
  return last ? firstLine(last.role === "user" ? ownText(last.content) : last.content) : "";
}

/** An agent row's second line: the first line of its last message, or `아직 나눈 대화 없음`; nothing until read. */
export function TalkPreview({ agent }: { agent: string }) {
  const { store } = useApp();
  const [, redraw] = useState(0);
  useEffect(() => {
    let live = true;
    const watch = () => redraw((count) => count + 1);
    lastLineWatchers.add(watch);
    const revision = revisionOf(store.source, agent);
    void store.source.agentTalkHistory(agent).then((result) => {
      // A turn sent or a reply taken meanwhile is newer than this snapshot.
      if (live && result.kind === "data" && revisionOf(store.source, agent) === revision) keepLastLine(store.source, agent, lastLineOf(result.data));
    });
    return () => {
      live = false;
      lastLineWatchers.delete(watch);
    };
  }, [agent, store]);
  const line = lastLinesOf(store.source).get(agent);
  if (line === undefined) return null;
  return (
    <span class="sub one-line talk-preview" data-testid="talk-preview">
      {line || W.noTurns}
    </span>
  );
}

/** The turns a window carried over (see `Sent.carried`) that its history read may hold. */
interface Carried {
  /** Their messages while they go: the core may keep one as the owner's last message, or already hold it whole. */
  readonly going: readonly string[];
  /** The ones this window took in whole, as (message, reply), oldest first. */
  readonly settled: readonly (readonly [string, string])[];
}

/**
 * The earlier turns. From the tail of the history backwards it leaves out the carried turns this window shows
 * already, so a chat opened while its reply completes shows each exchange once, in either order.
 */
function keptLines(history: AgentTalkHistory, carried: Carried = { going: [], settled: [] }): Line[] {
  const lines: Line[] = history.messages.map((message, index) => ({ key: `h${index}`, mine: message.role === "user", text: message.role === "user" ? ownText(message.content) : message.content, state: "kept" }));
  let end = lines.length;
  const pair = (message: (text: string) => boolean, reply: (text: string) => boolean) => {
    const own = lines[end - 2];
    const answer = lines[end - 1];
    return Boolean(own?.mine && answer && !answer.mine && message(own.text) && reply(answer.text));
  };
  if (lines[end - 1]?.mine && carried.going.includes(lines[end - 1].text)) end -= 1;
  else if (pair((text) => carried.going.includes(text), () => true)) end -= 2;
  else
    for (let turn = carried.settled.length - 1; turn >= 0; turn -= 1) {
      const [message, reply] = carried.settled[turn];
      if (!pair((text) => text === message, (text) => text === reply)) break;
      end -= 2;
    }
  return lines.slice(0, end);
}

/** One turn sent from an agent's window. It lives outside the window, so leaving the window neither cancels nor drops it (lina-app#127). */
interface Sent {
  readonly key: string;
  readonly message: string;
  reply: string;
  state: "streaming" | "done" | "failed";
  /**
   * True once a window has opened while the turn was going: that window's history read may hold the turn (whole or as
   * the owner's last message), so only such a turn is matched against the history. A turn sent from an open window
   * went out after its history was read and cannot be in it, however alike an earlier exchange is.
   */
  carried: boolean;
}

/** The window open on an agent now: it takes in a settled turn, redraws a streaming one, and shows a reply that broke off. */
interface TalkWindow {
  take(turn: Sent): void;
  redraw(): void;
  failed(): void;
  /** The core refused the turn: its words, shown in the window. */
  refused(error: string): void;
}

/**
 * The turns sent to one agent that no window has taken in yet, and the window open on it. A turn settles into the
 * open window; with none open, a kept reply is read back from the core and a failed turn waits for the next window.
 */
interface Outbox {
  readonly turns: Sent[];
  window: TalkWindow | null;
  /** A refusal that came while no window was open, shown by the next one. */
  refusal: string | null;
}

const outboxes = new WeakMap<Source, Map<string, Outbox>>();
let sentKeys = 0;

function outbox(source: Source, agent: string): Outbox {
  let agents = outboxes.get(source);
  if (!agents) outboxes.set(source, (agents = new Map()));
  let box = agents.get(agent);
  if (!box) agents.set(agent, (box = { turns: [], window: null, refusal: null }));
  return box;
}

function sentLines(turn: Sent): Line[] {
  return [
    { key: `${turn.key}-mine`, mine: true, text: turn.message, state: "done" },
    { key: turn.key, mine: false, text: turn.reply, state: turn.state },
  ];
}

function settle(box: Outbox, turn: Sent) {
  if (!box.window && turn.state === "failed") return;
  box.turns.splice(box.turns.indexOf(turn), 1);
  box.window?.take(turn);
}

/**
 * The owner's own window on one agent (lina#482): the earlier turns read from the core, then this page's turns, the
 * reply streaming in under the agent's mark. It is the agent's app conversation, not its messenger chat, and says so.
 * `titled`: the window is the whole screen (a phone), so the agent's name is the screen's title.
 */
export function AgentTalk({ agent, titled = false, children }: { agent: string; titled?: boolean; children?: ComponentChildren }) {
  const { model, store } = useApp();
  const [lines, setLines] = useState<readonly Line[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drawn, redraw] = useState(0);
  const end = useRef<HTMLLIElement>(null);
  /** Settles once the earlier turns are read (or failed): a turn sent before then would also come back in them. */
  const historyRead = useRef<Promise<void>>(Promise.resolve());
  const name = agentName(model, agent) || agent;
  const box = outbox(store.source, agent);
  const sending = box.turns.length > 0;

  useEffect(() => {
    let live = true;
    const box = outbox(store.source, agent);
    /** The carried turns this window has taken in whole. */
    const settled: (readonly [string, string])[] = [];
    const open: TalkWindow = {
      take(turn) {
        setLines((shown) => {
          const all = shown ?? [];
          const own = all[all.length - 2];
          const answer = all[all.length - 1];
          // The history read can already hold a carried turn whole: it shows once.
          const held = turn.carried && turn.state === "done" && own?.mine && !answer?.mine && own.text === turn.message && answer.text === turn.reply;
          return held ? all : [...all, ...sentLines(turn)];
        });
        if (turn.carried && turn.state === "done") settled.push([turn.message, turn.reply]);
        if (turn.state === "failed") setError(W.talkFailed);
      },
      redraw: () => redraw((count) => count + 1),
      failed: () => setError(W.talkFailed),
      refused: setError,
    };
    box.window = open;
    for (const turn of box.turns) turn.carried = true;
    if (box.refusal) {
      setError(box.refusal);
      box.refusal = null;
    }
    for (const turn of box.turns.filter((each) => each.state === "failed")) settle(box, turn);
    historyRead.current = store.source.agentTalkHistory(agent).then((result) => {
      if (!live) return;
      const going = box.turns.filter((turn) => turn.carried).map((turn) => turn.message);
      if (result.kind === "data") {
        setLines((shown) => [...keptLines(result.data, { going, settled }), ...(shown ?? [])]);
        if (!box.turns.length) keepLastLine(store.source, agent, lastLineOf(result.data));
      } else {
        setLines((shown) => shown ?? []);
        if (result.kind === "failed") setHistoryError(true);
      }
    });
    // Leaving the window does not cancel the turn the owner sent; it settles into the next window (lina-app#127).
    return () => {
      live = false;
      if (box.window === open) box.window = null;
    };
  }, [agent, store]);

  useLayoutEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lines, drawn]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    // The turn is in the outbox before anything is awaited, so a window opened meanwhile sees it going and does not
    // offer a second send; it goes out only after the earlier turns are read, so the history cannot hold it.
    const box = outbox(store.source, agent);
    const turn: Sent = { key: `t${++sentKeys}`, message, reply: "", state: "streaming", carried: false };
    box.turns.push(turn);
    box.window?.redraw();
    const before = lastLinesOf(store.source).get(agent);
    keepLastLine(store.source, agent, firstLine(message));
    await historyRead.current;
    const result = await store.source.agentTalk(agent, { message });
    if (!result.ok) {
      box.turns.splice(box.turns.indexOf(turn), 1);
      // A refused turn is not the last message: the row goes back to what it showed before the send.
      keepLastLine(store.source, agent, before);
      const refusal = talkError(result);
      if (box.window) box.window.refused(refusal);
      else box.refusal = refusal;
      box.window?.redraw();
      return;
    }
    setText("");
    let failed = false;
    try {
      for await (const event of result.events) {
        switch (event.event) {
          case "assistant.delta":
            turn.reply += event.data.delta;
            box.window?.redraw();
            break;
          case "assistant.completed":
            turn.reply = event.data.content;
            turn.state = "done";
            settle(box, turn);
            keepLastLine(store.source, agent, firstLine(turn.reply));
            break;
          case "error":
          case "run.failed":
          case "run.cancelled":
            failed = true;
            break;
        }
      }
    } catch (reason) {
      failed = true;
      console.warn("agent talk stream ended early", reason);
    }
    if (turn.state === "streaming") {
      turn.state = "failed";
      settle(box, turn);
    } else if (failed) box.window?.failed();
  };

  const shown = lines === null ? null : [...lines, ...box.turns.flatMap(sentLines)];

  return (
    <section class="agent-talk" aria-label={`${name} ${W.talk}`} data-testid="agent-talk">
      <header class="agent-talk-head">
        <AgentMark id={agent} />
        <span class="lines">
          {titled ? (
            <h1 class="agent-talk-title" data-testid="screen-title">
              <span class="title one-line" data-testid="agent-talk-name">
                {name}
              </span>
            </h1>
          ) : (
            <span class="title one-line" data-testid="agent-talk-name">
              {name}
            </span>
          )}
          <span class="sub">{W.appWindow}</span>
        </span>
      </header>
      {children}
      <div class="agent-talk-turns">
        {shown === null ? null : shown.length ? (
          <ol class="talk" aria-label={W.talk}>
            {shown.map((line) =>
              line.mine ? (
                <li key={line.key} class="talk-turn is-mine" data-testid="talk-mine">
                  <p class="talk-bubble">{line.text}</p>
                </li>
              ) : line.text || line.state === "streaming" ? (
                <li key={line.key} class="talk-turn is-agent" data-testid="talk-reply" aria-busy={line.state === "streaming" ? "true" : undefined}>
                  <AgentMark id={agent} />
                  <div class="talk-lines">
                    <p class="talk-bubble">
                      {line.text}
                      {line.state === "streaming" ? (
                        <span class="talk-live" data-testid="talk-live">
                          <span class="visually-hidden">{W.replying}</span>
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ) : null,
            )}
            <li ref={end} class="talk-end" aria-hidden="true" />
          </ol>
        ) : (
          <p class="empty" data-testid="no-turns">
            {historyError ? W.historyFailed : W.noTurns}
          </p>
        )}
      </div>
      <div class="comment-form talk-form agent-talk-form">
        <KoreanInput label={W.talkField} value={text} onValue={setText} onEnter={() => void send()} inline />
        <button type="button" class="text-button" disabled={sending || !text.trim()} onClick={() => void send()}>
          {W.send}
        </button>
      </div>
      <ErrorLine line={error ?? undefined} />
    </section>
  );
}

/**
 * The agent's card beside its window: what it has running and waiting, and its goals. On a wide window it is the
 * right column; on a phone it sits folded above the conversation, so neither layout drops it.
 */
export function AgentCard({ agent, folded = false }: { agent: string; folded?: boolean }) {
  const { model } = useApp();
  const view = agentView(model, agent);
  const [open, setOpen] = useState(!folded);
  if (!view) return null;
  // Every number has its word; red is 중단됨 and nothing else (lina-app#143).
  const parts = [view.running, view.review, view.goals].flatMap((section) => [
    { key: section.id, text: `${section.title} ${section.count}`, stopped: false },
    ...(section.stopped ? [{ key: `${section.id}-stopped`, text: W.stoppedCount(section.stopped), stopped: true }] : []),
  ]);
  const counts = (
    <p class="agent-counts" data-testid="agent-card-counts">
      {parts.map((part, index) => [
        index ? SEP : "",
        <span key={part.key} class={part.stopped ? "is-red" : undefined} data-testid="agent-count">
          {part.text}
        </span>,
      ])}
    </p>
  );
  // A goal opens under 대화, beside the window on a wide one and one step deeper on a phone (lina-app#143).
  const body = (
    <>
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={{ ...goal, href: href({ name: "talk", id: agent, goal: goal.id }) }} showAgent={false} />} />
      <ul class="rows" aria-label={W.done}>
        <li class="row" data-testid="card-done-today">
          <Link href={href({ name: "done", agent })} label={W.doneToday(view.doneToday.count)}>
            <span class="lines">
              <span class="title">{W.doneToday(view.doneToday.count)}</span>
            </span>
            <Disclosure />
          </Link>
        </li>
      </ul>
    </>
  );
  if (folded) {
    return (
      <div class={`agent-card is-folded${open ? " is-open" : ""}`} data-testid="agent-card">
        <button type="button" class="agent-card-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="lines">
            <span class="title">{W.cardGoals(view.goals.rows.length)}</span>
            <span class="sub one-line">{view.goals.rows.map((goal) => `${goal.title} ${W.progress(goal.todosDone, goal.todosTotal)}`).join(SEP)}</span>
          </span>
        </button>
        {open ? (
          <div class="agent-card-body">
            {counts}
            {body}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div class="agent-card" data-testid="agent-card">
      <h2 class="agent-card-head">{W.agentCard}</h2>
      {counts}
      {body}
    </div>
  );
}

/** The agents to talk with: one row each. There is no window on all of them at once. */
export function TalkAgents() {
  const { model, selected } = useApp();
  if (!model.agents.length) return <p class="empty">{W.pickAgent}</p>;
  return (
    <ul class="rows" aria-label={W.agents} data-testid="talk-agents">
      {model.agents.map((agent) => {
        const target = href({ name: "talk", id: agent.id });
        const { running = 0, stopped = 0 } = model.counts.agents[agent.id] ?? {};
        return (
          <li key={agent.id} class="row" data-testid={`talk-agent-${agent.index}`}>
            <Link href={target} label={[running ? `${agent.name} ${running}` : agent.name, stopped ? W.stoppedCount(stopped) : ""].filter(Boolean).join(SEP)} current={selected === target}>
              <AgentMark id={agent.id} />
              <span class="lines">
                <span class="title one-line">{agent.name}</span>
                <TalkPreview agent={agent.id} />
              </span>
              <CountPair count={running} stopped={stopped} />
              <Disclosure />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
