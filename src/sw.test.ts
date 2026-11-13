import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import type { PushMessage, PushShowMessage } from "./api/client";
import { foldReason } from "./model/fold";
import { PUSH_LINE } from "./words";

const SCOPE = "https://hub.example/app/";

interface Shown {
  readonly title: string;
  readonly tag: string;
  readonly body: string;
  readonly data: { kind: string; target: string };
  close(): void;
}

/**
 * public/sw.js in a service worker scope of its own: notifications kept the way a browser keeps them (one per tag, a
 * new one with the same tag replaces it), and the windows the worker can see.
 */
function worker(windows: { url: string; focused: boolean }[] = [], scope = SCOPE) {
  const listeners = new Map<string, (event: object) => void>();
  let shown: Shown[] = [];
  const opened: string[] = [];
  const posted: unknown[] = [];
  const focused: string[] = [];
  let shows = 0;
  const registration = {
    scope,
    async showNotification(title: string, options: { tag: string; body: string; data: Shown["data"] }) {
      shows += 1;
      const note: Shown = { title, tag: options.tag, body: options.body, data: options.data, close: () => (shown = shown.filter((each) => each !== note)) };
      shown = [...shown.filter((each) => each.tag !== options.tag), note];
    },
    async getNotifications(filter?: { tag?: string }) {
      return shown.filter((note) => !filter?.tag || note.tag === filter.tag);
    },
  };
  const clients = {
    async matchAll() {
      return windows.map((each) => ({ ...each, postMessage: (message: unknown) => posted.push(message), focus: async () => focused.push(each.url) }));
    },
    async openWindow(url: string) {
      opened.push(url);
      return null;
    },
    async claim() {},
  };
  const self = { registration, clients, skipWaiting() {}, addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener) };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, console, fetch });
  const dispatch = async (type: string, event: object) => {
    let waiting: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => (waiting = promise) });
    await waiting;
  };
  return {
    push: (message: PushMessage | string) => dispatch("push", { data: { json: () => (typeof message === "string" ? JSON.parse(message) : message) } }),
    click: (note: Shown) => dispatch("notificationclick", { notification: note }),
    message: (data: unknown) => dispatch("message", { data, source: { postMessage: (message: unknown) => posted.push(message) } }),
    shown: () => shown,
    shows: () => shows,
    opened,
    posted,
    focused,
  };
}

function show(overrides: Partial<PushShowMessage> = {}): PushShowMessage {
  return { v: 1, type: "show", tag: "ask:T2:1700000000", kind: "ask", target: "T2", at: 1700000000, title: "배포 순서 정하기", body: "오늘 저녁에 배포할까요?", ...overrides };
}

describe("the service worker's push messages", () => {
  test("show draws the item's title, its kind line and a readable body, tagged with the item's key", async () => {
    const sw = worker();
    await sw.push(show());
    expect(sw.shown()).toMatchObject([{ title: "배포 순서 정하기", tag: "ask:T2:1700000000", body: "결정 필요\n오늘 저녁에 배포할까요?", data: { kind: "ask", target: "T2" } }]);
  });

  test("a later message for the same item replaces its notification, another item gets its own", async () => {
    const sw = worker();
    await sw.push(show({ kind: "blocked", tag: "blocked:k-101", target: "k-101", title: "에이전트 · 결제 화면", body: "승인을 기다려요" }));
    await sw.push(show({ kind: "blocked", tag: "blocked:k-101", target: "k-101", title: "에이전트 · 결제 화면", body: "키를 기다려요" }));
    await sw.push(show());
    expect(sw.shown().map((note) => [note.tag, note.body])).toEqual([
      ["blocked:k-101", "중단됨 · 피드백 대기\n키를 기다려요"],
      ["ask:T2:1700000000", "결정 필요\n오늘 저녁에 배포할까요?"],
    ]);
  });

  test("close takes away the notification with that tag; with nothing open it shows nothing", async () => {
    const sw = worker();
    await sw.push(show());
    await sw.push(show({ kind: "reply", tag: "reply:T4:n1", target: "T4", title: "에이전트 · 입력 폼", body: "고쳤어요" }));
    await sw.push({ v: 1, type: "close", tag: "ask:T2:1700000000" });
    expect(sw.shown().map((note) => note.tag)).toEqual(["reply:T4:n1"]);
    await sw.push({ v: 1, type: "close", tag: "question:k-102:7" });
    expect(sw.shown().map((note) => note.tag)).toEqual(["reply:T4:n1"]);
    expect(sw.shows()).toBe(2);
  });

  test("a body or title that is not a readable sentence is left out", async () => {
    const sw = worker();
    await sw.push(show({ tag: "a", body: "src/app.tsx 고침" }));
    await sw.push(show({ tag: "b", title: "fix flaky test", body: "" }));
    expect(sw.shown().map((note) => [note.title, note.body])).toEqual([
      ["배포 순서 정하기", "결정 필요"],
      ["LINA", "결정 필요"],
    ]);
  });

  test("the worker's kind lines and readable rule are the app's (src/words.ts, the timeline's foldReason rule)", async () => {
    const sentences = [
      "확인했어요. 반영할게요.",
      "GitHub 확인함",
      "src/app.tsx 고침",
      "`npm test` 돌림",
      "abc1234 커밋에 있어요",
      "#38 보세요",
      "https://example.com 참고",
      "자르는 중…",
      "deploy 끝남",
      "iPhone 에서 확인",
      "  ",
    ];
    for (const kind of Object.keys(PUSH_LINE) as (keyof typeof PUSH_LINE)[]) {
      for (const [index, body] of sentences.entries()) {
        const sw = worker();
        await sw.push(show({ kind, tag: `${kind}:${index}`, body }));
        const readable = Boolean(body) && !foldReason(body);
        expect(sw.shown()[0].body).toBe(readable ? `${PUSH_LINE[kind]}\n${body}` : PUSH_LINE[kind]);
      }
    }
  });

  test("a message that is not a PushMessage shows nothing", async () => {
    const sw = worker();
    await sw.push({ v: 2, type: "show" } as unknown as PushMessage);
    expect(sw.shows()).toBe(0);
  });

  test("the page's read marks close the matching tags and prefixes on this device", async () => {
    const sw = worker();
    await sw.push(show({ tag: "ask:T2:1" }));
    await sw.push(show({ tag: "ask:T3:2" }));
    await sw.push(show({ kind: "question", tag: "question:k-102:7", target: "k-102" }));
    await sw.push(show({ kind: "blocked", tag: "blocked:k-102", target: "k-102" }));
    await sw.message({ type: "lina-close", tags: ["ask:T3:2", "blocked:k-102"], prefixes: ["question:k-102:"] });
    expect(sw.shown().map((note) => note.tag)).toEqual(["ask:T2:1"]);
  });
});

function openedAt(tag: string, hash: string, scope = SCOPE): string {
  return `${scope}${scope.includes("?") ? "&" : "?"}open=${encodeURIComponent(tag)}${hash}`;
}

describe("choosing a notification", () => {
  test("with no app window open, a new one opens on the item's screen, carrying the tag", async () => {
    const sw = worker();
    await sw.push(show());
    await sw.push(show({ kind: "reply", tag: "reply:G2:n1", target: "G2" }));
    await sw.push(show({ kind: "question", tag: "question:k-102:7", target: "k-102" }));
    for (const note of sw.shown()) await sw.click(note);
    expect(sw.opened).toEqual([
      openedAt("ask:T2:1700000000", "#/inbox"),
      openedAt("reply:G2:n1", "#/items/G2"),
      openedAt("question:k-102:7", "#/cards/k-102"),
    ]);
    expect(sw.shown()).toEqual([]);
    expect(sw.posted).toEqual([]);
  });

  test("a new window's address carries the reply tag, and keeps a query the scope already has", async () => {
    const sw = worker();
    await sw.push(show({ kind: "reply", tag: "reply:T4:n1", target: "T4" }));
    await sw.click(sw.shown()[0]);
    expect(sw.opened).toEqual([openedAt("reply:T4:n1", "#/items/T4")]);
    expect(sw.posted).toEqual([]);

    const scope = `${SCOPE}?source=synthetic`;
    const withQuery = worker([], scope);
    await withQuery.push(show({ kind: "reply", tag: "reply:T4:n1", target: "T4" }));
    await withQuery.click(withQuery.shown()[0]);
    expect(withQuery.opened).toEqual([openedAt("reply:T4:n1", "#/items/T4", scope)]);
  });

  test("with the app open, its window (the focused one first) is brought forward and sent to the item", async () => {
    const sw = worker([
      { url: "https://hub.example/other/", focused: true },
      { url: `${SCOPE}#/due`, focused: false },
      { url: `${SCOPE}?source=synthetic#/running`, focused: true },
    ]);
    await sw.push(show({ kind: "blocked", tag: "blocked:k-101", target: "k-101" }));
    await sw.click(sw.shown()[0]);
    expect(sw.opened).toEqual([]);
    expect(sw.focused).toEqual([`${SCOPE}?source=synthetic#/running`]);
    expect(sw.posted).toEqual([{ type: "lina-open", kind: "blocked", target: "k-101", hash: "#/cards/k-101", tag: "blocked:k-101" }]);
  });
});
