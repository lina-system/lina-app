import type { ActionResult, AnswerRequest, AnswerResult, CommentRequest, DoneRequest, RouteName, Routes } from "../api/client";

export type ReadResult<T> =
  | { readonly kind: "data"; readonly data: T; readonly at: number }
  | { readonly kind: "unchanged"; readonly at: number }
  | { readonly kind: "missing"; readonly at: number }
  | { readonly kind: "failed"; readonly offline: boolean; readonly at: number };

/** A write's answer: the core's result, or its status with the one-line `detail` of a 4xx (status 0: no answer). */
export type WriteResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly status: number; readonly detail: string | null };

/** Where the screens' data comes from, and where the owner's writes go: the core over HTTP, or the synthetic scene. */
export interface Source {
  read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>>;
  comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>>;
  done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>>;
  undo(id: string): Promise<WriteResult<ActionResult>>;
  retry(id: string): Promise<WriteResult<ActionResult>>;
  answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>>;
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}
