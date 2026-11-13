// The app's service worker: every request goes to the network, and the core's Web Push messages (lina#244,
// openapi/push-client.yaml PushMessage) show and close notifications. One notification per item: its tag is the
// item's key, so a later message for the same item replaces it, and a `close` message takes it away.

// A copy of PUSH_LINE in src/words.ts; src/sw.test.ts holds the two equal.
const PUSH_LINE = { ask: "결정 필요", reply: "답글", blocked: "중단됨 · 피드백 대기", question: "중단됨 · 피드백 대기" };

// A copy of foldReason in src/model/fold.ts (src/sw.test.ts runs both on the same sentences): a sentence that shows a
// path, a command, a hash, an issue number, an address, a cut-off fragment or an English word is not shown.
const ALLOWED_LATIN = new Set(["LINA", "Honcho", "GitHub", "macOS", "iPhone", "Telegram", "Codex"]);
const FOLD_RULES = [
  /https?:|www\./i,
  /(?<![0-9A-Za-z])(?:[\w.-]+\/[\w.-]+)?#\d+/,
  /\b[0-9a-f]{7,40}\b/,
  /[\w-]\.[A-Za-z][A-Za-z0-9]{0,4}\b|[\w.-]+\/[\w.-]+|(?:^|[\s(])(?:~|\.{1,2})?\/[\w.-]|\\[\w.-]/,
  /`|(?:^|\s)--?[A-Za-z]|(?:^|\s)\$\s|\s(?:\||&&|>>?|<)\s/,
  /(?:…|\.\.\.)\s*$/,
];

function readable(text) {
  const body = String(text || "").trim();
  if (!body || FOLD_RULES.some((rule) => rule.test(body))) return false;
  const latin = (body.match(/[A-Za-z][A-Za-z0-9]*/g) || []).filter((word) => (word.match(/[A-Za-z]/g) || []).length >= 3 && !ALLOWED_LATIN.has(word));
  return latin.length === 0;
}

// The same screens the bell opens: a decision in 수신함, a reply on its goal or to-do, a stopped card on its page.
function routeOf(kind, target) {
  if (kind === "ask") return "#/inbox";
  if (kind === "reply") return `#/items/${encodeURIComponent(target)}`;
  return `#/cards/${encodeURIComponent(target)}`;
}

function notificationOf(message) {
  const line = PUSH_LINE[message.kind] || "";
  return {
    title: readable(message.title) ? message.title : "LINA",
    options: {
      tag: message.tag,
      body: readable(message.body) ? `${line}\n${message.body}` : line,
      lang: "ko",
      icon: new URL("icons/icon-192.png", self.registration.scope).href,
      timestamp: message.at ? message.at * 1000 : undefined,
      data: { kind: message.kind, target: message.target },
    },
  };
}

async function onPush(data) {
  let message = null;
  try {
    message = data ? data.json() : null;
  } catch (error) {
    console.error("push: the message is not JSON", error);
    return;
  }
  if (!message || message.v !== 1 || typeof message.tag !== "string") {
    console.error("push: not a PushMessage", message);
    return;
  }
  if (message.type === "show") {
    const { title, options } = notificationOf(message);
    await self.registration.showNotification(title, options);
    return;
  }
  // close: a tag with nothing open on this device (already dismissed, or never shown here) shows nothing.
  if (message.type === "close") for (const open of await self.registration.getNotifications({ tag: message.tag })) open.close();
}

// The app's open window goes to the item (focused, so the screen comes forward). The message carries the notification's
// tag, so that page can read-mark a reply. With no window open, a new one opens on the item and the tag rides in the
// address (`?open=<tag>` before the hash). A browser may stop the worker before the page loads, so the tag cannot
// live in a worker global; the page reads it once on start. An existing query on the scope, such as `source=synthetic`, stays.
function openAddress(scope, hash, tag) {
  const url = new URL(scope);
  if (tag) url.searchParams.set("open", tag);
  url.hash = hash;
  return url.href;
}

async function openItem(notification) {
  const data = notification && notification.data;
  const kind = data && data.kind;
  const target = (data && data.target) || "";
  const tag = (notification && notification.tag) || "";
  const hash = routeOf(kind, target);
  const message = { type: "lina-open", kind, target, hash, tag };
  const scope = self.registration.scope;
  const windows = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((client) => client.url.startsWith(scope));
  const app = windows.find((client) => client.focused) || windows[0];
  if (app) {
    app.postMessage(message);
    await app.focus();
    return;
  }
  await self.clients.openWindow(openAddress(scope, hash, tag));
}

async function closeMatching(tags, prefixes) {
  for (const open of await self.registration.getNotifications()) {
    if (tags.includes(open.tag) || prefixes.some((prefix) => open.tag.startsWith(prefix))) open.close();
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  event.waitUntil(onPush(event.data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openItem(event.notification));
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "lina-close") event.waitUntil(closeMatching(data.tags || [], data.prefixes || []));
});
