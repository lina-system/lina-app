import { routePath, type RouteName, type Routes } from "../api/client";
import { nowSeconds, type ReadResult, type Source } from "./source";

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
}
