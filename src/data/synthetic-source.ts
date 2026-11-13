import { SETTINGS_HISTORY, type ActionResult, type AddItemRequest, type AgentTalkEvent, type AgentTalkHistory, type AnswerRequest, type AnswerResult, type BoardSnapshot, type ChangeEvent, type ChangeMessage, type CommentRequest, type DeviceAction, type DoneRequest, type ItemDetail, type ItemSummary, type NoticesReadRequest, type NoticesReadResult, type PushKey, type PushRemoveRequest, type PushRemoveResult, type PushSubscriptionRequest, type PushSubscriptionResult, type RouteName, type Routes, type Settings, type SettingsAuditLine, type SettingsModel, type SettingsPatch, type SettingsWritten, type TalkEvent, type TalkRequest, type WorkState } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type PowerVariant, type Scene, type SettingsVariant } from "../fixtures/synthetic";
import { mergePatch } from "../model/settings";
import { currentSettings, historyView, invalidDetail, modelsView, revisionOf, settingsView, validate, writeRevision } from "./synthetic-settings";
import { base64UrlBytes, type PushManagerLike, type PushSubscriptionLike } from "../push";
import { nowSeconds, type AgentTalkResult, type ChangeHandlers, type ChangeSocket, type ReadResult, type Renewal, type Source, type TalkResult, type WriteResult } from "./source";

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
    case "usage":
      return scene.usage[(id ?? "today") as keyof typeof scene.usage];
    case "modelsState":
      return scene.modelsState;
    case "checks":
      return scene.checks;
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
    case "record":
      return id ? scene.records[id] : undefined;
    case "settings":
      return settingsView(scene.settings, Math.floor(nowSeconds()));
    case "settingsHistory":
      return historyView(scene.settings, Number(id ?? SETTINGS_HISTORY.recent), Math.floor(nowSeconds()));
    case "settingsModels":
      return modelsView(scene.settings, Math.floor(nowSeconds()));
  }
}

/**
 * How the synthetic core takes settings writes (`&settings=`): this device may only read them, no revision was ever
 * written, or another device writes just before this page's first write, which the core then refuses as stale (412).
 */
export type SettingsScript = SettingsVariant | "stale" | "race";

/** Who the synthetic core says wrote from this page, and from the other device of `&settings=stale`. */
export const SETTINGS_WRITER = { principal: SYNTHETIC_OWNER.id, device: "나침반", other: "먹물" } as const;

/** A settings write drawn over another revision than the one read last: stale, and not sent, like HttpSource. */
const NOT_THE_READ: WriteResult<never> = { ok: false, status: 412, detail: null };

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

/** The synthetic agent's reply in the owner's own window on it, in the pieces it streams. */
export const AGENT_REPLY_DELTAS = ["네, 보고 있어요. ", "지금 하는 일을 ", "정리해서 바로 ", "알려 드릴게요."] as const;

/** The first line the core puts on the owner's turns in that window (lina#482). */
export const APP_FIRST_LINE = "[LINA app]";

/** The frames of one turn in the owner's window on an agent: like a to-do's, with no item and nothing carried. */
export function syntheticAgentTalkFrames(agent: string, message: string, ts: number): AgentTalkEvent[] {
  const session = `app-${agent}`;
  const run = `run-${agent}-${ts}`;
  const messageId = `msg-${agent}-${ts}`;
  let seq = 0;
  const frame = () => ({ session_id: session, run_id: run, seq: (seq += 1), ts });
  return [
    { event: "talk.started", data: { agent, session_id: session } },
    { event: "run.started", data: { ...frame(), user_message: { role: "user", content: message } } },
    { event: "message.started", data: { ...frame(), message: { id: messageId, role: "assistant" } } },
    ...AGENT_REPLY_DELTAS.map((delta): AgentTalkEvent => ({ event: "assistant.delta", data: { ...frame(), message_id: messageId, delta } })),
    { event: "assistant.completed", data: { ...frame(), message_id: messageId, content: AGENT_REPLY_DELTAS.join("") } },
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

/** `&live=token`: the core restarts with a new session token this long after the first connection opens. */
export const STREAM_RESTART_AFTER_MS = 3_000;

/**
 * How the synthetic stream behaves (`&live=`): as the core, refusing every connection, dropping once, one resync, or
 * a core restart that hands out a new session token while another device writes.
 */
export type StreamScript = "ok" | "down" | "drop" | "resync" | "token";

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
  first: "tail" | "missed" | "resync" | "refused" | "denied";
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

/** The synthetic core's public VAPID key: a real P-256 point whose private half was never kept. */
export const SYNTHETIC_PUSH_KEY = "BPkTOtYKP-jDfBYNqtOrQaKFX_KfJI3EtwD82LPKIPadvD4wW3jXqRXfGTDYvnX9VdTs8mJIRKCvV_80hq2OkUc"; // gitleaks:allow (a public key)

/** The push service hosts the core takes an endpoint on (push-client.yaml savePushSubscription). */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

/** A subscription the synthetic push service handed out: an endpoint on a known host and keys of the right sizes. */
class SyntheticSubscription implements PushSubscriptionLike {
  constructor(
    readonly endpoint: string,
    private readonly dropped: (subscription: SyntheticSubscription) => void,
  ) {}

  toJSON(): PushSubscriptionJSON {
    // 65 bytes from 0x04 (an uncompressed P-256 point's length and prefix) and a 16-byte secret.
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) } };
  }

  async unsubscribe(): Promise<boolean> {
    this.dropped(this);
    return true;
  }
}

/**
 * The browser's push service in a synthetic run, where headless Chromium has none: `subscribe` hands out a made-up
 * endpoint on the Google host, and `rotate` stands for the push service changing it.
 */
export class SyntheticPushManager implements PushManagerLike {
  private current: SyntheticSubscription | null = null;
  private next = 1;

  async getSubscription(): Promise<PushSubscriptionLike | null> {
    return this.current;
  }

  async subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike> {
    if (options.applicationServerKey.length !== 65) throw new DOMException("applicationServerKey is not a P-256 public key", "InvalidAccessError");
    this.current ??= this.make();
    return this.current;
  }

  rotate(): void {
    this.current = this.make();
  }

  private make(): SyntheticSubscription {
    return new SyntheticSubscription(`https://fcm.googleapis.com/fcm/send/synthetic-${this.next++}`, (subscription) => {
      if (this.current === subscription) this.current = null;
    });
  }
}

/** The synthetic core's push store, as verify.mjs reads it (`window.__linaPush`). */
export interface SyntheticPush {
  readonly enabled: boolean;
  readonly subscriptions: Map<string, PushSubscriptionRequest>;
  saves: number;
  removes: number;
}

function work(kind: string, id: string): Omit<ChangeEvent, "at"> {
  return { source: "work", kind, id };
}

function fail(status: number, detail: string): WriteResult<never> {
  return { ok: false, status, detail };
}

/** Long enough that a click's 로그인 중 is still on screen when the click returns. */
const SIGN_IN_HOLD_MS = 180;

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
  /** The owner's window on each agent, as its gateway keeps it: the first agent has two earlier turns, the rest none. */
  readonly agentTalks = new Map<string, AgentTalkHistory["messages"]>();
  private readonly connections = new Set<Connection>();
  private readonly script: StreamScript;
  /** `&error=checks`: the hub's checks route does not answer, while every other route still does. */
  private readonly checksError: boolean;
  private streamDown: boolean;
  /** Every connection opened, every snapshot read and every credential renewal, for verify.mjs and the tests. */
  readonly stream: StreamConnection[] = [];
  reads = 0;
  renewals = 0;
  /** The session token the core takes, and the one this page holds; a restart changes the first. */
  private coreToken = 1;
  private pageToken = 1;
  /** `&push=off`: the core has no VAPID key. */
  readonly push: SyntheticPush;
  readonly pushManager = new SyntheticPushManager();
  /** The revision of the settings this page read last: what its If-Match names. */
  private settingsRead: string | null = null;
  /** `&settings=stale`: another device still has to write before this page's first write. */
  private staleNext: boolean;
  /** `&settings=race`: another device still has to write right after this page's first write lands. */
  private raceNext: boolean;
  /** Every settings write this page sent, refused ones too, for verify.mjs and the tests. */
  readonly settingsWrites: { kind: "patch" | "rollback"; ifMatch: string | null; status: number }[] = [];
  /** Restarts and sign-ins this page sent and the core took, for the tests. */
  readonly deviceWrites: { device: string; action: "restart" | "sign-in"; service?: "worker" | "ocx"; runner?: string }[] = [];
  /** Sign-ins taken, waiting for the next devices read to show signingIn. */
  private readonly signIns = new Set<string>();
  /** Sign-ins already shown as signingIn; the devices read after that one shows them signed in. */
  private readonly signInsRunning = new Set<string>();
  /** Sign-ins whose answer has not come back yet. */
  private readonly signing = new Set<string>();

  /** `scene` shares another source's copy, like a second device reading the same core. */
  constructor(options: { seed?: number; now?: number; sourceError?: boolean; checksError?: boolean; noRunning?: boolean; writerStopped?: boolean; endedRuns?: boolean; manyTodos?: boolean; scene?: Scene; talk?: TalkRefusal | null; live?: StreamScript; pushOff?: boolean; settings?: SettingsScript | null; power?: PowerVariant | null } = {}) {
    this.staleNext = options.settings === "stale";
    this.raceNext = options.settings === "race";
    this.talkRefusal = options.talk ?? null;
    this.push = { enabled: !options.pushOff, subscriptions: new Map(), saves: 0, removes: 0 };
    this.script = options.live ?? "ok";
    this.checksError = options.checksError ?? false;
    this.streamDown = this.script === "down";
    this.scene =
      options.scene ??
      generateScene(options.seed ?? SYNTHETIC_SEED, {
        now: Math.floor(options.now ?? nowSeconds()),
        sourceError: options.sourceError,
        checksError: options.checksError,
        noRunning: options.noRunning,
        writerStopped: options.writerStopped,
        endedRuns: options.endedRuns,
        manyTodos: options.manyTodos,
        settings: options.settings === "stale" || options.settings === "race" ? null : options.settings,
        power: options.power,
      });
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const at = nowSeconds();
    this.reads += 1;
    if (this.pageToken !== this.coreToken) return { kind: "failed", offline: false, at, denied: true };
    if (this.checksError && name === "checks") return { kind: "failed", offline: false, at };
    this.deliverReplies(at);
    if (name === "devices") this.applySignIns();
    const body = bodyOf(this.scene, name, id);
    if (body === undefined) return { kind: "missing", at };
    const key = `${name}:${id ?? ""}`;
    const version = versions.get(this.scene) ?? 0;
    if (name === "settings") this.settingsRead = revisionOf(this.scene.settings).id;
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

  /** The owner's own to-do with no goal, as `work add --by <owner>` makes it (lina#693): listed, under 내 할 일, with a work event. */
  async addItem(body: AddItemRequest): Promise<WriteResult<ItemSummary>> {
    const title = body.text.trim();
    if (!title) return fail(400, "text is required");
    if (title.length > 2000) return fail(400, "text must be 1-2000 characters after trimming");
    if (body.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due)) return fail(400, `due must be YYYY-MM-DD, not ${body.due}`);
    const at = Math.floor(nowSeconds());
    const numbers = Object.keys(this.scene.itemDetails).flatMap((key) => (/^T\d+$/.test(key) ? [Number(key.slice(1))] : []));
    const id = `T${Math.max(0, ...numbers) + 1}`;
    const row: ItemSummary = { id, kind: "todo", parent: null, title, agent: null, addedBy: SYNTHETIC_OWNER.id, mine: true, state: "planned", reason: null, stateSince: at, lastActivityAt: at, createdAt: at, closedAt: null, due: body.due, doneCondition: null, area: null, projects: [], todos: null, runCount: 0, commentCount: 0 };
    this.scene.items.items.push(row);
    // The scene's details are read-only to the screens; the synthetic core is the one writer that adds to them.
    Object.assign(this.scene.itemDetails, { [id]: { ...row, why: null, basis: [], children: [], comments: [], runs: [], links: [], workCards: [], decision: null, ownerDone: null } satisfies ItemDetail });
    this.scene.board.inbox.mine.push({ id, title, waiting: false, due: body.due, agent: SYNTHETIC_OWNER.id });
    this.changed(work("created", id));
    return { ok: true, data: structuredClone(row) };
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

  /** A turn in the owner's window on an agent: the same refusals as the core, then the frames on timers. */
  async agentTalk(agent: string, body: TalkRequest, signal?: AbortSignal): Promise<AgentTalkResult> {
    if (!this.scene.items.agents.some((each) => each.id === agent)) return { ok: false, status: 404, code: "unknown_agent" };
    const message = body.message.trim();
    if (!message) return { ok: false, status: 400, code: "empty_message" };
    if (message.length > 4000) return { ok: false, status: 413, code: "message_too_long" };
    if (this.talkRefusal === "busy" || this.talkRefusal === "down") return { ok: false, ...TALK_REFUSED[this.talkRefusal] };
    const at = nowSeconds();
    const frames = syntheticAgentTalkFrames(agent, message, at);
    const kept = this.agentHistory(agent);
    async function* events(): AsyncGenerator<AgentTalkEvent> {
      for (const frame of frames) {
        await wait(TALK_FRAME_MS, signal);
        if (frame.event === "assistant.completed") kept.push({ role: "user", content: `${APP_FIRST_LINE}\n${message}`, timestamp: at }, { role: "assistant", content: frame.data.content, timestamp: nowSeconds() });
        yield frame;
      }
    }
    return { ok: true, events: events() };
  }

  async agentTalkHistory(agent: string): Promise<ReadResult<AgentTalkHistory>> {
    const at = nowSeconds();
    if (!this.scene.items.agents.some((each) => each.id === agent)) return { kind: "missing", at };
    const messages = this.agentHistory(agent);
    return { kind: "data", data: { agent, session_id: messages.length ? `app-${agent}` : null, messages: structuredClone(messages) }, at };
  }

  private agentHistory(agent: string): AgentTalkHistory["messages"] {
    let kept = this.agentTalks.get(agent);
    if (!kept) {
      const day = Math.floor(nowSeconds()) - 86_400;
      kept =
        agent === this.scene.items.agents[0]?.id
          ? [
              { role: "user", content: `${APP_FIRST_LINE}\n어디까지 왔어요?`, timestamp: day },
              { role: "assistant", content: "변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요.", timestamp: day + 60 },
            ]
          : [];
      this.agentTalks.set(agent, kept);
    }
    return kept;
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
        handlers.closed(false);
        return;
      }
      if (this.pageToken !== this.coreToken) {
        connection.closed = true;
        record.first = "denied";
        handlers.closed(true);
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
      if (opening && this.script === "token") setTimeout(() => this.restartCore(), STREAM_RESTART_AFTER_MS);
    });
    return { close: () => this.end(connection, false) };
  }

  /**
   * A worker run says one more thing in its round going now, as the runner's live view does: its record changes and
   * a `worker` change event names the run.
   */
  recordSays(runId: string, text: string): void {
    const round = this.scene.records[runId]?.rounds[0];
    if (!round) return;
    round.rows.push({ at: Math.floor(nowSeconds()), kind: "said", text, count: 1 });
    this.changed({ source: "worker", kind: "progress", id: runId });
  }

  /** Every open connection drops, as on sleep or a network change. */
  dropStreams(): void {
    for (const connection of [...this.connections]) this.end(connection, true);
  }

  /** The next tick of every open connection is one resync, as when a store that was down reads again. */
  resyncStreams(): void {
    for (const connection of this.connections) connection.resync = true;
  }

  /**
   * The core restarts with a new session token: every connection drops, and another device marks the first unread
   * notice read before the page reconnects. Until it renews its credential, the page's reads answer 403 and its
   * connections are refused at the upgrade.
   */
  restartCore(): void {
    this.dropStreams();
    this.coreToken += 1;
    const key = this.scene.board.notices.find((notice) => !notice.read)?.key;
    if (key) void this.readNotices({ keys: [key] });
  }

  /** The page reads the token the core serves now, as from a fresh `/app/`. */
  async renewCredential(): Promise<Renewal> {
    this.renewals += 1;
    if (this.pageToken === this.coreToken) return "same";
    this.pageToken = this.coreToken;
    return "renewed";
  }

  async pushKey(): Promise<ReadResult<PushKey>> {
    const enabled = this.push.enabled;
    return { kind: "data", data: { version: 1, enabled, publicKey: enabled ? SYNTHETIC_PUSH_KEY : null }, at: nowSeconds() };
  }

  /** The core's checks: push set up, an https endpoint on a known push host, a 65-byte key and a 16-byte secret. */
  async savePushSubscription(body: PushSubscriptionRequest): Promise<WriteResult<PushSubscriptionResult>> {
    if (!this.push.enabled) return fail(503, "push is not set up");
    let host = "";
    try {
      const url = new URL(body.endpoint);
      host = url.protocol === "https:" ? url.hostname : "";
    } catch {
      host = "";
    }
    if (!PUSH_HOSTS.some((rule) => rule.test(host))) return fail(400, "endpoint is not a known push service");
    if (base64UrlBytes(body.keys.p256dh).length !== 65 || base64UrlBytes(body.keys.auth).length !== 16) return fail(400, "keys are not a P-256 key and a 16-byte secret");
    const created = !this.push.subscriptions.has(body.endpoint);
    this.push.subscriptions.set(body.endpoint, structuredClone(body));
    this.push.saves += 1;
    const id = [...this.push.subscriptions.keys()].indexOf(body.endpoint) + 1;
    return { ok: true, data: { ok: true, id: id.toString(16).padStart(32, "0"), created } };
  }

  async removePushSubscription(body: PushRemoveRequest): Promise<WriteResult<PushRemoveResult>> {
    this.push.removes += 1;
    return { ok: true, data: { ok: true, removed: this.push.subscriptions.delete(body.endpoint) } };
  }

  /** Restarts worker or OCX on a node. Nothing on the row changes; the next devices read is unchanged. */
  async restartDevice(name: string, service: "worker" | "ocx"): Promise<WriteResult<DeviceAction>> {
    if (service !== "worker" && service !== "ocx") return fail(400, "service는 worker 또는 ocx");
    if (!this.scene.devices.machines.some((item) => item.name === name)) {
      if (this.scene.devices.person.some((item) => item.name === name)) return fail(409, "사람 기기는 다시 시작할 수 없습니다");
      return fail(404, "기기를 찾을 수 없습니다");
    }
    this.deviceWrites.push({ device: name, action: "restart", service });
    return { ok: true, data: { ok: true, device: name, action: "restart", state: "restarted", reason: null } };
  }

  /**
   * Starts sign-in and answers 202 while it is still running, as the core does. The next devices read shows that
   * cell signingIn; the read after that shows it signed in.
   */
  async signInDevice(name: string, runner: string): Promise<WriteResult<DeviceAction>> {
    const machine = this.scene.devices.machines.find((item) => item.name === name);
    if (!machine) {
      if (this.scene.devices.person.some((item) => item.name === name)) return fail(409, "사람 기기는 로그인할 수 없습니다");
      return fail(404, "기기를 찾을 수 없습니다");
    }
    const cell = machine.runners.find((item) => item.name === runner);
    if (!cell) return fail(404, "실행기를 찾을 수 없습니다");
    const key = `${name}\0${runner}`;
    if (this.signing.has(key) || this.signIns.has(key) || this.signInsRunning.has(key) || cell.signingIn) return fail(409, "로그인이 이미 진행 중입니다");
    if (cell.signIn === "signed_in" && !cell.why) return fail(409, "이미 로그인되어 있습니다");
    this.signing.add(key);
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_HOLD_MS));
    this.signing.delete(key);
    this.signIns.add(key);
    this.deviceWrites.push({ device: name, action: "sign-in", runner });
    return { ok: true, data: { ok: true, device: name, action: "sign-in", state: "started", reason: null } };
  }

  /**
   * The next devices read after a sign-in shows signingIn. The read after that one shows the runner signed in.
   * A read with nothing queued leaves the scene alone.
   */
  private applySignIns(): void {
    const cellFor = (key: string) => {
      const [name, runner] = key.split("\0");
      return this.scene.devices.machines.find((item) => item.name === name)?.runners.find((item) => item.name === runner);
    };
    let moved = false;
    for (const key of this.signInsRunning) {
      const cell = cellFor(key);
      if (cell) {
        cell.signingIn = false;
        cell.signIn = "signed_in";
        cell.why = null;
        cell.ready = true;
        moved = true;
      }
    }
    this.signInsRunning.clear();
    for (const key of this.signIns) {
      const cell = cellFor(key);
      if (cell) {
        cell.signingIn = true;
        this.signInsRunning.add(key);
        moved = true;
      }
    }
    this.signIns.clear();
    if (moved) this.changed();
  }

  /** A JSON Merge Patch over the settings, refused like the core: read-only device, stale If-Match, invalid result. */
  async patchSettings(patch: SettingsPatch, revision: string): Promise<WriteResult<SettingsWritten>> {
    if (this.settingsRead !== null && this.settingsRead !== revision) return NOT_THE_READ;
    return this.writeSettings("patch", () => mergePatch(currentSettings(this.scene.settings), patch), { kind: "app", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.device });
  }

  /** The revision before the newest, written again as a new revision; a second rollback undoes the first. */
  async rollbackSettings(revision: string): Promise<WriteResult<SettingsWritten>> {
    if (this.settingsRead !== null && this.settingsRead !== revision) return NOT_THE_READ;
    const { revisions } = this.scene.settings;
    if (revisions.length < 2) return this.settingsRefused("rollback", null, fail(422, "there is no revision to roll back to"));
    return this.writeSettings("rollback", () => revisions[revisions.length - 2], { kind: "rollback", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.device }, revisionOf(this.scene.settings).id);
  }

  /**
   * Another device writes the settings: `devices.workers.<device>.cap` one more, as the owner on SETTINGS_WRITER.other.
   * Every page that read them before now writes against a stale revision.
   */
  settingsWrittenElsewhere(device = "솔방울"): void {
    const cap = currentSettings(this.scene.settings).devices?.workers?.[device]?.cap ?? 1;
    this.settingsPatchedElsewhere({ devices: { workers: { [device]: { cap: cap + 1 } } } });
  }

  /**
   * Another device writes a merge patch over the settings, as the owner on SETTINGS_WRITER.other, checked like a write
   * from this page: the new revision, or the core's one-line reason when it refuses.
   */
  settingsPatchedElsewhere(patch: SettingsPatch): { ok: true; rev: string } | { ok: false; detail: string } {
    const settings = mergePatch(currentSettings(this.scene.settings), patch);
    const errors = validate(settings);
    if (errors.length) return { ok: false, detail: invalidDetail(errors) };
    const line = writeRevision(this.scene.settings, settings, { kind: "app", principal: SETTINGS_WRITER.principal, device: SETTINGS_WRITER.other }, Math.floor(nowSeconds()));
    if (line) this.changed({ source: "settings", kind: "revised", id: line.rev });
    return { ok: true, rev: revisionOf(this.scene.settings).id };
  }

  /**
   * OCX's state of one model changes (quota used up, back, turned off), and the core says so with a settings event,
   * as it does when another device's write changes what the models view warns about.
   */
  modelChangedElsewhere(id: string, changes: Partial<Pick<SettingsModel, "state" | "left" | "resetAt">>): void {
    const model = this.scene.settings.models.find((each) => each.id === id);
    if (!model) return;
    Object.assign(model, changes);
    this.changed({ source: "settings", kind: "revised", id: revisionOf(this.scene.settings).id });
  }

  private writeSettings(kind: "patch" | "rollback", next: () => Settings, by: SettingsAuditLine["by"], rollbackOf?: string): WriteResult<SettingsWritten> {
    const ifMatch = this.settingsRead;
    if (!this.scene.settings.writable) return this.settingsRefused(kind, ifMatch, fail(403, "only the owner on an owner device writes the settings"));
    if (this.staleNext) {
      this.staleNext = false;
      this.settingsWrittenElsewhere();
    }
    const now = revisionOf(this.scene.settings).id;
    if (ifMatch === null) return this.settingsRefused(kind, ifMatch, fail(428, "If-Match is required: read the settings first"));
    if (ifMatch !== now) return this.settingsRefused(kind, ifMatch, fail(412, `the settings changed since you read them (now ${now}): read again`));
    const settings = next();
    const errors = validate(settings);
    if (errors.length) return this.settingsRefused(kind, ifMatch, fail(422, invalidDetail(errors)));
    const line = writeRevision(this.scene.settings, settings, by, Math.floor(nowSeconds()), rollbackOf);
    this.settingsWrites.push({ kind, ifMatch, status: 200 });
    if (line) this.changed({ source: "settings", kind: rollbackOf ? "rolled_back" : "revised", id: line.rev });
    const written: WriteResult<SettingsWritten> = { ok: true, data: { ok: true, changes: line?.changes ?? [], revision: revisionOf(this.scene.settings) } };
    if (this.raceNext) {
      this.raceNext = false;
      this.settingsWrittenElsewhere();
    }
    return written;
  }

  private settingsRefused(kind: "patch" | "rollback", ifMatch: string | null, result: WriteResult<never>): WriteResult<never> {
    this.settingsWrites.push({ kind, ifMatch, status: result.ok ? 200 : result.status });
    return result;
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
    if (notify && wasOpen) connection.handlers.closed(false);
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
