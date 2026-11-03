import type { ActionResult, AnswerRequest, AnswerResult, BoardSnapshot, ChangeEvent, ChangeMessage, CommentRequest, DoneRequest, ItemDetail, ItemSummary, NoticesReadRequest, NoticesReadResult, RouteName, Routes, TalkEvent, TalkRequest, WorkState } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type Scene } from "../fixtures/synthetic";
import { nowSeconds, type ChangeHandlers, type ChangeSocket, type ReadResult, type Source, type TalkResult, type WriteResult } from "./source";

function bodyOf(scene: Scene, name: RouteName, id?: string): unknown {
  switch (name) {
    case "board":
      return scene.board;
    case "items":
      return scene.items;
    case "item":
      return id ? scene.itemDetails[id] : undefined;
    case "devices":
      return scene.devices;
    case "quota":
      return scene.quota;
    case "goals":
      return scene.goals;
    case "goal":
      return scene.goals.goals.find((goal) => goal.id === id);
    case "cards":
      return scene.cards;
    case "card":
      return id ? scene.cardDetails[id] : undefined;
    case "inbox":
      return scene.inbox;
  }
}

/** The owner's done mark can be taken back for ten minutes (lina#149). */
export const UNDO_SECONDS = 600;

type DueGroup = keyof BoardSnapshot["due"];

/** What one owner's done mark changed, so undo can put it back. */
interface DoneMark {
  readonly id: string;
  readonly at: number;
  readonly undoUntil: number;
  readonly before: readonly { id: string; state: WorkState; reason: string | null; stateSince: number | null; closedAt: number | null }[];
  readonly mine: readonly { index: number; row: BoardSnapshot["inbox"]["mine"][number] }[];
  readonly due: readonly { group: DueGroup; index: number; row: BoardSnapshot["due"][DueGroup][number] }[];
}

/** Seconds after an owner's comment before the synthetic agent replies: it lands on the next refresh. */
export const SYNTHETIC_REPLY_AFTER = 5;

/** The comment retry leaves on a to-do: the core re-runs nothing, the owning agent reads it. */
export const RETRY_TEXT = "다시 시도해 주세요.";

const REPLY_TEXT = { comment: "확인했어요. 반영할게요.", answer: "답을 받았어요. 이어서 할게요." } as const;

/** Milliseconds between two frames of the synthetic talk stream. */
export const TALK_FRAME_MS = 400;

/** The synthetic agent's reply to any message, in the pieces it streams. */
export const TALK_REPLY_DELTAS = ["네, 확인했어요. ", "입력 폼 간격부터 ", "맞추고 오늘 안에 ", "다시 알려 드릴게요."] as const;

/** How the synthetic gateway refuses a turn (`&talk=busy|down|none`): busy 429, down 503, no owning agent 409. */
export type TalkRefusal = "busy" | "down" | "none";

const TALK_REFUSED: Record<TalkRefusal, { status: number; code: string | null }> = {
  busy: { status: 429, code: null },
  down: { status: 503, code: "gateway_unreachable" },
  none: { status: 409, code: "no_owning_agent" },
};

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** The frames the core relays for one turn, in its order: talk.started, the gateway's run, talk.carried after the reply, done. */
export function syntheticTalkFrames(item: { id: string; title: string }, agent: string, message: string, ts: number): TalkEvent[] {
  const session = `app-${agent}`;
  const run = `run-${item.id}-${ts}`;
  const messageId = `msg-${item.id}-${ts}`;
  let seq = 0;
  const frame = () => ({ session_id: session, run_id: run, seq: (seq += 1), ts });
  return [
    { event: "talk.started", data: { item: { id: item.id, title: item.title }, agent, session_id: session } },
    { event: "run.started", data: { ...frame(), user_message: { role: "user", content: message } } },
    { event: "message.started", data: { ...frame(), message: { id: messageId, role: "assistant" } } },
    ...TALK_REPLY_DELTAS.map((delta): TalkEvent => ({ event: "assistant.delta", data: { ...frame(), message_id: messageId, delta } })),
    { event: "assistant.completed", data: { ...frame(), message_id: messageId, content: TALK_REPLY_DELTAS.join("") } },
    { event: "talk.carried", data: { agent, item: item.id } },
    { event: "run.completed", data: { ...frame(), message_id: messageId } },
    { event: "done", data: frame() },
  ];
}

/** Each scene's write count: a source answers "unchanged" while the scene has not changed since it served a route. */
const versions = new WeakMap<Scene, number>();

/** How often the synthetic stream sends what changed, like the core's batch interval. */
export const STREAM_TICK_MS = 300;
/** Events the synthetic stream keeps; a `since` older than that gets a resync, like the core's kept history. */
export const STREAM_HISTORY = 200;
/** `&live=drop`: the first connection drops this long after it opens, and another device writes meanwhile. */
export const STREAM_DROP_AFTER_MS = 3_000;
/** `&live=resync`: one resync this long after the first connection opens. */
export const STREAM_RESYNC_AFTER_MS = 2_000;

/** How the synthetic stream behaves (`&live=`): as the core, refusing every connection, dropping once, or one resync. */
export type StreamScript = "ok" | "down" | "drop" | "resync";

/** Each scene's change log, shared by every source on it like the core's stores: `total` events so far. */
interface ChangeLog {
  readonly epoch: number;
  total: number;
  readonly events: ChangeEvent[];
}
const logs = new WeakMap<Scene, ChangeLog>();
let epochs = 0;

function logOf(scene: Scene): ChangeLog {
  let log = logs.get(scene);
  if (!log) {
    log = { epoch: (epochs += 1), total: 0, events: [] };
    logs.set(scene, log);
  }
  return log;
}

function cursorOf(log: ChangeLog, at: number): string {
  return `s.${log.epoch}.${at}`;
}

/** The position a cursor names in this log, or null when it is not this log's or no longer kept. */
function positionOf(log: ChangeLog, cursor: string): number | null {
  const match = /^s\.(\d+)\.(\d+)$/.exec(cursor);
  if (!match || Number(match[1]) !== log.epoch) return null;
  const at = Number(match[2]);
  return at > log.total || at < log.total - log.events.length ? null : at;
}

function eventsAfter(log: ChangeLog, at: number): ChangeEvent[] {
  return log.events.slice(log.events.length - (log.total - at));
}

/** One connection of the synthetic stream, as verify.mjs reads it: what it resumed from and what it got first. */
export interface StreamConnection {
  readonly since: string | null;
  first: "tail" | "missed" | "resync" | "refused";
  missed: number;
  open: boolean;
}

interface Connection {
  readonly handlers: ChangeHandlers;
  readonly record: StreamConnection;
  at: number;
  timer: ReturnType<typeof setInterval> | null;
  resync: boolean;
  closed: boolean;
}

function work(kind: string, id: string): Omit<ChangeEvent, "at"> {
  return { source: "work", kind, id };
}

function fail(status: number, detail: string): WriteResult<never> {
  return { ok: false, status, detail };
}

/**
 * Serves the synthetic scene like the core does: data on the first read of a route, then "unchanged" until a write
 * changes the scene. It keeps its own copy of the scene and applies the owner's writes to it the way the core applies
 * them to the record, so drives and captures go through the same screens and requests as on a live core.
 */
export class SyntheticSource implements Source {
  readonly scene: Scene;
  private readonly served = new Map<string, number>();
  private readonly replies: { id: string; cid: string; at: number; kind: "comment" | "answer" }[] = [];
  private nextCid = 1;
  private nextCardComment = 100;
  /** The last record per item: the owner's own done mark, or null once anything else was written after it. */
  private readonly marks = new Map<string, DoneMark | null>();
  private readonly talkRefusal: TalkRefusal | null;
  private readonly connections = new Set<Connection>();
  private readonly script: StreamScript;
  private streamDown: boolean;
  /** Every connection opened, and every snapshot read, for verify.mjs and the tests. */
  readonly stream: StreamConnection[] = [];
  reads = 0;

  /** `scene` shares another source's copy, like a second device reading the same core. */
  constructor(options: { seed?: number; now?: number; sourceError?: boolean; noRunning?: boolean; scene?: Scene; talk?: TalkRefusal | null; live?: StreamScript } = {}) {
    this.talkRefusal = options.talk ?? null;
    this.script = options.live ?? "ok";
    this.streamDown = this.script === "down";
    this.scene =
      options.scene ??
      generateScene(options.seed ?? SYNTHETIC_SEED, {
        now: Math.floor(options.now ?? nowSeconds()),
        sourceError: options.sourceError,
        noRunning: options.noRunning,
      });
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const at = nowSeconds();
    this.reads += 1;
    this.deliverReplies(at);
    const body = bodyOf(this.scene, name, id);
    if (body === undefined) return { kind: "missing", at };
    const key = `${name}:${id ?? ""}`;
    const version = versions.get(this.scene) ?? 0;
    if (this.served.get(key) === version) return { kind: "unchanged", at };
    this.served.set(key, version);
    return { kind: "data", data: structuredClone(body) as Routes[N], at };
  }

  async comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const text = body.text.trim();
    if (!text || text.length > 2000) return fail(400, "text must be 1-2000 characters after trimming");
    if (body.answer && (!detail.decision || detail.decision.answered)) return fail(409, `${id}에 주인이 정할 것이 없다`);
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    const kind = body.answer ? "answer" : "comment";
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text, status: "open", kind, replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (body.answer && detail.decision) {
      detail.decision.answered = true;
      detail.decision.cid = cid;
      for (const row of this.scene.board.inbox.decide) if (row.target === id) row.answered = true;
    }
    this.replies.push({ id, cid, at, kind });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed(work("commented", id));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  async done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    if (detail.state === "done") return fail(409, `${id}는 열린 항목이 아니다`);
    const open = detail.kind === "goal" ? detail.children.filter((child) => child.state !== "done").map((child) => child.id) : [];
    if (open.length && !body.withOpen) return fail(409, `${id}에 열린 할 일이 남아 있어 완료로 표시하지 않았다: ${open.join(", ")} — 함께 닫으려면 --with-open`);
    const at = Math.floor(nowSeconds());
    const ids = [id, ...open];
    const mark: DoneMark = {
      id,
      at,
      undoUntil: at + UNDO_SECONDS,
      before: ids.map((each) => {
        const item = this.scene.itemDetails[each];
        return { id: each, state: item.state, reason: item.reason, stateSince: item.stateSince, closedAt: item.closedAt };
      }),
      mine: this.scene.board.inbox.mine.map((row, index) => ({ index, row })).filter(({ row }) => ids.includes(row.id)),
      due: (Object.keys(this.scene.board.due) as DueGroup[]).flatMap((group) => this.scene.board.due[group].map((row, index) => ({ group, index, row })).filter(({ row }) => ids.includes(row.id))),
    };
    for (const each of ids) this.patchItem(each, { state: "done", reason: null, stateSince: at, closedAt: at, lastActivityAt: at });
    this.scene.board.inbox.mine = this.scene.board.inbox.mine.filter((row) => !ids.includes(row.id));
    for (const group of Object.keys(this.scene.board.due) as DueGroup[]) this.scene.board.due[group] = this.scene.board.due[group].filter((row) => !ids.includes(row.id));
    detail.ownerDone = { at, undoUntil: mark.undoUntil, with: open };
    this.marks.set(id, mark);
    this.recount(ids);
    this.changed(...ids.map((each) => work("done", each)));
    return { ok: true, data: { ok: true, id, state: "done", reason: null, cid: null, undoUntil: mark.undoUntil } };
  }

  async undo(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const mark = this.marks.get(id);
    if (!mark) return fail(409, `${id}의 마지막 기록이 주인의 완료 표시가 아니다`);
    if (nowSeconds() > mark.undoUntil) return fail(409, `완료 표시 뒤 10분이 지나 되돌리지 않았다 (${Math.floor((nowSeconds() - mark.at) / 60)}분 전). 다시 열려면 work reopen`);
    for (const before of mark.before) this.patchItem(before.id, { state: before.state, reason: before.reason, stateSince: before.stateSince, closedAt: before.closedAt });
    for (const { index, row } of mark.mine) this.scene.board.inbox.mine.splice(index, 0, row);
    for (const { group, index, row } of mark.due) this.scene.board.due[group].splice(index, 0, row);
    detail.ownerDone = null;
    this.marks.delete(id);
    this.recount(mark.before.map((before) => before.id));
    this.changed(...mark.before.map((before) => work("reopened", before.id)));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid: null, undoUntil: null } };
  }

  async retry(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, `no goal or to-do ${id}`);
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text: RETRY_TEXT, status: "open", kind: "comment", replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed(work("commented", id));
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  async answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>> {
    const card = this.scene.cardDetails[cardId];
    if (!card) return fail(404, "no such card");
    const text = body.text.trim();
    if (!text) return fail(400, "empty text");
    const commentId = this.nextCardComment++;
    card.comments.push({ id: commentId, author: SYNTHETIC_OWNER.id, body: text, createdAt: Math.floor(nowSeconds()) });
    this.scene.inbox.questions = this.scene.inbox.questions.filter((question) => question.cardId !== cardId);
    this.changed({ source: "kanban", kind: "commented", id: cardId });
    return { ok: true, data: { ok: true, cardId, commentId, unblocked: false, state: card.state, reason: card.reason } };
  }

  async readNotices(body: NoticesReadRequest): Promise<WriteResult<NoticesReadResult>> {
    const keys = "keys" in body ? body.keys : null;
    if (keys && !keys.length) return fail(400, "keys is a non-empty list of notice keys");
    for (const notice of this.scene.board.notices) if (!keys || keys.includes(notice.key)) notice.read = true;
    const unread = this.scene.board.notices.filter((notice) => !notice.read).length;
    this.scene.board.counts.unread = unread;
    this.changed(work("notices_read", keys?.join(",") ?? "all"));
    return { ok: true, data: { ok: true, unread } };
  }

  /**
   * One talk turn like the core's: the same refusals, then the frames one TALK_FRAME_MS apart on timers, so fake
   * timers step through it. The exchange lives in the agent's conversation, not in the work record: the scene does
   * not change.
   */
  async talk(id: string, body: TalkRequest, signal?: AbortSignal): Promise<TalkResult> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return { ok: false, status: 404, code: "unknown_item" };
    const message = body.message.trim();
    if (!message) return { ok: false, status: 400, code: "empty_message" };
    if (message.length > 4000) return { ok: false, status: 413, code: "message_too_long" };
    if (this.talkRefusal) return { ok: false, ...TALK_REFUSED[this.talkRefusal] };
    const agent = detail.agent ?? (detail.parent ? this.scene.itemDetails[detail.parent]?.agent : null);
    if (!agent) return { ok: false, status: 409, code: "no_owning_agent" };
    const frames = syntheticTalkFrames(detail, agent, message, nowSeconds());
    async function* events(): AsyncGenerator<TalkEvent> {
      for (const frame of frames) {
        await wait(TALK_FRAME_MS, signal);
        yield frame;
      }
    }
    return { ok: true, events: events() };
  }

  /**
   * The core's change stream over this scene's log: the first message after a microtask (the tail, what a kept
   * `since` missed, or one resync), then what changed every STREAM_TICK_MS on a timer, so fake timers step it. The
   * tick also lets the synthetic agent reply, as the core's agents write on their own.
   */
  changes(since: string | null, handlers: ChangeHandlers): ChangeSocket {
    const record: StreamConnection = { since, first: "refused", missed: 0, open: false };
    this.stream.push(record);
    const connection: Connection = { handlers, record, at: 0, timer: null, resync: false, closed: false };
    const opening = this.stream.length === 1;
    queueMicrotask(() => {
      if (connection.closed) return;
      if (this.streamDown) {
        connection.closed = true;
        handlers.closed();
        return;
      }
      const log = logOf(this.scene);
      const at = since === null ? log.total : positionOf(log, since);
      let message: ChangeMessage;
      if (at === null) {
        record.first = "resync";
        message = { cursor: cursorOf(log, log.total), resync: true };
      } else {
        const missed = eventsAfter(log, at);
        record.first = since === null ? "tail" : "missed";
        record.missed = missed.length;
        message = { cursor: cursorOf(log, log.total), events: missed };
      }
      record.open = true;
      connection.at = log.total;
      this.connections.add(connection);
      connection.timer = setInterval(() => this.tick(connection), STREAM_TICK_MS);
      handlers.message(message);
      if (opening && this.script === "drop") setTimeout(() => this.dropWhileAnotherDeviceWrites(), STREAM_DROP_AFTER_MS);
      if (opening && this.script === "resync") setTimeout(() => this.resyncStreams(), STREAM_RESYNC_AFTER_MS);
    });
    return { close: () => this.end(connection, false) };
  }

  /** Every open connection drops, as on sleep or a network change. */
  dropStreams(): void {
    for (const connection of [...this.connections]) this.end(connection, true);
  }

  /** The next tick of every open connection is one resync, as when a store that was down reads again. */
  resyncStreams(): void {
    for (const connection of this.connections) connection.resync = true;
  }

  /** While down, every new connection closes before its first message. */
  setStreamDown(down: boolean): void {
    this.streamDown = down;
  }

  /** `&live=drop`: the stream drops, then another device marks the first unread notice read before the reconnect. */
  private dropWhileAnotherDeviceWrites(): void {
    this.dropStreams();
    const key = this.scene.board.notices.find((notice) => !notice.read)?.key;
    if (key) void this.readNotices({ keys: [key] });
  }

  private end(connection: Connection, notify: boolean): void {
    if (connection.timer !== null) clearInterval(connection.timer);
    connection.timer = null;
    connection.closed = true;
    connection.record.open = false;
    const wasOpen = this.connections.delete(connection);
    if (notify && wasOpen) connection.handlers.closed();
  }

  private tick(connection: Connection): void {
    this.deliverReplies(nowSeconds());
    const log = logOf(this.scene);
    if (connection.resync) {
      connection.resync = false;
      connection.at = log.total;
      connection.handlers.message({ cursor: cursorOf(log, log.total), resync: true });
      return;
    }
    if (connection.at === log.total) return;
    const events = eventsAfter(log, connection.at);
    connection.at = log.total;
    connection.handlers.message({ cursor: cursorOf(log, log.total), events });
  }

  /** Goals' to-do counts follow their to-dos' states. */
  private recount(ids: readonly string[]): void {
    const goals = new Set(ids.map((id) => this.scene.itemDetails[id]).map((item) => (item?.kind === "goal" ? item.id : item?.parent)).filter((id): id is string => Boolean(id)));
    for (const goal of goals) {
      const children = this.scene.itemDetails[goal]?.children ?? [];
      this.patchItem(goal, { todos: { done: children.filter((child) => child.state === "done").length, total: children.length } });
    }
  }

  /** The owning agent answers each owner comment once it is SYNTHETIC_REPLY_AFTER seconds old. */
  private deliverReplies(now: number): void {
    const due = this.replies.filter((reply) => now - reply.at >= SYNTHETIC_REPLY_AFTER);
    if (!due.length) return;
    for (const reply of due) {
      this.replies.splice(this.replies.indexOf(reply), 1);
      const detail = this.scene.itemDetails[reply.id];
      const comment = detail?.comments.find((entry) => entry.cid === reply.cid);
      if (!detail || !comment) continue;
      comment.replies.push({ by: detail.agent ?? "", at: Math.floor(now), text: REPLY_TEXT[reply.kind], result: "applied" });
      if (reply.kind === "answer") {
        detail.decision = null;
        const decide = this.scene.board.inbox.decide;
        for (let index = decide.length - 1; index >= 0; index -= 1) if (decide[index].target === reply.id) decide.splice(index, 1);
      }
    }
    this.changed(...due.map((reply) => work("comment_replied", reply.id)));
  }

  /** The same fields on the item's list entry, its detail and its row in its goal's children. */
  protected patchItem(id: string, patch: Partial<ItemSummary>): void {
    const targets: (ItemSummary | ItemDetail | undefined)[] = [this.scene.items.items.find((item) => item.id === id), this.scene.itemDetails[id]];
    const parent = this.scene.itemDetails[id]?.parent;
    if (parent) targets.push(this.scene.itemDetails[parent]?.children.find((child) => child.id === id));
    for (const target of targets) if (target) Object.assign(target, patch);
  }

  /**
   * The scene changed: every route answers with data again on its next read, from every source sharing it, and the
   * change goes into the scene's log for every stream on it.
   */
  protected changed(...events: Omit<ChangeEvent, "at">[]): void {
    versions.set(this.scene, (versions.get(this.scene) ?? 0) + 1);
    const log = logOf(this.scene);
    const at = Math.floor(nowSeconds());
    log.events.push(...events.map((event) => ({ ...event, at })));
    log.total += events.length;
    if (log.events.length > STREAM_HISTORY) log.events.splice(0, log.events.length - STREAM_HISTORY);
  }
}
