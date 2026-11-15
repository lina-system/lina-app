import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { agentTalkPath, EVENTS_PATH, routePath, USAGE_RANGES, type RouteName } from "../src/api/client";
import { SyntheticSource } from "../src/data/synthetic-source";

// lina-app#187: the agent's window read through the core's client API (not `?source=synthetic`), the way the live hub
// answers: a long reply with a code block and a table drawn as markdown and never as HTML, a reply that comes in while
// the owner reads up, a refused send and a lost connection.
test.use({ serviceWorkers: "block" });
const LIST_ROUTES: readonly RouteName[] = ["board", "items", "goals", "cards", "inbox", "devices", "quota", "modelsState", "checks", "settingsModels"];

const LONG_REPLY = [
  "## 오늘 정리",
  "",
  "**배포**는 금요일 오후, 순서는 아래와 같아요. `agents` 목록은 그대로 둬요.",
  "",
  "1. 변경 목록 모으기",
  "2. 검토 받기",
  "- [문서](https://example.com/docs)는 새 탭에서 열려요",
  "- [x](javascript:alert(1)) 는 링크가 아니에요",
  "",
  '<img src=x onerror="window.__xss = 1"> 는 글자로만 보여요.',
  "",
  "```sh",
  "npm run build && node .agents/skills/verify-lina-app/scripts/verify.mjs drive --all --with-a-very-long-flag-name-that-does-not-fit",
  "```",
  "",
  "| 단계 | 담당 | 예상 시간 | 상태 | 메모 |",
  "| --- | --- | ---: | --- | --- |",
  "| 변경 목록 | 에이전트 | 10분 | 진행 중 | 지난주 목록과 맞춰 봄 |",
  "| 검토 | 사람 | 30분 | 대기 | 금요일 오전까지 |",
  "",
  "> 배포 뒤에는 상태 탭을 확인해 주세요.",
].join("\n");

interface Core {
  socket: () => WebSocketRoute | null;
  /** Lets the held send answer with the reply. */
  answer: () => void;
  refuse: boolean;
}

async function serveCore(page: Page): Promise<Core> {
  const source = new SyntheticSource();
  const bodies = new Map<string, unknown>();
  for (const name of LIST_ROUTES) {
    const result = await source.read(name);
    if (result.kind === "data") bodies.set(routePath(name), result.data);
  }
  for (const range of USAGE_RANGES) {
    const result = await source.read("usage", range);
    if (result.kind === "data") bodies.set(routePath("usage", range), result.data);
  }
  const now = Math.floor(Date.now() / 1000);
  const history = [
    { role: "user", content: "[LINA app]\n\n어디까지 왔어요?", timestamp: now - 86_400 },
    { role: "assistant", content: "변경 목록을 모으는 중이에요.", timestamp: now - 86_400 + 40 },
    { role: "assistant", content: "배포 순서는 답을 기다려요.", timestamp: now - 86_400 + 60 },
    { role: "user", content: "[LINA app]\n\n오늘 할 일을 정리해 주세요", timestamp: now - 120 },
    { role: "assistant", content: LONG_REPLY, timestamp: now - 100 },
  ];
  let release: () => void = () => undefined;
  let held = new Promise<void>((resolve) => (release = resolve));
  const core: Core = {
    socket: () => socket,
    answer: () => {
      release();
      held = new Promise<void>((resolve) => (release = resolve));
    },
    refuse: false,
  };
  let socket: WebSocketRoute | null = null;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (url.pathname === "/api/auth/ws-ticket") return route.fulfill({ json: { ticket: "one-use" } });
    if (url.pathname === agentTalkPath("ag-1") && route.request().method() === "POST") {
      if (core.refuse) return route.fulfill({ status: 429, json: { detail: "busy" } });
      await held;
      const ts = Math.floor(Date.now() / 1000);
      const frame = (seq: number) => ({ session_id: "app-ag-1", run_id: "run-1", seq, ts });
      const events = [
        ["talk.started", { agent: "ag-1", session_id: "app-ag-1" }],
        ["assistant.delta", { ...frame(1), message_id: "m1", delta: "네, **확인**했어요." }],
        ["assistant.completed", { ...frame(2), message_id: "m1", content: "네, **확인**했어요." }],
        ["done", frame(3)],
      ];
      return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("") });
    }
    if (url.pathname === agentTalkPath("ag-1")) return route.fulfill({ json: { agent: "ag-1", session_id: "app-ag-1", messages: history } });
    if (url.pathname.startsWith("/api/lina/agents/")) return route.fulfill({ json: { agent: "", session_id: null, messages: [] } });
    const body = bodies.get(path) ?? bodies.get(url.pathname);
    return body === undefined ? route.fulfill({ status: 404, json: { detail: "not found" } }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket(
    (url) => url.pathname === EVENTS_PATH,
    (route) => {
      socket = route;
      route.send(JSON.stringify({ cursor: "c1", events: [] }));
    },
  );
  return core;
}

async function openWindow(page: Page): Promise<Core> {
  const core = await serveCore(page);
  await page.goto("/app/#/talk/ag-1");
  await expect(page.getByTestId("freshness-line")).toHaveText("");
  await expect(page.getByTestId("talk-reply")).toHaveCount(3);
  return core;
}

test("a long reply draws its markdown inside the bubble: the code block and the table scroll sideways inside it, never the page, and no HTML from it runs", async ({ page }, info) => {
  await openWindow(page);
  const talk = page.getByTestId("agent-talk");
  const reply = talk.getByTestId("talk-reply").last();
  await expect(reply.locator("p.md-heading strong")).toHaveText("오늘 정리");
  await expect(reply.locator("strong").nth(1)).toHaveText("배포");
  await expect(reply.locator("ol > li")).toHaveText(["변경 목록 모으기", "검토 받기"]);
  expect(await reply.locator("ul, ol").evaluateAll((lists) => lists.map((list) => getComputedStyle(list).listStyleType))).toEqual(["decimal", "disc"]);
  const link = reply.getByRole("link", { name: "문서" });
  await expect(link).toHaveAttribute("href", "https://example.com/docs");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(reply.locator("a")).toHaveCount(1);
  await expect(talk.locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await expect(reply).toContainText('<img src=x onerror="window.__xss = 1">');
  await expect(reply.locator("blockquote")).toHaveText("배포 뒤에는 상태 탭을 확인해 주세요.");
  const boxes = await reply.evaluate((element) => {
    const bubble = element.querySelector(".talk-bubble")!.getBoundingClientRect();
    const sideways = (selector: string) => {
      const box = element.querySelector(selector) as HTMLElement;
      const rect = box.getBoundingClientRect();
      return { scrolls: box.scrollWidth > box.clientWidth, inside: rect.left >= bubble.left - 1 && rect.right <= bubble.right + 1, overflow: getComputedStyle(box).overflowX };
    };
    const column = element.closest(".talk")!.getBoundingClientRect();
    return { code: sideways(".md-code"), table: sideways(".md-table"), share: bubble.width / column.width, font: getComputedStyle(element.querySelector(".md-code")!).fontFamily };
  });
  expect(boxes.code).toEqual({ scrolls: true, inside: true, overflow: "auto" });
  expect(boxes.table.inside).toBe(true);
  expect(boxes.table.overflow).toBe("auto");
  expect(boxes.share).toBeLessThanOrEqual(0.76);
  expect(boxes.font).toMatch(/mono/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  // Grouped: the agent's two messages of yesterday are one group, one mark, one name and one time; a date stands between the days.
  await expect(talk.getByTestId("talk-day")).toHaveText(["어제", "오늘"]);
  const groups = await talk.getByTestId("talk-group").evaluateAll((all) => all.map((group) => [group.classList.contains("is-mine") ? "me" : "agent", group.querySelectorAll(".talk-turn").length, group.querySelectorAll(".mark").length, group.querySelectorAll("[data-testid=talk-time]").length].join(":")));
  expect(groups).toEqual(["me:1:0:1", "agent:2:1:1", "me:1:0:1", "agent:1:1:1"]);
  await page.screenshot({ path: info.outputPath(`talk-markdown-${info.project.name}.png`) });
  await reply.locator(".md-table").scrollIntoViewIfNeeded();
  await reply.screenshot({ path: info.outputPath(`talk-markdown-reply-${info.project.name}.png`) });
});

test("read up while a reply comes in: the window stays put and 맨 아래로 counts it, then returns to the bottom", async ({ page }, info) => {
  const core = await openWindow(page);
  const talk = page.getByTestId("agent-talk");
  const phone = (page.viewportSize()?.width ?? 0) < 900;
  const scroller = phone ? page.locator(".phone-main") : talk.locator(".agent-talk-turns");
  const gap = () => scroller.evaluate((element) => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight));
  expect(await gap()).toBeLessThanOrEqual(48);
  const field = talk.getByRole("textbox", { name: "메시지" });
  await field.fill("배포 전에 한 번 더 알려 주세요");
  await field.press("Enter");
  await expect(talk.getByTestId("talk-mine").last()).toHaveAttribute("data-state", "sending");
  expect(await gap()).toBeLessThanOrEqual(48);
  await scroller.evaluate((element) => element.scrollTo(0, 0));
  const jump = talk.getByTestId("talk-jump");
  await expect(jump).toHaveAttribute("aria-label", "맨 아래로");
  core.answer();
  await expect(talk.getByTestId("talk-reply")).toHaveCount(4);
  await expect(jump).toHaveAttribute("aria-label", "맨 아래로 1");
  await expect(jump).toHaveText("1");
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  const size = (await jump.boundingBox())!;
  expect(size.width).toBeGreaterThanOrEqual(phone ? 44 : 40);
  // The button is what the page draws at its middle: above the field, not under it.
  expect(await jump.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return at !== null && button.contains(at);
  })).toBe(true);
  await page.screenshot({ path: info.outputPath(`talk-jump-${info.project.name}.png`) });
  await jump.click();
  await expect(jump).toHaveCount(0);
  expect(await gap()).toBeLessThanOrEqual(48);
});

test("a refused send says why in one line and a lost connection shows in the head", async ({ page }, info) => {
  const core = await openWindow(page);
  const talk = page.getByTestId("agent-talk");
  core.refuse = true;
  const field = talk.getByRole("textbox", { name: "메시지" });
  await field.fill("가짜 질문 하나");
  await talk.getByRole("button", { name: "보내기" }).click();
  await expect(talk.getByTestId("write-error")).toHaveText("에이전트가 바쁨");
  await expect(field).toHaveValue("가짜 질문 하나");
  await page.screenshot({ path: info.outputPath(`talk-refused-${info.project.name}.png`) });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/**", (route) => route.abort());
  await core.socket()?.close();
  await expect(page.getByTestId("freshness-line")).toHaveText(/^(연결 끊김|갱신 지연)$/, { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath(`talk-offline-${info.project.name}.png`) });
});
