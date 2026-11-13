import type { ActionResult, AddItemRequest, AgentTalkEvent, AgentTalkHistory, AnswerRequest, ChangeMessage, AnswerResult, CommentRequest, DeviceAction, DoneRequest, NoticesReadRequest, NoticesReadResult, PushKey, PushRemoveRequest, PushRemoveResult, PushSubscriptionRequest, PushSubscriptionResult, ItemSummary, RouteName, Routes, SettingsPatch, SettingsWritten, TalkEvent, TalkRequest } from "../api/client";

export type ReadResult<T> =
  | { readonly kind: "data"; readonly data: T; readonly at: number }
  | { readonly kind: "unchanged"; readonly at: number }
  | { readonly kind: "missing"; readonly at: number }
  | { readonly kind: "failed"; readonly offline: boolean; readonly at: number; readonly denied?: boolean };

/** A write's answer: the core's result, or its status with the one-line `detail` of a 4xx (status 0: no answer). */
export type WriteResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly status: number; readonly detail: string | null };

/**
 * A talk turn's answer: its streamed events, or the status it was refused with and the `error.code` of a JSON body
 * (status 0: no answer). 429 and 503 can carry the gateway's own body, so `code` may be null.
 */
export type TalkResult<E = TalkEvent> = { readonly ok: true; readonly events: AsyncIterable<E> } | { readonly ok: false; readonly status: number; readonly code: string | null };

/** A turn in the owner's own window on one agent (lina#482): refused as a to-do's turn is, with no item. */
export type AgentTalkResult = TalkResult<AgentTalkEvent>;

/**
 * What one change stream connection tells its opener. `closed` comes once, when the connection ends or never opens;
 * `refused` when the core turned it away at the upgrade (closed before it opened, or an auth close code), which is
 * what a credential the core no longer takes looks like.
 */
export interface ChangeHandlers {
  message(message: ChangeMessage): void;
  closed(refused: boolean): void;
}

/**
 * What asking the core again for the page's credential gave: a new one, the same one, no answer, no credential in
 * the page (`none`), or nothing asked because the page signs in with a cookie (`gated`).
 */
export type Renewal = "renewed" | "same" | "unreachable" | "none" | "gated";

/** One open change stream connection; `close` ends it without calling `closed`. */
export interface ChangeSocket {
  close(): void;
}

/** Where the screens' data comes from, and where the owner's writes go: the core over HTTP, or the synthetic scene. */
export interface Source {
  read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>>;
  comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>>;
  done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>>;
  undo(id: string): Promise<WriteResult<ActionResult>>;
  retry(id: string): Promise<WriteResult<ActionResult>>;
  /** One owner's to-do in the record, answered as its `/work/items` row (lina#693). */
  addItem(body: AddItemRequest): Promise<WriteResult<ItemSummary>>;
  answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>>;
  /** Read marks are the core's, per owner: every device sees the same ones after its next read. */
  readNotices(body: NoticesReadRequest): Promise<WriteResult<NoticesReadResult>>;
  /** One turn with the agent that owns the item, in that agent's app conversation; `signal` stops reading the reply. */
  talk(id: string, body: TalkRequest, signal?: AbortSignal): Promise<TalkResult>;
  /** One turn in the owner's own app window on `agent` (not its messenger chat); `signal` stops reading the reply. */
  agentTalk(agent: string, body: TalkRequest, signal?: AbortSignal): Promise<AgentTalkResult>;
  /** The earlier turns of that window, oldest first. */
  agentTalkHistory(agent: string): Promise<ReadResult<AgentTalkHistory>>;
  /** One connection to the core's change stream, resuming after `since` (null: from the tail). */
  changes(since: string | null, handlers: ChangeHandlers): ChangeSocket;
  /** Reads the credential the core serves the page now, after it refused the one the page started with. */
  renewCredential(): Promise<Renewal>;
  /** Whether the core sends Web Push, and the public key to subscribe with. */
  pushKey(): Promise<ReadResult<PushKey>>;
  /** Adds or refreshes this device's push subscription in the core (one per endpoint). */
  savePushSubscription(body: PushSubscriptionRequest): Promise<WriteResult<PushSubscriptionResult>>;
  removePushSubscription(body: PushRemoveRequest): Promise<WriteResult<PushRemoveResult>>;
  /**
   * Changes the work settings with a JSON Merge Patch drawn over revision `revision`, If-Match the settings this source
   * read last: 412 when they changed since (or the read last is not `revision`: then nothing is sent), 422 with the
   * core's one-line `detail` when the result would not be valid.
   */
  patchSettings(patch: SettingsPatch, revision: string): Promise<WriteResult<SettingsWritten>>;
  /** Writes the revision before the newest as a new one, asked of revision `revision`, like patchSettings. */
  rollbackSettings(revision: string): Promise<WriteResult<SettingsWritten>>;
  /** Restarts one service on a node (lina#234). 200 shows nothing new; a refusal is one `detail` line. */
  restartDevice(name: string, service: "worker" | "ocx"): Promise<WriteResult<DeviceAction>>;
  /** Starts sign-in for one runner on a node (lina#234). 202 means it started; the next devices read says whether it took. */
  signInDevice(name: string, runner: string): Promise<WriteResult<DeviceAction>>;
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}
