import type { PushSubscriptionRequest } from "./api/client";
import type { Source } from "./data/source";
import { isStandalone } from "./swipe-back";
import { W } from "./words";

export interface PushSubscriptionLike {
  readonly endpoint: string;
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<PushSubscriptionLike>;
}

/** Which of this device's notifications to close: exact tags, or every tag that starts with one of the prefixes. */
export interface CloseMatch {
  readonly tags?: readonly string[];
  readonly prefixes?: readonly string[];
}

/** What the service worker asks an open window to show when a notification is chosen (public/sw.js). */
export interface OpenRequest {
  readonly kind: string;
  readonly target: string;
  readonly hash: string;
}

/** The browser around push: the platform, the permission, the push manager and the service worker. */
export interface PushHost {
  /** iPhone or iPad, where Web Push reaches only a web app opened from the Home Screen. */
  readonly ios: boolean;
  standalone(): boolean;
  /** null when this browser has no Notification API. */
  permission(): NotificationPermission | null;
  requestPermission(): Promise<NotificationPermission>;
  /** The push manager, or null when this browser cannot subscribe. */
  manager(): Promise<PushManagerLike | null>;
  /** Asks the service worker to close this device's notifications that match. */
  close(match: CloseMatch): void;
  onOpen(listener: (open: OpenRequest) => void): () => void;
}

type Host = Pick<Window, "matchMedia"> & { navigator: Navigator & { standalone?: boolean }; Notification?: typeof Notification; PushManager?: unknown };

function onIos(navigator: Navigator): boolean {
  // iPadOS reports itself as a Mac; a Mac has no touch points.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * The page's own browser. The service worker registers only in a production build, so a dev server has no push
 * manager and closes nothing. `manager` replaces the browser's push manager (the synthetic scene: headless Chromium
 * has no push service).
 */
export function browserPushHost(host: Host = window as unknown as Host, manager?: PushManagerLike): PushHost {
  const worker = host.navigator.serviceWorker as ServiceWorkerContainer | undefined;
  const production = import.meta.env.PROD;
  return {
    ios: onIos(host.navigator),
    standalone: () => isStandalone(host),
    permission: () => (typeof host.Notification === "function" ? host.Notification.permission : null),
    requestPermission: () => (host.Notification ? host.Notification.requestPermission() : Promise.resolve("denied")),
    async manager() {
      if (!worker || !("PushManager" in host)) return null;
      if (manager) return manager;
      return production ? (await worker.ready).pushManager : null;
    },
    close(match) {
      if (!worker || !production) return;
      void worker.ready.then((registration) => registration.active?.postMessage({ type: "lina-close", tags: [...(match.tags ?? [])], prefixes: [...(match.prefixes ?? [])] }));
    },
    onOpen(listener) {
      if (!worker) return () => {};
      const receive = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } & Partial<OpenRequest>;
        if (data?.type === "lina-open" && typeof data.hash === "string") listener({ kind: String(data.kind ?? ""), target: String(data.target ?? ""), hash: data.hash });
      };
      worker.addEventListener("message", receive);
      return () => worker.removeEventListener("message", receive);
    },
  };
}

export function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The core's SubscriptionRequest from the browser's subscription; null when it carries no keys. */
export function subscriptionBody(subscription: PushSubscriptionLike): PushSubscriptionRequest | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } };
}

/**
 * The 알림 받기 row's state: still reading, the core's key unread, push off in the core, not on the Home Screen
 * (iOS), a browser without Web Push, notifications blocked in the browser, ready to turn on, or on.
 */
export type PushState = "loading" | "unknown" | "off" | "home" | "unsupported" | "blocked" | "ready" | "on";

/**
 * This device's push subscription. Permission is asked only by `turnOn`, from the row; `start` (once per visit)
 * never asks. A subscription the browser already holds is sent to the core again on every visit, so an endpoint the
 * push service changed reaches the core; the core keeps one per endpoint, so an unchanged one is only refreshed.
 */
export class Push {
  state: PushState = "loading";
  busy = false;
  error: string | null = null;
  private key: string | null = null;
  private subscription: PushSubscriptionLike | null = null;

  constructor(
    private readonly source: Source,
    private readonly host: PushHost,
    private readonly onChange: () => void,
  ) {}

  private set(state: PushState, error: string | null = null): void {
    this.state = state;
    this.error = error;
    this.busy = false;
    this.onChange();
  }

  async start(): Promise<void> {
    if (this.host.ios && !this.host.standalone()) return this.set("home");
    const key = await this.source.pushKey();
    if (key.kind === "missing") return this.set("off");
    if (key.kind !== "data") return this.set("unknown");
    if (!key.data.enabled || !key.data.publicKey) return this.set("off");
    this.key = key.data.publicKey;
    const manager = await this.host.manager();
    const permission = this.host.permission();
    if (!manager || permission === null) return this.set("unsupported");
    if (permission === "denied") return this.set("blocked");
    const current = permission === "granted" ? await manager.getSubscription() : null;
    const body = current ? subscriptionBody(current) : null;
    if (!current || !body) return this.set("ready");
    const saved = await this.source.savePushSubscription(body);
    if (!saved.ok && saved.status === 503) return this.set("off");
    // Not taken this time (no answer, too many writes): the core still has it from an earlier visit, or gets it next time.
    this.subscription = current;
    this.set("on");
  }

  async turnOn(): Promise<void> {
    if (this.busy || this.state !== "ready" || !this.key) return;
    this.busy = true;
    this.error = null;
    this.onChange();
    let permission = this.host.permission();
    if (permission === "default") permission = await this.host.requestPermission();
    if (permission === "denied") return this.set("blocked");
    if (permission !== "granted") return this.set("ready");
    const manager = await this.host.manager();
    if (!manager) return this.set("unsupported");
    let subscription: PushSubscriptionLike;
    try {
      subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(this.key) });
    } catch (error) {
      console.warn("push: subscribe failed", error);
      return this.set("ready", W.pushOnFailed);
    }
    const body = subscriptionBody(subscription);
    const saved = body ? await this.source.savePushSubscription(body) : null;
    if (!saved?.ok) {
      await subscription.unsubscribe();
      return saved?.status === 503 ? this.set("off") : this.set("ready", W.pushOnFailed);
    }
    this.subscription = subscription;
    this.set("on");
  }

  /** Removes this device in the core first; only then does the browser drop the subscription. */
  async turnOff(): Promise<void> {
    const subscription = this.subscription;
    if (this.busy || this.state !== "on" || !subscription) return;
    this.busy = true;
    this.error = null;
    this.onChange();
    const removed = await this.source.removePushSubscription({ endpoint: subscription.endpoint });
    if (!removed.ok) return this.set("on", W.pushOffFailed);
    await subscription.unsubscribe();
    this.subscription = null;
    this.set("ready");
  }
}
