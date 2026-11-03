import { cardAnswerPath, NOTICES_READ_PATH, routePath, talkPath, writePath, type ActionResult, type AnswerRequest, type AnswerResult, type CommentRequest, type DoneRequest, type NoticesReadRequest, type NoticesReadResult, type RouteName, type Routes, type TalkEvent, type TalkRequest } from "../api/client";
import { nowSeconds, type ReadResult, type Source, type TalkResult, type WriteResult } from "./source";
import { readSse } from "./sse";

/** Each frame's JSON `data` with its `event` name; a frame whose data is not JSON ends the turn as failed. */
export async function* talkEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<TalkEvent> {
  for await (const frame of readSse(body)) {
    yield { event: frame.event, data: JSON.parse(frame.data) } as TalkEvent;
  }
}

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __HERMES_AUTH_REQUIRED__?: boolean;
    __HERMES_BASE_PATH__?: string;
  }
}

export interface HttpOptions {
  readonly fetch?: typeof fetch;
  /** Prefix before `/api/...`; the core's bootstrap sets `__HERMES_BASE_PATH__`. */
  readonly basePath?: string;
  readonly token?: string | null;
}

export function bootstrapOptions(host: Partial<Window> = window): HttpOptions {
  const basePath = typeof host.__HERMES_BASE_PATH__ === "string" ? host.__HERMES_BASE_PATH__ : "";
  const token = typeof host.__HERMES_SESSION_TOKEN__ === "string" && host.__HERMES_SESSION_TOKEN__ ? host.__HERMES_SESSION_TOKEN__ : null;
  return { basePath, token };
}

/** Reads the core's client API on the page's own origin, with the session token and ETags. */
export class HttpSource implements Source {
  private readonly etags = new Map<string, string>();
  private readonly fetchImpl: typeof fetch;
  private readonly basePath: string;
  private readonly token: string | null;

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.basePath = (options.basePath ?? "").replace(/\/+$/, "");
    this.token = options.token ?? null;
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const url = `${this.basePath}${routePath(name, id)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["X-Hermes-Session-Token"] = this.token;
    const etag = this.etags.get(url);
    if (etag) headers["If-None-Match"] = etag;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers, credentials: "same-origin" });
    } catch {
      return { kind: "failed", offline: true, at: nowSeconds() };
    }
    const at = nowSeconds();
    if (response.status === 304) return { kind: "unchanged", at };
    if (response.status === 404) return { kind: "missing", at };
    if (!response.ok) return { kind: "failed", offline: false, at };
    try {
      const data = (await response.json()) as Routes[N];
      const tag = response.headers.get("ETag");
      if (tag) this.etags.set(url, tag);
      return { kind: "data", data, at };
    } catch {
      return { kind: "failed", offline: false, at };
    }
  }

  comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>> {
    return this.post(writePath("comments", id), body);
  }

  done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>> {
    return this.post(writePath("done", id), body);
  }

  undo(id: string): Promise<WriteResult<ActionResult>> {
    return this.post(writePath("undo", id), {});
  }

  retry(id: string): Promise<WriteResult<ActionResult>> {
    return this.post(writePath("retry", id), {});
  }

  answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>> {
    return this.post(cardAnswerPath(cardId), body);
  }

  readNotices(body: NoticesReadRequest): Promise<WriteResult<NoticesReadResult>> {
    return this.post(NOTICES_READ_PATH, body);
  }

  /** POST, not EventSource: the reply is read off the fetch body as it streams. */
  async talk(id: string, body: TalkRequest, signal?: AbortSignal): Promise<TalkResult> {
    const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json" };
    if (this.token) headers["X-Hermes-Session-Token"] = this.token;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.basePath}${talkPath(id)}`, { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin", signal });
    } catch {
      return { ok: false, status: 0, code: null };
    }
    if (response.ok && response.body) return { ok: true, events: talkEvents(response.body) };
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const error = typeof json === "object" && json !== null ? (json as { error?: { code?: unknown } }).error : undefined;
    return { ok: false, status: response.ok ? 0 : response.status, code: typeof error?.code === "string" ? error.code : null };
  }

  /** One write: JSON body, the session token like the reads, and `keepalive` so a write sent as the page goes still lands. */
  private async post<T>(path: string, body: unknown): Promise<WriteResult<T>> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (this.token) headers["X-Hermes-Session-Token"] = this.token;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.basePath}${path}`, { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin", keepalive: true });
    } catch {
      return { ok: false, status: 0, detail: null };
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok && json !== null) return { ok: true, data: json as T };
    const detail = typeof json === "object" && json !== null && typeof (json as { detail?: unknown }).detail === "string" ? (json as { detail: string }).detail : null;
    return { ok: false, status: response.ok ? 0 : response.status, detail };
  }
}
