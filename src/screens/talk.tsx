import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgentTalkHistory, ItemDetail } from "../api/client";
import type { Source, TalkResult } from "../data/source";
import { KoreanInput } from "../korean-input";
import { Markdown, plainLine } from "../markdown";
import { agentView, foldTitle } from "../model";
import { href, linkClick } from "../router";
import { clock } from "../time";
import { AgentMark, agentName, Box, Disclosure, ErrorLine, Link, ListSection, useApp } from "../ui/parts";
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
 * Why 보내기 is off, in the words 댓글 and 답 use (lina-app#200): the reply coming in, the turn going out, or an empty
 * field. An off 보내기 always says why, as the decision's 답 and 댓글 do (lina-app#238). It sits beside 보내기 on the
 * field's row, so the bar keeps its height and the field its place.
 */
function SendWhy({ replying, sending, empty }: { replying: boolean; sending: boolean; empty: boolean }) {
  const why = replying ? W.replying : sending ? W.sendWhyBusy : empty ? W.sendWhyEmpty : null;
  if (!why) return null;
  return (
    <span class="send-why" data-testid="send-why">
      {why}
    </span>
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
  // The owner's newest message sent from this window, wherever it stands: a send adds it together with the agent's empty
  // reply after it. A history line is not one: when a read confirms the send the line changes key (`t…-mine` to `h…`)
  // though nothing new was sent, and that must not pull a window read up back down.
  let lastMine: string | null = null;
  for (const line of lines) if (line.mine && line.state !== "kept") lastMine = line.key;
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
        <SendWhy replying={last?.state === "streaming"} sending={busy} empty={!text.trim()} />
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
  redrawLastLines();
}

function redrawLastLines() {
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

/** An agent row's name as it reads: the name, then its work in progress and its stopped work in words. */
export function talkRowName(name: string, running: number, stopped: number): string {
  return [name, running ? W.runningCount(running) : "", stopped ? W.stoppedCount(stopped) : ""].filter(Boolean).join(SEP);
}

/**
 * An agent row's first line: its name, then at the right edge its work in progress in grey and its stopped work in red,
 * each in words (`진행 중 1`, `중단됨 6`): a bare number beside `아직 나눈 대화 없음` read as unread messages (lina-app#207,
 * #219). The counts sit here, never beside the preview, so the line under it has the row's whole width.
 */
export function TalkNameLine({ name, nameClass, running, stopped }: { name: string; nameClass: string; running: number; stopped: number }) {
  return (
    <span class="talk-name-line" data-testid="talk-name-line">
      <span class={`${nameClass} one-line`}>{name}</span>
      {running || stopped ? (
        <span class="talk-counts">
          {running ? (
            <span class="talk-running" data-testid="talk-running">
              {W.runningCount(running)}
            </span>
          ) : null}
          {stopped ? (
            <span class="talk-stopped" data-testid="talk-stopped">
              {W.stoppedCount(stopped)}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * An agent row's second line: the first line of its last message, or `아직 나눈 대화 없음`; nothing until read. While a turn
 * goes it reads `답하는 중` (lina-app#190): neither the owner's own message nor what the core holds mid-turn.
 */
export function TalkPreview({ agent }: { agent: string }) {
  const { store } = useApp();
  const [, redraw] = useState(0);
  // A turn added elsewhere (another device, lina-app#205) is read again when the stream says so.
  const changes = store.talkChanges(agent);
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
  }, [agent, store, changes]);
  const line = lastLinesOf(store.source).get(agent);
  const going = outboxes.get(store.source)?.get(agent)?.turns.some((turn) => turn.state === "sending" || turn.state === "streaming");
  if (line === undefined && !going) return null;
  return (
    <span class="sub one-line talk-preview" data-testid="talk-preview">
      {going ? W.replying : line || W.noTurns}
    </span>
  );
}

/** The earlier turns the core's history holds, as lines. */
function keptLines(history: AgentTalkHistory): ThreadLine[] {
  return history.messages.map((message, index) => ({ key: `h${index}`, mine: message.role === "user", text: message.role === "user" ? ownText(message.content) : message.content, at: message.timestamp, state: "kept" }));
}

/** One turn sent from an agent's window. It lives outside the window, so leaving the window neither cancels nor drops it (lina-app#127). */
export interface Sent {
  readonly key: string;
  readonly message: string;
  reply: string;
  /** `sending` until the core answers the send (lina-app#154): the message shows at once, the reply after. */
  state: "sending" | "streaming" | "done" | "failed";
  /**
   * How many messages the core's history held at the newest read this page had applied when the turn went out (null:
   * none applied yet). The history holds the turn only from there on, so an earlier exchange that reads the same is
   * never taken for it.
   */
  readonly base: number | null;
  /**
   * The number of the first history read that began after the core took the turn (null: not taken yet). Only a read from
   * here on can hold the turn, with a `base` or without: an earlier read cannot, so an earlier or another device's
   * exchange that reads the same is never taken for it, whatever the two clocks say.
   */
  from: number | null;
  /** When the message went out and when its reply last moved, in seconds. */
  readonly at: number;
  replyAt: number;
  /** A failed turn the open window has said so about already: a later window does not say it again. */
  told: boolean;
}

/** The window open on an agent now: it redraws a streaming turn, says so when a reply broke off, and shows a refusal. */
interface TalkWindow {
  redraw(): void;
  failed(): void;
  /** Reads the history again, from now. */
  reread(): void;
  /** The core refused the turn: its words, shown in the window, and the message back in an empty field. */
  refused(error: string, message: string): void;
}

/**
 * The turns this page sent to one agent that the core's history has not shown yet, and the window open on it. A turn
 * stays here until a history read holds it (`withTurns`), so a read can never take a turn away, whatever the order
 * of the read, the turn's end and the stream's events.
 */
interface Outbox {
  readonly turns: Sent[];
  window: TalkWindow | null;
  /** The size of the newest history this page applied, which a turn sent next is read from (`Sent.base`). */
  known: number | null;
  /** How many history reads began, and the number of the newest one applied (`Sent.from`). */
  started: number;
  applied: number;
  /** A refusal that came while no window was open, shown by the next one. */
  refusal: { readonly line: string; readonly message: string } | null;
}

const outboxes = new WeakMap<Source, Map<string, Outbox>>();
let sentKeys = 0;

function outbox(source: Source, agent: string): Outbox {
  let agents = outboxes.get(source);
  if (!agents) outboxes.set(source, (agents = new Map()));
  let box = agents.get(agent);
  if (!box) agents.set(agent, (box = { turns: [], window: null, known: null, started: 0, applied: 0, refusal: null }));
  return box;
}

function sentLines(turn: Sent): ThreadLine[] {
  if (turn.state === "sending") return [{ key: `${turn.key}-mine`, mine: true, text: turn.message, at: turn.at, state: "sending" }];
  return [
    { key: `${turn.key}-mine`, mine: true, text: turn.message, at: turn.at, state: "done" },
    { key: turn.key, mine: false, text: turn.reply, at: turn.replyAt, state: turn.state },
  ];
}

/**
 * Where the history holds the turn: the owner's message and, when the core has one, its reply (indexes into `kept`),
 * or null. The history `read` (the number of the read it came from) must have begun after the core took the turn,
 * whether or not a `base` is known: an older read cannot hold it, and a same-worded message another device added since
 * is not it. It looks from the newest line back to `base`. The reply is not compared: the core may keep it in other
 * marks than it streamed.
 */
function holdOf(kept: readonly ThreadLine[], read: number, turn: Sent, used: ReadonlySet<number>): readonly number[] | null {
  if (turn.from === null || read < turn.from) return null;
  for (let own = kept.length - 1; own >= (turn.base ?? 0); own -= 1) {
    const line = kept[own];
    if (used.has(own) || !line.mine || line.text !== turn.message) continue;
    const answer = kept[own + 1];
    if (answer && !answer.mine && !used.has(own + 1)) {
      return [own, own + 1];
    }
    if (!answer || answer.mine) return [own];
  }
  return null;
}

/** Whether a history read could hold `turn`, yet began before the core took it, with no base to tell it by. */
function unsure(kept: readonly ThreadLine[], read: number, turn: Sent): boolean {
  if (turn.base !== null || turn.from === null || read >= turn.from) return false;
  return kept.some((line) => line.mine && line.text === turn.message);
}

/**
 * What the window draws: the core's history `kept`, then the turns it does not hold yet. A turn still going, or one
 * that failed, is drawn from the page (the core holds its message at most, or a reply that may differ), so the lines
 * the core has for it are left out. A turn the core holds whole and that is done or failed is drawn from the history
 * and `confirmed`: the outbox drops it.
 */
export function withTurns(kept: readonly ThreadLine[], read: number, turns: readonly Sent[]): { readonly lines: ThreadLine[]; readonly confirmed: Sent[] } {
  const used = new Set<number>();
  const left = new Set<number>();
  const confirmed: Sent[] = [];
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const turn = turns[at];
    const held = holdOf(kept, read, turn, used);
    if (!held) continue;
    for (const index of held) used.add(index);
    if (held.length === 2 && turn.state !== "sending" && turn.state !== "streaming") confirmed.push(turn);
    else for (const index of held) left.add(index);
  }
  const own = (turn: Sent) => !confirmed.includes(turn);
  return { lines: [...kept.filter((_, index) => !left.has(index)), ...turns.filter(own).flatMap(sentLines)], confirmed };
}

/** A turn's stream has ended, done or failed: the window draws it as it is now; it leaves the outbox when a read holds it. */
function settle(box: Outbox, turn: Sent) {
  if (box.window) {
    turn.told = true;
    if (turn.state === "failed") box.window.failed();
  }
  box.window?.redraw();
}

/**
 * Who the window talks with, as a chat app's head shows it (lina-app#191): the agent's mark and name, the screen's one
 * title, in the bar over the window (the phone's navbar, the wide window's toolbar), so it never scrolls away. Before
 * the agents are read, and for an address no agent has, it reads the tab's word.
 */
export function TalkHead({ agent }: { agent: string }) {
  const { model } = useApp();
  const known = model.agents.some((each) => each.id === agent);
  return (
    <div class="talk-head">
      {known ? <AgentMark id={agent} /> : null}
      <h1 class="one-line" data-testid="screen-title">
        <span data-testid={known ? "agent-talk-name" : undefined}>{known ? agentName(model, agent) : W.talk}</span>
      </h1>
    </div>
  );
}

/**
 * The owner's own window on one agent (lina#482): the earlier turns read from the core, then this page's turns, the
 * reply streaming in under the agent's mark. It is the agent's app conversation, not its messenger chat. Its head is
 * TalkHead, in the bar above it.
 */
export function AgentTalk({ agent, children }: { agent: string; children?: ComponentChildren }) {
  const { model, store } = useApp();
  /** The core's history as last read; null until the first read lands. This page's own turns are drawn after it (`withTurns`). */
  const [lines, setLines] = useState<readonly ThreadLine[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useState(0);
  /** The stream's count of changes to this conversation that the newest read began at (lina-app#205). */
  const talkChanges = store.talkWindowChanges(agent);
  const readAt = useRef(talkChanges);
  // The number of the newest read begun and of the newest applied: a read that lands after a newer one was applied is
  // older than it and dropped. `opened` counts the windows, so a read of an earlier window is dropped too.
  const readSeq = useRef(0);
  const readApplied = useRef(0);
  const opened = useRef(0);
  const name = agentName(model, agent) || agent;
  const box = outbox(store.source, agent);
  const sending = box.turns.some((turn) => turn.state === "sending" || turn.state === "streaming");
  // An address naming no agent the core lists (lina-app#154); unknown until the agents are read.
  const missing = store.status("items") === "ok" && !model.agents.some((each) => each.id === agent);

  /**
   * Reads the history and draws it in place of the one before. A read can start at any time, a turn of this page going
   * or not: the turns stay in the outbox, drawn after it, until a history holds them (`withTurns`).
   */
  const read = (first: boolean) => {
    const box = outbox(store.source, agent);
    const token = ++readSeq.current;
    const number = ++box.started;
    const gen = opened.current;
    readAt.current = store.talkWindowChanges(agent);
    void store.source.agentTalkHistory(agent).then((result) => {
      if (gen !== opened.current || token < readApplied.current) return;
      if (result.kind !== "data") {
        // Only the first read has something to say: a later one that fails leaves the history as it was.
        if (first) {
          setLines((shown) => shown ?? []);
          if (result.kind === "failed") setHistoryError(true);
        }
        return;
      }
      const kept = keptLines(result.data);
      // A history that began before the core took a turn this page sent, with no earlier history to tell by, may hold
      // the turn or an earlier exchange that reads the same, and nothing says which: it is not applied, the read the
      // turn started when the core took it is (`Sent.from`).
      if (box.turns.some((turn) => unsure(kept, number, turn))) return;
      readApplied.current = token;
      for (const turn of withTurns(kept, number, box.turns).confirmed) box.turns.splice(box.turns.indexOf(turn), 1);
      box.known = kept.length;
      box.applied = number;
      setLines(kept);
      if (!box.turns.length) keepLastLine(store.source, agent, lastLineOf(result.data));
    });
  };

  useEffect(() => {
    const box = outbox(store.source, agent);
    const open: TalkWindow = {
      redraw: () => redraw((count) => count + 1),
      failed: () => setError(W.talkFailed),
      reread: () => read(box.applied === 0),
      refused(line, message) {
        setError(line);
        setText((typed) => (typed.trim() ? typed : message));
      },
    };
    box.window = open;
    opened.current += 1;
    if (box.refusal) {
      open.refused(box.refusal.line, box.refusal.message);
      box.refusal = null;
    }
    // A reply that broke off while no window was open is told once, by the first window that opens after.
    if (box.turns.some((turn) => turn.state === "failed" && !turn.told)) {
      for (const turn of box.turns) if (turn.state === "failed") turn.told = true;
      open.failed();
    }
    read(true);
    // Leaving the window does not cancel the turn the owner sent; it stays in the outbox for the next window (lina-app#127).
    return () => {
      if (box.window === open) box.window = null;
      opened.current += 1;
    };
  }, [agent, store]);

  // A turn added elsewhere (another device, lina-app#205): the earlier turns are read again and replace what the window
  // drew from the core. This page's own turns are not in that: they stay in the outbox until a history holds them.
  useEffect(() => {
    if (readAt.current !== talkChanges) read(false);
  }, [agent, store, talkChanges]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    setText("");
    // The turn is in the outbox before anything is awaited, so a window opened meanwhile sees it going and does not
    // offer a second send. It goes out at once, not behind the history read (a gateway that does not answer holds
    // that read for 30 s, lina-app#154); a read still out may then hold it, which `withTurns` finds.
    const box = outbox(store.source, agent);
    const sentAt = Date.now() / 1000;
    const turn: Sent = { key: `t${++sentKeys}`, message, reply: "", state: "sending", base: box.known, from: null, at: sentAt, replyAt: sentAt, told: false };
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
    // The core holds the message from here: the next read to begin can show it.
    turn.from = box.started + 1;
    box.window?.reread();
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
      // The row's 답하는 중 goes; the owner's message is the last one.
      redrawLastLines();
    } else if (failed) box.window?.failed();
  };

  // A reply that broke off before its first word leaves no bubble.
  const shown = withTurns(lines ?? [], box.applied, box.turns).lines.filter((line) => line.mine || line.text || line.state === "streaming");

  if (missing) {
    return (
      <section class="agent-talk" aria-label={W.talkMissing} data-testid="talk-missing">
        <p class="empty">
          {W.talkMissing}
          <br />
          <a class="text-button" href={href({ name: "talks" })} onClick={linkClick}>
            {W.talk}
          </a>
        </p>
      </section>
    );
  }

  return (
    <section class="agent-talk" aria-label={`${name} ${W.talk}`} data-testid="agent-talk">
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
        <SendWhy replying={box.turns.some((turn) => turn.state === "streaming")} sending={sending} empty={!text.trim()} />
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
  // A goal opens under 대화, beside the window on a wide one and one step deeper on a phone (lina-app#143). Its mark
  // follows its to-dos beside the n/n it writes: every n/n draws the done mark, also one that still waits to be closed
  // (lina-app#200); the goal's page keeps the owner's own done check.
  const body = (
    <>
      <ListSection section={view.goals} render={(goal) => <GoalLine key={goal.id} goal={{ ...goal, state: goal.allDone ? "done" : goal.state, href: href({ name: "talk", id: agent, goal: goal.id }) }} showAgent={false} count />} />
      <ul class="rows" aria-label={W.done}>
        <li class="row" data-testid="card-done-today">
          <Link href={href({ name: "done", agent })} label={view.doneToday ? W.doneToday(view.doneToday.count) : W.loading}>
            <span class="lines">
              <span class="title">{view.doneToday ? W.doneToday(view.doneToday.count) : W.loading}</span>
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
                reads its name alone, as on its row (lina-app#167). Open, the rows under it say the same, so it goes
                (lina-app#190). */}
            {open ? null : <span class="sub one-line">{view.goals.rows.map((goal) => [foldTitle(goal.title) ?? W.untitled, goalProgress(goal)].filter(Boolean).join(" ")).join(SEP)}</span>}
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
            <Link href={target} label={talkRowName(agent.name, running, stopped)} current={selected === target}>
              <AgentMark id={agent.id} />
              <span class="lines">
                <TalkNameLine name={agent.name} nameClass="title" running={running} stopped={stopped} />
                <TalkPreview agent={agent.id} />
              </span>
              <Disclosure />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
