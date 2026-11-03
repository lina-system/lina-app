import type { ActionResult, AnswerRequest, AnswerResult, CommentRequest, DoneRequest, NoticesReadRequest, NoticesReadResult, RouteName, Routes, TalkEvent, TalkRequest } from "../api/client";

export type ReadResult<T> =
  | { readonly kind: "data"; readonly data: T; readonly at: number }
  | { readonly kind: "unchanged"; readonly at: number }
  | { readonly kind: "missing"; readonly at: number }
  | { readonly kind: "failed"; readonly offline: boolean; readonly at: number };

/** A write's answer: the core's result, or its status with the one-line `detail` of a 4xx (status 0: no answer). */
export type WriteResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly status: number; readonly detail: string | null };

/**
 * A talk turn's answer: its streamed events, or the status it was refused with and the `error.code` of a JSON body
 * (status 0: no answer). 429 and 503 can carry the gateway's own body, so `code` may be null.
 */
export type TalkResult = { readonly ok: true; readonly events: AsyncIterable<TalkEvent> } | { readonly ok: false; readonly status: number; readonly code: string | null };

/** Where the screens' data comes from, and where the owner's writes go: the core over HTTP, or the synthetic scene. */
export interface Source {
  read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>>;
  comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>>;
  done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>>;
  undo(id: string): Promise<WriteResult<ActionResult>>;
  retry(id: string): Promise<WriteResult<ActionResult>>;
  answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>>;
  /** Read marks are the core's, per owner: every device sees the same ones after its next read. */
  readNotices(body: NoticesReadRequest): Promise<WriteResult<NoticesReadResult>>;
  /** One turn with the agent that owns the item, in that agent's app conversation; `signal` stops reading the reply. */
  talk(id: string, body: TalkRequest, signal?: AbortSignal): Promise<TalkResult>;
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}
