import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgentTalkHistory, ItemDetail } from "../api/client";
import type { TalkResult } from "../data/source";
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

function keptLines(history: AgentTalkHistory): Line[] {
  return history.messages.map((message, index) => ({ key: `h${index}`, mine: message.role === "user", text: message.role === "user" ? ownText(message.content) : message.content, state: "kept" }));
}

/**
 * The owner's own window on one agent (lina#482): the earlier turns read from the core, then this page's turns, the
 * reply streaming in under the agent's mark. It is the agent's app conversation, not its messenger chat, and says so.
 */
export function AgentTalk({ agent, children }: { agent: string; children?: ComponentChildren }) {
  const { model, store } = useApp();
  const [lines, setLines] = useState<readonly Line[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const running = useRef<AbortController | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const name = agentName(model, agent) || agent;

  useEffect(() => {
    let live = true;
    void store.source.agentTalkHistory(agent).then((result) => {
      if (!live) return;
      if (result.kind === "data") setLines((shown) => [...keptLines(result.data), ...(shown ?? [])]);
      else {
        setLines((shown) => shown ?? []);
        if (result.kind === "failed") setHistoryError(true);
      }
    });
    return () => {
      live = false;
      running.current?.abort();
    };
  }, [agent, store]);

  useLayoutEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [lines]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    const result = await store.source.agentTalk(agent, { message }, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setBusy(false);
      setError(talkError(result));
      return;
    }
    const key = `t${nextKey.current++}`;
    const update = (patch: (line: Line) => Partial<Line>) => setLines((all) => (all ?? []).map((line) => (line.key === key ? { ...line, ...patch(line) } : line)));
    setText("");
    setLines((all) => [...(all ?? []), { key: `${key}-mine`, mine: true, text: message, state: "done" }, { key, mine: false, text: "", state: "streaming" }]);
    let completed = false;
    let failed = false;
    try {
      for await (const event of result.events) {
        switch (event.event) {
          case "assistant.delta":
            update((line) => ({ text: line.text + event.data.delta }));
            break;
          case "assistant.completed":
            completed = true;
            update(() => ({ text: event.data.content, state: "done" }));
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
      console.warn("agent talk stream ended early", reason);
    }
    if (!completed || failed) {
      update(() => ({ state: "failed" }));
      setError(W.talkFailed);
    }
    setBusy(false);
  };

  return (
    <section class="agent-talk" aria-label={`${name} ${W.talk}`} data-testid="agent-talk">
      <header class="agent-talk-head">
        <AgentMark id={agent} />
        <span class="lines">
          <span class="title one-line" data-testid="agent-talk-name">
            {name}
          </span>
          <span class="sub">{W.appWindow}</span>
        </span>
      </header>
      {children}
      <div class="agent-talk-turns">
        {lines === null ? null : lines.length ? (
          <ol class="talk" aria-label={W.talk}>
            {lines.map((line) =>
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
        <button type="button" class="text-button" disabled={busy || !text.trim()} onClick={() => void send()}>
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
  const counts = (
    <p class="agent-counts" data-testid="agent-card-counts">
      {[view.running, view.review, view.goals].map((section, index) => (
        <span key={section.id}>
          {index ? SEP : ""}
          {section.title} <CountPair count={section.count} stopped={section.stopped} showZero />
        </span>
      ))}
    </p>
  );
  const body = (
    <>
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={goal} showAgent={false} />} />
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
        const view = agentView(model, agent.id);
        const target = href({ name: "talk", id: agent.id });
        const sub = view ? [view.running.count ? `${view.running.title} ${view.running.count}` : "", `${view.goals.title} ${view.goals.rows.length}`].filter(Boolean).join(SEP) : "";
        return (
          <li key={agent.id} class="row" data-testid={`talk-agent-${agent.index}`}>
            <Link href={target} label={agent.name} current={selected === target}>
              <AgentMark id={agent.id} />
              <span class="lines">
                <span class="title one-line">{agent.name}</span>
                {sub ? <span class="sub one-line">{sub}</span> : null}
              </span>
              <Disclosure />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
