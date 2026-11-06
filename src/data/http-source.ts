import { BOARD_BASE, cardAnswerPath, EVENTS_PATH, NOTICES_READ_PATH, PUSH_KEY_PATH, PUSH_REMOVE_PATH, PUSH_SUBSCRIPTIONS_PATH, routePath, SETTINGS_PATH, SETTINGS_ROLLBACK_PATH, talkPath, writePath, type ActionResult, type AnswerRequest, type AnswerResult, type ChangeMessage, type CommentRequest, type DeviceAction, type DoneRequest, type NoticesReadRequest, type NoticesReadResult, type PushKey, type PushRemoveRequest, type PushRemoveResult, type PushSubscriptionRequest, type PushSubscriptionResult, type RouteName, type Routes, type SettingsPatch, type SettingsWritten, type TalkEvent, type TalkRequest } from "../api/client";
import { nowSeconds, type ChangeHandlers, type ChangeSocket, type ReadResult, type Renewal, type Source, type TalkResult, type WriteResult } from "./source";
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
  /** The change stream's socket; the browser's WebSocket by default. */
  readonly webSocket?: new (url: string) => WebSocket;
  /** The page's address, for the socket's origin. */
  readonly location?: Pick<Location, "href">;
}

/** The change stream's address on the page's own origin: ws(s), the base path, `?token=` and `since`. */
export function eventsUrl(href: string, basePath: string, token: string | null, since: string | null): string {
  const url = new URL(`${basePath}${EVENTS_PATH}`, href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  if (token) url.searchParams.set("token", token);
  if (since) url.searchParams.set("since", since);
  return url.toString();
}

/** Close codes the dashboard's sockets use to turn a credential away (policy violation, the auth gate's 4401 and 4403). */
const REFUSED_CODES: ReadonlySet<number> = new Set([1008, 4401, 4403]);

/** A settings write drawn over another revision than the one read last: stale, and not sent. */
const NOT_THE_READ: WriteResult<never> = { ok: false, status: 412, detail: null };

/** The session token the core's bootstrap script sets on the page (`window.__HERMES_SESSION_TOKEN__="…"`), if any. */
export function tokenInPage(html: string): string | null {
  const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"\\<]+)"/.exec(html);
  return match ? match[1] : null;
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
  /** The page's session token; a core that restarted serves a new one, read again by renewCredential. */
  private token: string | null;
  /** No token in the page: the gated mode, where a cookie signs the page in and a 401 means signed out. */
  private readonly gated: boolean;
  private readonly webSocket: (url: string) => WebSocket;
  private readonly href: () => string;

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.basePath = (options.basePath ?? "").replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.gated = this.token === null;
    const Socket = options.webSocket;
    this.webSocket = Socket ? (url) => new Socket(url) : (url) => new WebSocket(url);
    this.href = () => (options.location ?? window.location).href;
  }

  /**
   * One WebSocket to `/api/lina/events`. A message that is not JSON, an error or a close ends it: `closed` comes
   * once, and the caller decides when to connect again.
   */
  changes(since: string | null, handlers: ChangeHandlers): ChangeSocket {
    let ended = false;
    let opened = false;
    const end = (refused: boolean) => {
      if (ended) return;
      ended = true;
      handlers.closed(refused);
    };
    let socket: WebSocket;
    try {
      socket = this.webSocket(eventsUrl(this.href(), this.basePath, this.token, since));
    } catch {
      queueMicrotask(() => end(false));
      return { close: () => void (ended = true) };
    }
    socket.onopen = () => {
      opened = true;
    };
    socket.onmessage = (event: MessageEvent) => {
      if (ended) return;
      let message: ChangeMessage;
      try {
        message = JSON.parse(String(event.data)) as ChangeMessage;
      } catch {
        socket.close();
        end(false);
        return;
      }
      handlers.message(message);
    };
    // An error is always followed by a close, which carries the code; a refused upgrade never opened.
    socket.onerror = () => socket.close();
    socket.onclose = (event: CloseEvent) => end(!opened || REFUSED_CODES.has(event.code));
    return {
      close: () => {
        ended = true;
        socket.close();
      },
    };
  }

  read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    return this.get(`${this.basePath}${routePath(name, id)}`);
  }

  pushKey(): Promise<ReadResult<PushKey>> {
    return this.get(`${this.basePath}${PUSH_KEY_PATH}`);
  }

  savePushSubscription(body: PushSubscriptionRequest): Promise<WriteResult<PushSubscriptionResult>> {
    return this.post(PUSH_SUBSCRIPTIONS_PATH, body);
  }

  removePushSubscription(body: PushRemoveRequest): Promise<WriteResult<PushRemoveResult>> {
    return this.post(PUSH_REMOVE_PATH, body);
  }

  /** One GET with the session token and the ETag the last answer for this address carried. */
  private async get<T>(url: string): Promise<ReadResult<T>> {
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
    if (response.status === 401 || response.status === 403) return { kind: "failed", offline: false, at, denied: true };
    if (!response.ok) return { kind: "failed", offline: false, at };
    try {
      const data = (await response.json()) as T;
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

  /**
   * The page's own address once more (`<base>/app/`, never cached), for the token its bootstrap script carries now.
   * A page signed in by cookie has no token to renew and asks nothing. The token lives in this object only.
   */
  async renewCredential(): Promise<Renewal> {
    if (this.gated) return "gated";
    let html: string;
    try {
      const response = await this.fetchImpl(`${this.basePath}/app/`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!response.ok) return "unreachable";
      html = await response.text();
    } catch {
      return "unreachable";
    }
    const token = tokenInPage(html);
    if (!token) return "none";
    if (token === this.token) return "same";
    this.token = token;
    return "renewed";
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

  /**
   * The ETag of the settings this page read last goes back as If-Match. It stays the read's own: after a write the
   * next read must answer with the new settings, not 304 against the write's tag.
   */
  patchSettings(patch: SettingsPatch, revision: string): Promise<WriteResult<SettingsWritten>> {
    const ifMatch = this.settingsTag(revision);
    if (ifMatch === null) return Promise.resolve(NOT_THE_READ);
    return this.post(SETTINGS_PATH, patch, { method: "PATCH", contentType: "application/merge-patch+json", ifMatch });
  }

  rollbackSettings(revision: string): Promise<WriteResult<SettingsWritten>> {
    const ifMatch = this.settingsTag(revision);
    if (ifMatch === null) return Promise.resolve(NOT_THE_READ);
    return this.post(SETTINGS_ROLLBACK_PATH, undefined, { ifMatch });
  }

  restartDevice(name: string, service: "worker" | "ocx"): Promise<WriteResult<DeviceAction>> {
    return this.post(`${BOARD_BASE}/devices/${encodeURIComponent(name)}/restart`, { service });
  }

  signInDevice(name: string, runner: string): Promise<WriteResult<DeviceAction>> {
    return this.post(`${BOARD_BASE}/devices/${encodeURIComponent(name)}/sign-in`, { runner });
  }

  /**
   * The read's ETag when it is revision `revision`'s (`"r<n>-<hash>"`), null when it names another one: a read that
   * landed since the change was drawn must not carry it. A tag of another form goes as it is, for the core to judge.
   */
  private settingsTag(revision: string): string | undefined | null {
    const tag = this.etags.get(`${this.basePath}${SETTINGS_PATH}`);
    const named = tag?.match(/^(?:W\/)?"(r\d+)-/)?.[1];
    return named === undefined || named === revision ? tag : null;
  }

  /** One write: JSON body, the session token like the reads, and `keepalive` so a write sent as the page goes still lands. */
  private async post<T>(path: string, body: unknown, options: { method?: "POST" | "PATCH"; contentType?: string; ifMatch?: string } = {}): Promise<WriteResult<T>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = options.contentType ?? "application/json";
    if (this.token) headers["X-Hermes-Session-Token"] = this.token;
    if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.basePath}${path}`, { method: options.method ?? "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", keepalive: true });
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
