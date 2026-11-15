import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgentTalkHistory, ItemDetail } from "../api/client";
import type { Source, TalkResult } from "../data/source";
import { KoreanInput } from "../korean-input";
import { Markdown, plainLine } from "../markdown";
import { agentView, foldTitle } from "../model";
import { href } from "../router";
import { clock } from "../time";
import { AgentMark, agentName, Box, CountPair, Disclosure, ErrorLine, Link, ListSection, useApp } from "../ui/parts";
import { SEP, W } from "../words";
import { GoalLine, goalProgress } from "./lists";

interface Turn {
  readonly key: number;
  readonly mine: string;
  readonly reply: string;
  readonly agent: string | null;
  readonly state: "streaming" | "done" | "failed";
  /** When the message went out and when its reply last moved, in seconds. */
  readonly at: number;
  readonly replyAt: number;
}

/**
 * The one line a refused turn shows; the message stays in the field. `no_owning_agent` is the core's own and comes
 * only from a to-do's conversation; any other 409 is the agent gateway's (`admission_conflict` and others) and, like
 * its 429, means the agent is busy (lina-app#158).
 */
export function talkError(result: Extract<TalkResult, { ok: false }>): string {
  if (result.code === "unknown_agent") return W.talkUnknownAgent;
  if (result.code === "no_owning_agent") return W.talkNoAgent;
  switch (result.status) {
    case 502:
      return W.talkRefusedKey;
    case 429:
    case 409:
      return W.talkBusy;
    case 503:
      return W.talkDown;
    case 413:
      return W.talkTooLong;
    case 404:
      return W.notFound;
    case 0:
      return W.offline;
    default:
      return W.saveFailed;
  }
}

/** One message as a 대화 window draws it. `at`: when it was written, in seconds; null when the core gave no time. */
export interface ThreadLine {
  readonly key: string;
  readonly mine: boolean;
  readonly text: string;
  readonly at: number | null;
  readonly state: "kept" | "sending" | "streaming" | "done" | "failed";
  /** Who wrote an agent line, when one window holds lines of more than one agent; else the window's agent. */
  readonly agent?: string;
}

/** A date between days, or a run of one sender's messages: its time is the last message's. */
export type ThreadPart =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "group"; readonly key: string; readonly mine: boolean; readonly agent: string | undefined; readonly lines: readonly ThreadLine[]; readonly at: number | null };

/** A pause longer than this starts a new group, as a chat app does. */
const GROUP_GAP_S = 5 * 60;

function dayOf(seconds: number): string {
  return new Date(seconds * 1000).toDateString();
}

function dayWord(at: number, now: number): string {
  if (dayOf(at) === dayOf(now)) return W.today;
  if (dayOf(at) === dayOf(now - 86_400)) return W.yesterday;
  const date = new Date(at * 1000);
  return W.talkDate(date.getMonth() + 1, date.getDate(), date.getFullYear() === new Date(now * 1000).getFullYear() ? null : date.getFullYear());
}

/**
 * The window's messages as a chat app lays them out (lina-app#187): a date before each day's first message, and the
 * consecutive messages of one sender (of one agent, for the agent's) in one group unless more than GROUP_GAP_S passed. A message with no time joins
 * the group before it.
 */
export function threadOf(lines: readonly ThreadLine[], now: number): ThreadPart[] {
  const parts: ThreadPart[] = [];
  let day: string | null = null;
  let group: { kind: "group"; key: string; mine: boolean; agent: string | undefined; lines: ThreadLine[]; at: number | null } | null = null;
  for (const line of lines) {
    if (line.at !== null && dayOf(line.at) !== day) {
      day = dayOf(line.at);
      parts.push({ kind: "day", key: `day-${line.key}`, label: dayWord(line.at, now) });
      group = null;
    }
    const joins = group && group.mine === line.mine && group.agent === line.agent && (line.at === null || group.at === null || line.at - group.at <= GROUP_GAP_S);
    if (!group || !joins) {
      group = { kind: "group", key: `group-${line.key}`, mine: line.mine, agent: line.agent, lines: [], at: null };
      parts.push(group);
    }
    group.lines.push(line);
    group.at = line.at ?? group.at;
  }
  return parts;
}

/** Further from the end than this, the window is being read up: a new message does not pull it down. */
const END_PX = 48;

/** The box a window's messages scroll in: the nearest scrolling ancestor, else the page. */
function scrollerOf(element: Element): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** 보내기 as a round icon, dim while there is nothing to send or a turn is going (lina-app#187). */
function SendButton({ disabled, onSend }: { disabled: boolean; onSend: () => void }) {
  return (
    <button type="button" class="talk-send" aria-label={W.send} disabled={disabled} onClick={onSend}>
      <UpIcon />
    </button>
  );
}

/**
 * A window's messages: the owner's on the right, plain text; the agent's on the left under its mark and name, its
 * markdown drawn; a date between days. A new message keeps the window at the bottom, and the owner's own always goes
 * there; read up, the window stays put and 맨 아래로 counts what came in (lina-app#187). `after` draws one line under
 * the group that holds the message it names.
 */
function Thread({ lines, agent, after }: { lines: readonly ThreadLine[]; agent: string | null; after?: { readonly key: string; readonly line: ComponentChildren } }) {
  const { model, now } = useApp();
  const list = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  const seen = useRef<{ count: number; lastMine: string | null }>({ count: 0, lastMine: null });
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const name = agentName(model, agent) || agent || "";

  const toEnd = () => {
    const scroller = list.current && scrollerOf(list.current);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    atEnd.current = true;
    setAway(false);
    setUnseen(0);
  };

  useEffect(() => {
    const scrolled = (event: Event) => {
      const scroller = list.current && scrollerOf(list.current);
      if (!scroller || (event.target === document ? document.scrollingElement : event.target) !== scroller) return;
      const end = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= END_PX;
      atEnd.current = end;
      setAway(!end);
      if (end) setUnseen(0);
    };
    document.addEventListener("scroll", scrolled, true);
    return () => document.removeEventListener("scroll", scrolled, true);
  }, []);

  const last = lines.at(-1);
  // The owner's newest message wherever it stands: a send adds it together with the agent's empty reply after it.
  let lastMine: string | null = null;
  for (const line of lines) if (line.mine) lastMine = line.key;
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { count: lines.length, lastMine };
    if (!lines.length) return;
    if (atEnd.current || before.count === 0 || (lastMine !== null && lastMine !== before.lastMine)) toEnd();
    else if (lines.length > before.count) setUnseen((count) => count + lines.length - before.count);
  }, [lines.length, last?.key, last?.text, lastMine]);

  return (
    <>
      <ol class="talk" aria-label={W.talk} ref={list}>
        {threadOf(lines, now).map((part) =>
          part.kind === "day" ? (
            <li key={part.key} class="talk-day" data-testid="talk-day">
              <span>{part.label}</span>
            </li>
          ) : (
            <li key={part.key} class={`talk-group ${part.mine ? "is-mine" : "is-agent"}`} data-testid="talk-group">
              {part.mine ? null : <AgentMark id={part.agent ?? agent} />}
              <div class="talk-lines">
                {part.mine ? null : (
                  <span class="talk-name" data-testid="talk-name">
                    {part.agent ? agentName(model, part.agent) || part.agent : name}
                  </span>
                )}
                {part.lines.map((line) =>
                  line.mine ? (
                    <div key={line.key} class="talk-turn is-mine" data-testid="talk-mine" data-state={line.state === "sending" ? "sending" : undefined}>
                      <div class="talk-bubble">{line.text}</div>
                    </div>
                  ) : (
                    <div key={line.key} class="talk-turn is-agent" data-testid="talk-reply" aria-busy={line.state === "streaming" ? "true" : undefined}>
                      <div class="talk-bubble">
                        {line.text ? <Markdown text={line.text} /> : null}
                        {line.state === "streaming" ? (
                          <span class="talk-typing" role="img" aria-label={W.replying} data-testid="talk-live">
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ),
                )}
                {part.at === null ? null : (
                  <time class="talk-time" data-testid="talk-time" dateTime={new Date(part.at * 1000).toISOString()}>
                    {clock(part.at)}
                  </time>
                )}
                {after && part.lines.some((line) => line.key === after.key) ? after.line : null}
              </div>
            </li>
          ),
        )}
      </ol>
      {away ? (
        <div class="talk-jump-bar">
          <button type="button" class="talk-jump" data-testid="talk-jump" aria-label={W.toLatest(unseen)} onClick={toEnd}>
            <DownIcon />
            {unseen ? <span class="talk-jump-count">{unseen}</span> : null}
          </button>
        </div>
      ) : null}
    </>
  );
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
    const sentAt = Date.now() / 1000;
    const update = (patch: (turn: Turn) => Partial<Turn>) => setTurns((all) => all.map((turn) => (turn.key === key ? { ...turn, ...patch(turn) } : turn)));
    setText("");
    setTurns((all) => [...all, { key, mine: message, reply: "", agent: detail.agent, state: "streaming", at: sentAt, replyAt: sentAt }]);
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
            update(() => ({ reply: event.data.content, state: "done", replyAt: Date.now() / 1000 }));
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

  const last = turns.at(-1);
  const lines = turns.flatMap((turn): ThreadLine[] => [
    { key: `${turn.key}-mine`, mine: true, text: turn.mine, at: turn.at, state: "done" },
    ...(turn.reply || turn.state === "streaming" ? [{ key: `${turn.key}-reply`, mine: false, text: turn.reply, at: turn.replyAt, state: turn.state, agent: turn.agent ?? undefined }] : []),
  ]);
  const name = agentName(model, last?.agent ?? null) || last?.agent || "";
  return (
    <Box title={W.talk} testid="talk">
      {lines.length ? (
        <Thread
          lines={lines}
          agent={last?.agent ?? detail.agent}
          after={
            last && carried === last.key
              ? {
                  key: `${last.key}-reply`,
                  line: (
                    <span class="sub talk-carried" role="status" data-testid="talk-carried">
                      {W.carried(name)}
                    </span>
                  ),
                }
              : undefined
          }
        />
      ) : null}
      <div class="comment-form talk-form">
        <KoreanInput label={W.talkField} value={text} onValue={setText} onEnter={() => void send()} inline multiline />
        <SendButton disabled={busy || !text.trim()} onSend={() => void send()} />
      </div>
      <ErrorLine line={error ?? undefined} />
    </Box>
  );
}

/**
 * The core puts "[LINA app]" on the first line of the owner's turns in this window, then a blank line
 * (`[LINA app]\n\n<message>`); the owner typed neither, so neither draws (lina-app#150).
 */
export function ownText(content: string): string {
  return content.replace(/^\[LINA app\][^\n]*\n*/, "");
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
  // The owner's words as typed; the agent's without their markdown marks (lina-app#187).
  return last ? (last.role === "user" ? firstLine(ownText(last.content)) : plainLine(last.content)) : "";
}

/**
 * How many agent rows read their history at once (lina-app#162). A browser keeps 6 connections to one host and a
 * gateway that does not answer holds each read about 30 s: the live hub's 9 rows reading at once left none for the
 * change stream and the store, so the head read 갱신 지연 until they gave up. The open window's own read does not wait.
 */
const PREVIEW_READS = 2;

const previewQueues = new WeakMap<Source, { reading: number; waiting: (() => void)[] }>();

/** Starts a row's read when fewer than PREVIEW_READS are out; the returned function drops it if it has not started. */
function queuePreviewRead(source: Source, read: () => Promise<unknown>): () => void {
  let queue = previewQueues.get(source);
  if (!queue) previewQueues.set(source, (queue = { reading: 0, waiting: [] }));
  const reads = queue;
  const run = () => {
    reads.reading += 1;
    void read().finally(() => {
      reads.reading -= 1;
      reads.waiting.shift()?.();
    });
  };
  if (reads.reading < PREVIEW_READS) {
    run();
    return () => undefined;
  }
  reads.waiting.push(run);
  return () => {
    const at = reads.waiting.indexOf(run);
    if (at >= 0) reads.waiting.splice(at, 1);
  };
}

/** An agent row's second line: the first line of its last message, or `아직 나눈 대화 없음`; nothing until read. */
export function TalkPreview({ agent }: { agent: string }) {
  const { store } = useApp();
  const [, redraw] = useState(0);
  useEffect(() => {
    let live = true;
    const watch = () => redraw((count) => count + 1);
    lastLineWatchers.add(watch);
    const drop = queuePreviewRead(store.source, () => {
      const revision = revisionOf(store.source, agent);
      return store.source.agentTalkHistory(agent).then((result) => {
        // A turn sent or a reply taken meanwhile is newer than this snapshot.
        if (live && result.kind === "data" && revisionOf(store.source, agent) === revision) keepLastLine(store.source, agent, lastLineOf(result.data));
      });
    });
    return () => {
      live = false;
      drop();
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
  /** The going ones this read was not already out for: only these can sit in the history as a whole exchange. */
  readonly whole: readonly string[];
  /** The ones this window took in whole, as (message, reply), oldest first. */
  readonly settled: readonly (readonly [string, string])[];
}

/**
 * The earlier turns. From the tail of the history backwards it leaves out the carried turns this window shows
 * already, so a chat opened while its reply completes shows each exchange once, in either order.
 */
function keptLines(history: AgentTalkHistory, carried: Carried = { going: [], whole: [], settled: [] }): ThreadLine[] {
  const lines: ThreadLine[] = history.messages.map((message, index) => ({ key: `h${index}`, mine: message.role === "user", text: message.role === "user" ? ownText(message.content) : message.content, at: message.timestamp, state: "kept" }));
  let end = lines.length;
  const pair = (message: (text: string) => boolean, reply: (text: string) => boolean) => {
    const own = lines[end - 2];
    const answer = lines[end - 1];
    return Boolean(own?.mine && answer && !answer.mine && message(own.text) && reply(answer.text));
  };
  if (lines[end - 1]?.mine && carried.going.includes(lines[end - 1].text)) end -= 1;
  else if (pair((text) => carried.whole.includes(text), () => true)) end -= 2;
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
  /** `sending` until the core answers the send (lina-app#154): the message shows at once, the reply after. */
  state: "sending" | "streaming" | "done" | "failed";
  /**
   * True once a window has opened while the turn was going: that window's history read may hold the turn (whole or as
   * the owner's last message), so only such a turn is matched against the history. A turn sent from an open window
   * went out after its history was read and cannot be in it, however alike an earlier exchange is.
   */
  carried: boolean;
  /**
   * True while the turn was sent with this window's history read still out (lina-app#154): the read may hold it as
   * the owner's last message, but a whole exchange in it is an earlier one, since this turn has no reply yet. A
   * window opened later reads after the turn went out, so it clears this.
   */
  late: boolean;
  /** When the message went out and when its reply last moved, in seconds. */
  readonly at: number;
  replyAt: number;
}

/** The window open on an agent now: it takes in a settled turn, redraws a streaming one, and shows a reply that broke off. */
interface TalkWindow {
  take(turn: Sent): void;
  redraw(): void;
  failed(): void;
  /** The core refused the turn: its words, shown in the window, and the message back in an empty field. */
  refused(error: string, message: string): void;
}

/**
 * The turns sent to one agent that no window has taken in yet, and the window open on it. A turn settles into the
 * open window; with none open, a kept reply is read back from the core and a failed turn waits for the next window.
 */
interface Outbox {
  readonly turns: Sent[];
  window: TalkWindow | null;
  /** A refusal that came while no window was open, shown by the next one. */
  refusal: { readonly line: string; readonly message: string } | null;
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

function sentLines(turn: Sent): ThreadLine[] {
  if (turn.state === "sending") return [{ key: `${turn.key}-mine`, mine: true, text: turn.message, at: turn.at, state: "sending" }];
  return [
    { key: `${turn.key}-mine`, mine: true, text: turn.message, at: turn.at, state: "done" },
    { key: turn.key, mine: false, text: turn.reply, at: turn.replyAt, state: turn.state },
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
  const [lines, setLines] = useState<readonly ThreadLine[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useState(0);
  /** The earlier turns are still being read: a turn sent meanwhile may come back in them, so it is matched like a carried one. */
  const historyPending = useRef(true);
  const name = agentName(model, agent) || agent;
  const box = outbox(store.source, agent);
  const sending = box.turns.length > 0;
  // An address naming no agent the core lists (lina-app#154); unknown until the agents are read.
  const missing = store.status("items") === "ok" && !model.agents.some((each) => each.id === agent);

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
      refused(line, message) {
        setError(line);
        setText((typed) => (typed.trim() ? typed : message));
      },
    };
    box.window = open;
    for (const turn of box.turns) {
      turn.carried = true;
      turn.late = false;
    }
    if (box.refusal) {
      open.refused(box.refusal.line, box.refusal.message);
      box.refusal = null;
    }
    for (const turn of box.turns.filter((each) => each.state === "failed")) settle(box, turn);
    historyPending.current = true;
    void store.source.agentTalkHistory(agent).then((result) => {
      if (!live) return;
      historyPending.current = false;
      const going = box.turns.filter((turn) => turn.carried).map((turn) => turn.message);
      const whole = box.turns.filter((turn) => turn.carried && !turn.late).map((turn) => turn.message);
      if (result.kind === "data") {
        setLines((shown) => [...keptLines(result.data, { going, whole, settled }), ...(shown ?? [])]);
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

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    setText("");
    // The turn is in the outbox before anything is awaited, so a window opened meanwhile sees it going and does not
    // offer a second send. It goes out at once, not behind the history read (a gateway that does not answer holds
    // that read for 30 s, lina-app#154); a read still out may then hold it, so it is matched as a carried turn.
    const box = outbox(store.source, agent);
    const sentAt = Date.now() / 1000;
    const turn: Sent = { key: `t${++sentKeys}`, message, reply: "", state: "sending", carried: historyPending.current, late: historyPending.current, at: sentAt, replyAt: sentAt };
    box.turns.push(turn);
    box.window?.redraw();
    const before = lastLinesOf(store.source).get(agent);
    keepLastLine(store.source, agent, firstLine(message));
    const result = await store.source.agentTalk(agent, { message });
    if (!result.ok) {
      box.turns.splice(box.turns.indexOf(turn), 1);
      // A refused turn is not the last message: the row goes back to what it showed before the send.
      keepLastLine(store.source, agent, before);
      const refusal = talkError(result);
      if (box.window) box.window.refused(refusal, message);
      else box.refusal = { line: refusal, message };
      box.window?.redraw();
      return;
    }
    turn.state = "streaming";
    box.window?.redraw();
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
            turn.replyAt = Date.now() / 1000;
            settle(box, turn);
            keepLastLine(store.source, agent, plainLine(turn.reply));
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

  // A reply that broke off before its first word leaves no bubble.
  const shown = [...(lines ?? []), ...box.turns.flatMap(sentLines)].filter((line) => line.mine || line.text || line.state === "streaming");

  if (missing) {
    return (
      <section class="agent-talk" aria-label={W.talkMissing} data-testid="talk-missing">
        <header class="agent-talk-head">
          <span class="lines">
            {titled ? (
              <h1 class="agent-talk-title" data-testid="screen-title">
                <span class="title one-line">{W.talkMissing}</span>
              </h1>
            ) : (
              <span class="title one-line">{W.talkMissing}</span>
            )}
          </span>
        </header>
        <p class="empty">
          <a class="text-button" href={href({ name: "talks" })}>
            {W.talk}
          </a>
        </p>
      </section>
    );
  }

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
        {lines === null ? (
          <p class="empty" data-testid="talk-loading">
            {W.loading}
          </p>
        ) : null}
        {shown.length ? (
          <Thread lines={shown} agent={agent} />
        ) : lines === null ? null : (
          <p class="empty" data-testid="no-turns">
            {historyError ? W.historyFailed : W.noTurns}
          </p>
        )}
      </div>
      <div class="comment-form talk-form agent-talk-form">
        <KoreanInput label={W.talkField} value={text} onValue={setText} onEnter={() => void send()} inline multiline />
        <SendButton disabled={sending || !text.trim()} onSend={() => void send()} />
        {/* Inside the field's bar: on a phone the bar is sticky and would cover a line drawn after it (lina-app#158). */}
        <ErrorLine line={error ?? undefined} />
      </div>
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
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={{ ...goal, href: href({ name: "talk", id: agent, goal: goal.id }) }} showAgent={false} count />} />
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
            {/* One line by design: the goals' names and progress at a glance, every row a tap away. A goal with no to-dos
                reads its name alone, as on its row (lina-app#167). */}
            <span class="sub one-line">{view.goals.rows.map((goal) => [foldTitle(goal.title) ?? W.untitled, goalProgress(goal)].filter(Boolean).join(" ")).join(SEP)}</span>
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
