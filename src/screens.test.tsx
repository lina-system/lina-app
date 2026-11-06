import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { render as renderPreact } from "preact";
import { useEffect, useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RouteName } from "./api/client";
import { App } from "./app";
import { STREAM_TICK_MS, SYNTHETIC_REPLY_AFTER, SyntheticSource, TALK_FRAME_MS, TALK_REPLY_DELTAS } from "./data/synthetic-source";
import type { ReadResult, Source } from "./data/source";
import { BACKOFF_MAX_MS } from "./data/live";
import { Store } from "./data/store";
import { SCENE_COUNTS } from "./fixtures/synthetic";
import { buildModel } from "./model";
import { containsText } from "./text-match";
import { TOAST_MS } from "./ui/actions";
import { BANNED_WORDS } from "./words";

const SCREENS = [
  "#/",
  "#/inbox",
  "#/running",
  "#/due",
  "#/done",
  "#/agents/ag-1",
  "#/agents/ag-2",
  "#/agents/ag-3",
  "#/goals",
  "#/goals/G2",
  "#/goals/G4",
  "#/items/T2",
  "#/items/T4",
  "#/cards/k-101",
  "#/cards/k-103",
  "#/runs/r6",
  "#/status",
] as const;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, options: { wide: boolean; source?: Source }) {
  setWide(options.wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = options.source ?? new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  if (/^#\/(goals|items|cards|runs)\//.test(hash)) {
    await waitFor(() => expect(view.container.querySelector("article.detail")).not.toBeNull());
  }
  return view;
}

function screenText(root: Element): string {
  const version = root.querySelector("[data-testid=version]");
  const texts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!version?.contains(node)) texts.push(node.textContent ?? "");
  }
  const labels = [...root.querySelectorAll("[aria-label]")].map((element) => element.getAttribute("aria-label"));
  return [...texts, ...labels].join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The shared term table, written out here so a change to src/words.ts cannot widen it unnoticed.
const STATES = ["예정", "진행 중", "대기", "중단됨", "완료"];
const REASONS = ["결정 필요", "피드백", "검토 필요", "보류", "진행 대기", "응답 없음", "실패", "결과 누락"];
// Latin words the term table allows on screen: the app name, CPU and the services' display names.
const LATIN_WORDS = ["LINA", "CPU", "Claude", "ChatGPT", "Gemini", "Grok"];
const STATE_LINE = new RegExp(`^(?:${STATES.join("|")})(?: · (?:${REASONS.join("|")}))?$`);

describe.each([
  ["1280", true],
  ["390", false],
])("at %s", (_width, wide) => {
  test.each(SCREENS)("%s shows only the five states and their reason words", async (hash) => {
    const view = await open(hash, { wide });
    const labels = [...view.container.querySelectorAll("[data-testid=state]")].map((element) => element.textContent ?? "");
    for (const label of labels) expect(label).toMatch(STATE_LINE);
    expect(screenText(view.container)).not.toMatch(/\b(?:planned|in_progress|waiting|stopped|done|unresponsive|no_response|blocked_by_item|result_missing|review|decision|feedback|hold|failed|rejected|cancelled|gate|budget)\b/);
  });

  test.each(SCREENS)("%s shows no ids, paths, numbers of record, tool names or banned words", async (hash) => {
    const view = await open(hash, { wide });
    const text = screenText(view.container);
    expect(text).not.toMatch(/\b[GT]\d+\b/);
    expect(text).not.toMatch(/\bt_\w+|\bOT-\w+|\b(?:ag|kg|k|acct|check)-\w+|\br\d+\b/);
    expect(text).not.toMatch(/#\d+/);
    expect(text).not.toMatch(/(?:^|[\s(])\/[\w.-]+\/[\w./-]*/);
    expect(text).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    expect(text).not.toMatch(/\b(?:ulw|research|mass|omo|quick-issue|lina-worker|kanban|worker|session)\b/i);
    expect(text).not.toMatch(/\b\d+\s*(?:h|m|s|min)\b|\d+시간(?![째 전후])/);
    for (const word of BANNED_WORDS) expect(text).not.toContain(word);
    const names = new Set(new SyntheticSource().scene.items.agents.map((agent) => agent.name));
    const latin = (text.match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !names.has(word) && !LATIN_WORDS.includes(word));
    expect(latin).toEqual([]);
  });
});

function count(element: Element | null): number {
  return Number(element?.textContent ?? "0");
}

function stoppedRows(root: Element | null): number {
  return root ? root.querySelectorAll("[data-testid=row].is-stopped").length : 0;
}

function rowsIn(root: Element | null): number {
  return root ? root.querySelectorAll("[data-testid=row]").length : 0;
}

describe("machines, quota and checks", () => {
  test("each machine row reads name, state, the one reason word, three meters and its load", async () => {
    const view = await open("#/status", { wide: true });
    const rows = [...view.getByRole("list", { name: "기기" }).querySelectorAll(".row-body")].map((row) => row.getAttribute("aria-label"));
    expect(rows).toHaveLength(3);
    expect(rows.some((label) => /^\S+ · 정상 · CPU \d+% · 메모리 \d+% · 디스크 \d+% · 작업 \d+\/\d+$/.test(label ?? ""))).toBe(true);
    expect(rows.some((label) => /^\S+ · 경고 · 디스크 · CPU \d+% · 메모리 \d+% · 디스크 \d+% · 작업 \d+\/\d+$/.test(label ?? ""))).toBe(true);
    expect(rows.some((label) => /^\S+ · 꺼짐 · 연결 끊김 · CPU — · 메모리 — · 디스크 — · 작업 —\/\d+$/.test(label ?? ""))).toBe(true);
    const down = view.container.querySelector(".machine-row.is-down") as HTMLElement;
    expect(down.querySelectorAll(".mini-none")).toHaveLength(3);
    expect(down.querySelectorAll(".meter")).toHaveLength(0);
    expect(view.container.querySelectorAll(".machine-row.is-ok .meter")).toHaveLength(3);
  });

  test("one quota row per service with its accounts folded under it, known services by their display names", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "쿼터" });
    const services = [...list.querySelectorAll(":scope > [data-testid=row]")];
    expect(services.map((row) => row.querySelector("summary .title")?.textContent)).toEqual(["Claude", "ChatGPT", "가온셈"]);
    const labels = services.map((row) => row.querySelector("summary")?.getAttribute("aria-label") ?? "");
    expect(labels).toEqual(["Claude · 72% · 시간당 +10% · 2시간 후 · 주의", "ChatGPT · 31% · 시간당 +1% · 2일 후", "가온셈 · 5% · 12일 후"]);
    expect(services.map((row) => row.querySelector("summary .sub")?.textContent)).toEqual(["72% · 시간당 +10% · 2시간 후", "31% · 시간당 +1% · 2일 후", "5% · 12일 후"]);
    expect(services.map((row) => (row.querySelector("details") as HTMLDetailsElement).open)).toEqual([false, false, false]);
    expect(services.map((row) => row.querySelectorAll("[data-testid=account]").length)).toEqual([2, 1, 1]);
    expect(services[0].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toBe("계정 1 · 72% · 시간당 +10% · 3시간 후 · 주의");
    expect(services[2].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toBe("계정 1 · 일시 정지 · 5% · 12일 후");
    expect(services[0].querySelector(".rate")?.getAttribute("title")).toBe("최근 5시간 평균");
    expect(services.filter((row) => row.querySelector("summary .warn-mark"))).toHaveLength(1);
  });

  test("the third panel keeps failing and stale checks open and folds the passing ones", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "점검" });
    const rows = [...list.querySelectorAll(".check-row")];
    expect(rows.map((row) => row.querySelector(".row-body")?.getAttribute("aria-label"))).toEqual(["백업 회선 · 응답 없음 · 실패 · 12분 전", "대기 봇 · 소식이 끊김 · 오래됨 · 3시간 전"]);
    expect(rows.map((row) => row.querySelector(".check-state")?.textContent)).toEqual(["실패", "오래됨"]);
    expect(rows.map((row) => row.className)).toEqual(["row check-row is-failing", "row check-row is-stale"]);
    const fold = list.querySelectorAll(".check-fold");
    expect(fold).toHaveLength(1);
    expect(fold[0].textContent).toBe("정상 3");
    expect(view.queryByTestId("checks-empty")).toBeNull();
  });

  test("a checks read that failed says so and the panel reads 점검 없음", async () => {
    const view = await open("#/status", { wide: true, source: new SyntheticSource({ checksError: true }) });
    expect(view.getByTestId("checks-empty").textContent).toBe("점검 없음");
    expect(view.queryByRole("list", { name: "점검" })).toBeNull();
    await waitFor(() => expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 점검"));
    expect(view.getByRole("list", { name: "쿼터" })).toBeTruthy();
  });
});

describe("every count equals the length of the list it labels", () => {
  test("sidebar rows and their screens", async () => {
    const pairs: [string, string][] = [
      ["nav-inbox", "#/inbox"],
      ["nav-running", "#/running"],
      ["nav-due", "#/due"],
      ["nav-done", "#/done"],
      ["nav-goals", "#/goals"],
    ];
    for (const [nav, hash] of pairs) {
      const view = await open(hash, { wide: true });
      const shown = count(view.getByTestId(nav).querySelector("[data-testid=nav-count]"));
      const red = count(view.getByTestId(nav).querySelector("[data-testid=nav-stopped]"));
      // The home lists the running and stopped cards first, in their own list; waiting and finished cards follow.
      const list = nav === "nav-running" ? view.container.querySelector('.list-pane [aria-label="진행 중인 작업"]') : view.container.querySelector(".list-pane .list");
      expect(shown).toBeGreaterThan(0);
      expect(red).toBe(stoppedRows(list));
      expect(rowsIn(list) - stoppedRows(list)).toBe(shown);
      view.unmount();
    }
  });

  test("agent rows count their running cards, hidden at 0", async () => {
    for (const index of [0, 1, 2]) {
      const view = await open(`#/agents/ag-${index + 1}`, { wide: true });
      const nav = view.getByTestId(`nav-agent-${index}`);
      const running = view.queryByTestId("section-running");
      expect(rowsIn(running) - stoppedRows(running)).toBe(count(nav.querySelector("[data-testid=nav-count]")));
      expect(stoppedRows(running)).toBe(count(nav.querySelector("[data-testid=nav-stopped]")));
      for (const id of ["running", "review", "goals"]) {
        const head = view.getByTestId(`agent-count-${id}`);
        const section = view.queryByTestId(`section-${id}`);
        expect(rowsIn(section) - stoppedRows(section)).toBe(count(head.querySelector(".count")));
        expect(stoppedRows(section)).toBe(count(head.querySelector("[data-testid=stopped-count]")));
      }
      view.unmount();
    }
  });

  test("group headers count their rows", async () => {
    for (const hash of ["#/inbox", "#/due", "#/agents/ag-2"]) {
      const view = await open(hash, { wide: true });
      const sections = view.container.querySelectorAll(".list-pane [data-testid^=section-]");
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        const head = section.querySelector("[data-testid=count]");
        if (!head) continue;
        expect(rowsIn(section) - stoppedRows(section)).toBe(count(head));
        expect(stoppedRows(section)).toBe(count(section.querySelector("[data-testid=stopped-count]")));
      }
      view.unmount();
    }
  });

  test("the device line counts machine rows and the bell counts unread notices", async () => {
    const view = await open("#/status", { wide: true });
    const line = view.getByTestId("device-line").textContent ?? "";
    expect(line).toBe("기기 3 · 정상 1 · 경고 1 · 꺼짐 1");
    const [all, ok, warn, down] = (line.match(/\d+/g) ?? []).map(Number);
    expect(ok + warn + down).toBe(all);
    const machines = view.getByTestId("section-machines");
    expect(rowsIn(machines)).toBe(all);
    expect(machines.querySelectorAll(".machine-row.is-ok").length).toBe(ok);
    expect(machines.querySelectorAll(".machine-row.is-warn").length).toBe(warn);
    expect(machines.querySelectorAll(".machine-row.is-down").length).toBe(down);
    const bell = count(view.getByTestId("bell-count"));
    fireEvent.click(view.getByTestId("bell"));
    const notices = view.getByTestId("notices");
    expect(rowsIn(notices)).toBe(SCENE_COUNTS.notices);
    expect(notices.querySelectorAll("[data-testid=row]:not(.is-read)").length).toBe(bell);
    expect(within(notices).getByTestId("unread-count").textContent).toBe(`안 읽음 ${bell}`);
    expect(bell).toBe(SCENE_COUNTS.unread);
  });
});

/** The synthetic scene with some reads failing; its writes are the synthetic source's own. */
class FailingSource extends SyntheticSource {
  constructor(
    private readonly failing: (name: RouteName) => "offline" | "failed" | null,
    options: ConstructorParameters<typeof SyntheticSource>[0] = {},
  ) {
    super(options);
  }
  override async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<import("./api/client").Routes[N]>> {
    const failure = this.failing(name);
    if (failure) return { kind: "failed", offline: failure === "offline", at: Date.now() / 1000 };
    return super.read(name, id);
  }
}

describe("freshness", () => {
  beforeEach(() => setWide(true));

  test("a failed route shows its error line and the rest still draws", async () => {
    const view = await open("#/inbox", { wide: true, source: new FailingSource((name) => (name === "devices" ? "failed" : null)) });
    await waitFor(() => expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 기기"));
    expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
  });

  test("a source listed in errors[] shows 읽기 실패 with its word", async () => {
    const view = await open("#/inbox", { wide: true, source: new SyntheticSource({ sourceError: true }) });
    expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 쿼터");
  });

  test("an unreachable core reads 연결 끊김", async () => {
    setWide(true);
    window.history.replaceState(null, "", "/app/#/inbox");
    const view = render(<App store={new Store(new FailingSource(() => "offline"))} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("연결 끊김"));
  });

  test("with the stream open the line reads 실시간; down, it reads 갱신 지연 until a reconnect", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source });
      source.setStreamDown(true);
      await act(async () => source.dropStreams());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
      });
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      source.setStreamDown(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stream that never opens reads 갱신 지연, not 실시간", async () => {
    setWide(true);
    window.history.replaceState(null, "", "/app/#/inbox");
    const view = render(<App store={new Store(new SyntheticSource({ live: "down" }))} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연"));
    expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
  });
});

describe("phone navigation", () => {
  test("a row pushes the next screen and back names the screen it returns to", async () => {
    const view = await open("#/", { wide: false });
    expect(within(view.getByTestId("sidebar")).getByText("수신함")).toBeTruthy();
    fireEvent.click(view.getByTestId("nav-running").querySelector("a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("screen-title").textContent).toBe("진행 중인 작업"));
    expect(window.location.hash).toBe("#/running");
    expect(view.getByTestId("back").textContent).toBe("LINA");
    const row = view.getByTestId("screen-running").querySelector("[data-testid=row] a") as HTMLElement;
    fireEvent.click(row);
    await waitFor(() => expect(view.container.querySelector("[data-testid=screen-card], [data-testid=screen-run]")).not.toBeNull());
    expect(view.getByTestId("back").textContent).toBe("진행 중인 작업");
    expect((window.history.state as { stack: string[] }).stack).toEqual(["#/", "#/running", window.location.hash]);
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    await waitFor(() => expect(view.getByTestId("screen-title").textContent).toBe("진행 중인 작업"));
  });
});

describe("wide split view", () => {
  test.each(["#/inbox", "#/running", "#/due", "#/done", "#/goals"])("%s with nothing selected folds the detail pane", async (hash) => {
    const view = await open(hash, { wide: true });
    expect(view.getByTestId("panes").classList.contains("is-folded")).toBe(true);
    expect(view.queryByTestId("detail-pane")).toBeNull();
  });

  test("opening a row brings the detail pane back", async () => {
    const view = await open("#/running", { wide: true });
    fireEvent.click(view.getByTestId("screen-running").querySelector("[data-testid=row] a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("detail-pane")).toBeTruthy());
    expect(view.getByTestId("panes").classList.contains("is-folded")).toBe(false);
  });
});

describe("decisions", () => {
  test("each 결정 필요 row opens the record it is aimed at, and that record shows the decision", async () => {
    const inbox = await open("#/inbox", { wide: true });
    const list = inbox.getByRole("list", { name: "결정 필요" });
    for (const button of list.querySelectorAll(":scope > li > .row-button")) fireEvent.click(button);
    const rows = [...list.querySelectorAll(":scope > li")].map((row) => ({
      href: row.querySelector(".decision-panel a")?.getAttribute("href") ?? "",
      text: row.querySelector(".row-button .title")?.textContent ?? "",
      context: row.querySelector(".decision-panel a")?.textContent ?? "",
    }));
    inbox.unmount();
    expect(rows.filter((row) => /^#\/(items|goals)\//.test(row.href)).length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.href.startsWith("#/cards/")).length).toBe(1);
    expect(rows.every((row) => /^#\/(items|goals|cards)\//.test(row.href))).toBe(true);
    for (const row of rows) {
      const view = await open(row.href, { wide: true });
      await waitFor(() => expect(view.getByTestId("decision").textContent).toContain(row.text));
      // A card with no checked title has no title in its head, and its question names only its goal.
      const title = view.container.querySelector(".detail-title")?.textContent ?? "";
      expect(title ? row.context === title || row.context.endsWith(` › ${title}`) : !row.context.includes(" › ")).toBe(true);
      if (row.href.startsWith("#/cards/")) expect(view.container.querySelector(".detail .box")?.getAttribute("data-testid")).toBe("decision");
      view.unmount();
    }
  });
});

describe("counts", () => {
  test("the sidebar, section headings and the agent head draw counts with one component", async () => {
    const view = await open("#/agents/ag-2", { wide: true });
    const counts = [...view.container.querySelectorAll("[data-testid=nav-count], [data-testid=nav-stopped], [data-testid=count], [data-testid=stopped-count], .agent-counts .count")];
    expect(counts.length).toBeGreaterThan(0);
    for (const element of counts) expect(element.closest(".count-pair")).not.toBeNull();
    expect(view.getByTestId("agent-counts").querySelectorAll(".count-pair .is-stopped-count")).toHaveLength(1);
  });
});

class RefusingSource extends SyntheticSource {
  sent: string[] = [];
  override async comment(id: string, body: { text: string }) {
    this.sent.push(`${id}:${body.text}`);
    return { ok: false as const, status: 409, detail: "no open decision" };
  }
}

describe("comments", () => {
  test("a sent comment shows at once with its pending line, then the record's copy, then the agent's reply", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      const source = new SyntheticSource();
      const agent = source.scene.items.agents.find((person) => person.id === source.scene.itemDetails.T4.agent)?.name;
      const view = await open("#/items/T4", { wide: true, source });
      const field = view.getByRole("textbox", { name: "댓글 달기" }) as HTMLInputElement;
      const send = within(view.getByTestId("comments")).getByRole("button", { name: "보내기" }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      field.value = "가로 폭도 봐 주세요";
      fireEvent.input(field);
      expect(send.disabled).toBe(false);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.getByTestId("comment-pending").textContent).toBe(`${agent}에게 보냄 · 방금`);
      expect((within(view.getByTestId("comments")).getByRole("button", { name: "보내기" }) as HTMLButtonElement).disabled).toBe(true);
      expect(field.value).toBe("");
      await waitFor(() => expect(source.scene.itemDetails.T4.comments.at(-1)?.text).toBe("가로 폭도 봐 주세요"));
      await waitFor(() => expect(view.getAllByTestId("comment-pending")).toHaveLength(1));
      expect(SYNTHETIC_REPLY_AFTER).toBeLessThan(10);
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await waitFor(() => expect(view.queryByTestId("comment-pending")).toBeNull());
      expect(view.getAllByTestId("reply").at(-1)?.querySelector(".sub")?.textContent).toMatch(/ · 반영함$/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused comment comes back into the field with the core's line under it", async () => {
    const source = new RefusingSource();
    const view = await open("#/items/T4", { wide: true, source });
    const field = view.getByRole("textbox", { name: "댓글 달기" }) as HTMLInputElement;
    field.value = "다시";
    fireEvent.input(field);
    fireEvent.submit(field.form as HTMLFormElement);
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("no open decision"));
    expect(source.sent).toEqual(["T4:다시"]);
    expect(field.value).toBe("다시");
    expect(view.queryByTestId("comment-pending")).toBeNull();
    expect(view.getAllByTestId("comment")).toHaveLength(2);
  });

  test("a resolved thread folds to one line with its first words", async () => {
    const view = await open("#/items/T4", { wide: true });
    const resolved = view.getByTestId("resolved") as HTMLDetailsElement;
    expect(resolved.open).toBe(false);
    expect(resolved.querySelector("summary")?.textContent).toBe("해결됨 · 오류가 나면 입력한 값은…");
  });
});

/** The synthetic source with every write recorded; `refuse` makes chosen writes answer 409. */
class SpySource extends SyntheticSource {
  calls: string[] = [];
  refuse = new Set<string>();
  private async spy<T>(name: string, args: unknown[], run: () => Promise<T>): Promise<T> {
    this.calls.push(`${name} ${JSON.stringify(args)}`);
    if (this.refuse.has(name)) return { ok: false, status: 409, detail: "refused" } as T;
    return run();
  }
  override comment(...args: Parameters<SyntheticSource["comment"]>) {
    return this.spy("comment", args, () => super.comment(...args));
  }
  override done(...args: Parameters<SyntheticSource["done"]>) {
    return this.spy("done", args, () => super.done(...args));
  }
  override undo(...args: Parameters<SyntheticSource["undo"]>) {
    return this.spy("undo", args, () => super.undo(...args));
  }
  override retry(...args: Parameters<SyntheticSource["retry"]>) {
    return this.spy("retry", args, () => super.retry(...args));
  }
  override answerCard(...args: Parameters<SyntheticSource["answerCard"]>) {
    return this.spy("answerCard", args, () => super.answerCard(...args));
  }
}

const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

function decisionButton(view: ReturnType<typeof render>, text: string): HTMLElement {
  return view.getByRole("button", { name: containsText(text) });
}

describe("answers", () => {
  test("a choice hides the row at once and is sent only when the toast ends", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      const row = decisionButton(view, "배포를 금요일 오후에 해도 될까요");
      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      await waitFor(() => expect(view.getByRole("button", { name: "금요일 오후 · 추천" })).toBeTruthy());
      expect(view.getByRole("button", { name: "월요일 오전" })).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "금요일 오후 · 추천" }));
      expect(view.getByTestId("toast").textContent).toBe("답함되돌리기");
      expect(view.queryByRole("button", { name: /배포를 금요일/ })).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS - 100);
      });
      expect(source.calls).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      await waitFor(() => expect(source.calls).toEqual(['comment ["T2",{"text":"금요일 오후","answer":true}]']));
      expect(view.queryByTestId("toast")).toBeNull();
      expect(view.queryByRole("button", { name: /배포를 금요일/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("되돌리기 in the toast brings the row back and sends nothing", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(decisionButton(view, "자주 쓰는 검색어 열 개를"));
      const field = view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement;
      field.value = "결제, 환불, 배송";
      fireEvent.input(field);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.queryByRole("button", { name: /자주 쓰는 검색어/ })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "되돌리기" }));
      expect(view.getByRole("button", { name: /자주 쓰는 검색어/ })).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(source.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a card question is answered on the work card route; a refused answer returns with its line", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(decisionButton(view, "카드 번호는 앞 여섯 자리까지"));
      const field = view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement;
      field.value = "네";
      fireEvent.input(field);
      fireEvent.submit(field.form as HTMLFormElement);
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(source.calls).toEqual(['answerCard ["k-102",{"text":"네"}]']));
      await waitFor(() => expect(view.queryByRole("button", { name: /카드 번호는/ })).toBeNull());

      source.refuse.add("comment");
      fireEvent.click(decisionButton(view, "복구 연습에 쓸 두 시간을"));
      const act2 = view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement;
      act2.value = "목요일 오후";
      fireEvent.input(act2);
      fireEvent.submit(act2.form as HTMLFormElement);
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("열린 결정 없음"));
      expect((view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement).value).toBe("목요일 오후");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("done marks", () => {
  test("a tap strikes the row and sends done at once; 되돌리기 in the toast calls undo", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/goals/G2", { wide: true, source });
      const box = view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" });
      expect(box.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(box);
      expect(source.calls).toEqual(['done ["T6",{}]']);
      const done = view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료됨" });
      expect(done.getAttribute("aria-checked")).toBe("true");
      expect(done.closest("li")?.classList.contains("is-checked")).toBe(true);
      expect(view.getByTestId("toast").textContent).toBe("완료로 표시함되돌리기");
      await waitFor(() => expect(source.scene.itemDetails.T6.state).toBe("done"));
      fireEvent.click(view.getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.calls).toEqual(['done ["T6",{}]', 'undo ["T6"]']));
      await waitFor(() => expect(view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" }).getAttribute("aria-checked")).toBe("false"));
      expect(source.scene.itemDetails.T6.state).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });

  test("after the toast the to-do page offers 되돌리기 until the undo window closes", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const page = await open("#/items/T3", { wide: true, source });
      const view = within(page.getByTestId("detail-pane"));
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      expect(page.container.querySelector(".head-undo")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(page.container.querySelector(".head-undo")?.textContent).toBe("되돌리기"));
      await act(async () => {
        vi.advanceTimersByTime(600_000);
      });
      expect(page.container.querySelector(".head-undo")).toBeNull();
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료됨" }).getAttribute("aria-disabled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a goal with open to-dos asks once, then sends withOpen; one undo reopens all", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const page = await open("#/goals/G1", { wide: true, source });
      const view = within(page.getByTestId("detail-pane"));
      fireEvent.click(view.getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }));
      expect(source.calls).toEqual([]);
      expect(view.getByTestId("with-open").textContent).toContain("열린 할 일 3개도 함께 완료할까요?");
      fireEvent.click(view.getByRole("button", { name: "취소" }));
      expect(view.queryByTestId("with-open")).toBeNull();
      fireEvent.click(view.getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }));
      fireEvent.click(view.getByRole("button", { name: "함께 완료" }));
      expect(source.calls).toEqual(['done ["G1",{"withOpen":true}]']);
      expect(view.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      fireEvent.click(within(page.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.calls.at(-1)).toBe('undo ["G1"]'));
      await waitFor(() => expect(view.queryAllByRole("checkbox", { checked: true })).toHaveLength(0));
      expect(["G1", "T1", "T2", "T3"].map((id) => source.scene.itemDetails[id].state)).toEqual(["in_progress", "in_progress", "waiting", "planned"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused done reverts the row and shows the known line under it", async () => {
    const source = new SpySource();
    source.refuse.add("done");
    const view = await open("#/inbox", { wide: true, source });
    fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("열린 할 일 있음"));
    expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).getAttribute("aria-checked")).toBe("false");
    expect(view.queryByTestId("toast")).toBeNull();
  });
});

describe("retry", () => {
  test("다시 시도 on a stopped card asks its to-do's agent and says so for as long as a toast", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/running", { wide: true, source });
      const buttons = view.getAllByRole("button", { name: /다시 시도$/ });
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);
      // The board does not list the worker runs a card started (as the core), so the card's to-do is not known and
      // 다시 시도 asks the card itself.
      await waitFor(() => expect(source.calls).toEqual(['answerCard ["k-103",{"text":"다시 시도해 주세요."}]']));
      await waitFor(() => expect(view.getByTestId("retry-requested").textContent).toMatch(/^\S+에게 요청함$/));
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await waitFor(() => expect(view.queryByTestId("retry-requested")).toBeNull());
      expect(view.getAllByRole("button", { name: /다시 시도$/ })).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bell", () => {
  test("choosing a notice opens its item and marks it read on the core; 모두 읽음 marks all", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const source = new SpySource();
    const reads: unknown[] = [];
    const readNotices = source.readNotices.bind(source);
    source.readNotices = async (body) => {
      reads.push(body);
      return readNotices(body);
    };
    const view = await open("#/inbox", { wide: true, source });
    expect(view.getByRole("button", { name: "알림 5" })).toBeTruthy();
    fireEvent.click(view.getByTestId("bell"));
    const dialog = view.getByRole("dialog", { name: "알림" });
    expect(dialog.querySelectorAll(".is-read")).toHaveLength(2);
    expect(within(dialog).getByTestId("unread-count").textContent).toBe("안 읽음 5");
    const first = within(dialog).getAllByRole("link")[0];
    const target = first.getAttribute("href");
    fireEvent.click(first);
    expect(window.location.hash).toBe(target);
    expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy();
    await waitFor(() => expect(source.scene.board.notices.filter((notice) => !notice.read)).toHaveLength(4));
    fireEvent.click(view.getByTestId("bell"));
    const again = view.getByRole("dialog", { name: "알림" });
    expect(again.querySelectorAll("[data-testid=row]:not(.is-read)")).toHaveLength(4);
    expect(within(again).getByTestId("unread-count").textContent).toBe("안 읽음 4");
    fireEvent.click(view.getByRole("button", { name: "닫기" }));
    expect(reads).toEqual([{ keys: [source.scene.board.notices[0].key] }]);
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByRole("button", { name: "모두 읽음" }));
    expect(view.getByRole("button", { name: "알림" })).toBeTruthy();
    expect(view.queryByTestId("bell-count")).toBeNull();
    await waitFor(() => expect(source.scene.board.counts.unread).toBe(0));
    expect(reads.at(-1)).toEqual({ all: true });
    expect(view.getByRole("dialog", { name: "알림" }).querySelectorAll("[data-testid=row]:not(.is-read)")).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "닫기" }));
    expect(view.queryByTestId("notices")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  test("a read on one device is the count on the other within 2 s, both ways", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const desktopStore = new Store(new SyntheticSource({ scene: core.scene }));
      await desktopStore.refresh();
      expect(buildModelCount(desktopStore)).toBe(5);
      const phone = await open("#/inbox", { wide: false, source: core });
      expect(phone.getByRole("button", { name: "알림 5" })).toBeTruthy();
      const key = core.scene.board.notices.find((notice) => !notice.read)?.key ?? "";
      expect(await desktopStore.write((source) => source.readNotices({ keys: [key] }))).toMatchObject({ ok: true });
      expect(buildModelCount(desktopStore)).toBe(4);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      await waitFor(() => expect(phone.getByRole("button", { name: "알림 4" })).toBeTruthy());
      fireEvent.click(phone.getByTestId("bell"));
      fireEvent.click(phone.getByRole("button", { name: "모두 읽음" }));
      await waitFor(() => expect(core.scene.board.counts.unread).toBe(0));
      await desktopStore.refresh();
      expect(buildModelCount(desktopStore)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused read mark puts the notice back as unread with its line", async () => {
    const source = new SpySource();
    source.readNotices = async () => ({ ok: false, status: 429, detail: "too many writes" });
    const view = await open("#/inbox", { wide: true, source });
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByRole("button", { name: "모두 읽음" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("쓰기가 너무 많음"));
    expect(view.getByRole("button", { name: "알림 5" })).toBeTruthy();
  });
});

function buildModelCount(store: Store): number {
  return buildModel(store.input(), Date.now() / 1000).counts.unread;
}

function inboxCounts(view: ReturnType<typeof render>) {
  const sidebar = Number(view.getByTestId("nav-inbox").querySelector("[data-testid=nav-count]")?.textContent ?? "0");
  const heads: Record<string, number> = {};
  for (const id of ["decide", "mine"]) heads[id] = Number(view.queryByTestId(`head-${id}`)?.querySelector("[data-testid=count]")?.textContent ?? "0");
  const rows = view.container.querySelectorAll(".list-pane [data-testid=screen-inbox] [data-testid=row]").length;
  return { sidebar, decide: heads.decide, mine: heads.mine, rows };
}

describe("lists while a write is in flight", () => {
  test("a ticked 내 할 일 row stays, struck and checked, for the toast; then it leaves and every count follows", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      await waitFor(() => expect(source.scene.board.inbox.mine.map((row) => row.id)).toEqual(["T9"]));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      const box = view.getByRole("checkbox", { name: "공지 문구 확인 완료됨" });
      expect(box.getAttribute("aria-checked")).toBe("true");
      expect(box.closest("li")?.classList.contains("is-checked")).toBe(true);
      expect(inboxCounts(view)).toEqual({ sidebar: 8, decide: 4, mine: 2, rows: 8 });
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      // The screens draw the record once the write's own read has landed.
      await waitFor(() => expect(view.queryByRole("checkbox", { name: /^공지 문구 확인/ })).toBeNull());
      expect(inboxCounts(view)).toEqual({ sidebar: 7, decide: 4, mine: 1, rows: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("되돌리기 on a held row puts it back unchecked", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      fireEvent.click(within(view.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("planned"));
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).getAttribute("aria-checked")).toBe("false");
      expect(inboxCounts(view)).toEqual({ sidebar: 8, decide: 4, mine: 2, rows: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a row hidden for its answer's toast is out of every count, and undo puts it back", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const view = await open("#/inbox", { wide: true, source: new SpySource() });
      fireEvent.click(decisionButton(view, "배포를 금요일 오후에 해도 될까요"));
      await waitFor(() => expect(view.getByRole("button", { name: "금요일 오후 · 추천" })).toBeTruthy());
      fireEvent.click(view.getByRole("button", { name: "금요일 오후 · 추천" }));
      expect(inboxCounts(view)).toEqual({ sidebar: 7, decide: 3, mine: 2, rows: 7 });
      fireEvent.click(within(view.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      expect(inboxCounts(view)).toEqual({ sidebar: 8, decide: 4, mine: 2, rows: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("with no running card, 진행 중인 작업 still lists the stopped one with 다시 시도", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ noRunning: true }) });
    expect(view.queryByText("없음")).toBeNull();
    const rows = view.getByRole("list", { name: "진행 중인 작업" }).querySelectorAll("[data-testid=row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains("is-stopped")).toBe(true);
    expect(view.getByRole("button", { name: /다시 시도$/ })).toBeTruthy();
    expect(view.getByTestId("nav-running").querySelector("[data-testid=nav-stopped]")?.textContent).toBe("1");
  });
});

describe("talk", () => {
  function talkParts(view: ReturnType<typeof render>) {
    const box = within(view.getByTestId("talk"));
    return { box, field: box.getByRole("textbox", { name: "메시지" }) as HTMLInputElement, send: box.getByRole("button", { name: "보내기" }) as HTMLButtonElement };
  }

  function type(field: HTMLInputElement, text: string) {
    field.value = text;
    fireEvent.input(field);
  }

  test("대화 sits under 댓글; Enter sends, the reply streams with a live mark, then one line says the agent keeps it", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const agent = source.scene.items.agents.find((person) => person.id === source.scene.itemDetails.T4.agent)?.name;
      const comments = source.scene.itemDetails.T4.comments.length;
      const view = await open("#/items/T4", { wide: true, source });
      const heads = [...view.container.querySelectorAll(".detail .box-head")].map((head) => head.textContent);
      expect(heads.slice(-2)).toEqual(["댓글", "대화"]);
      const { box, field, send } = talkParts(view);
      expect(send.disabled).toBe(true);
      type(field, "입력 폼 간격 봐 주세요");
      fireEvent.keyDown(field, { key: "Enter" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(box.getByTestId("talk-mine").textContent).toBe("입력 폼 간격 봐 주세요");
      expect(field.value).toBe("");
      expect(send.disabled).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 5);
      });
      const reply = box.getByTestId("talk-reply");
      expect(reply.querySelector(".talk-bubble")?.textContent).toBe(`${TALK_REPLY_DELTAS[0]}${TALK_REPLY_DELTAS[1]}답하는 중`);
      expect(box.getByTestId("talk-live")).toBeTruthy();
      expect(reply.querySelector(".mark")?.textContent).toBe(Array.from(agent ?? "")[0]);
      expect(box.queryByTestId("talk-carried")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 10);
      });
      expect(reply.querySelector(".talk-bubble")?.textContent).toBe(TALK_REPLY_DELTAS.join(""));
      expect(box.queryByTestId("talk-live")).toBeNull();
      expect(box.getAllByTestId("talk-carried").map((line) => line.textContent)).toEqual([`${agent} 대화에 남음`]);
      expect(view.queryByTestId("write-error")).toBeNull();
      expect(source.scene.itemDetails.T4.comments).toHaveLength(comments);
      type(field, "고마워요");
      fireEvent.click(send);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(box.queryByTestId("talk-carried")).toBeNull();
      expect(box.getAllByTestId("talk-mine")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an Enter that ends a Hangul composition does not send", async () => {
    const source = new SyntheticSource();
    const talk = vi.spyOn(source, "talk");
    const view = await open("#/items/T4", { wide: true, source });
    const { field } = talkParts(view);
    fireEvent.compositionStart(field);
    field.value = "안녕";
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(field, { data: "안녕" });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(talk).not.toHaveBeenCalled();
    expect(field.value).toBe("안녕");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(talk).toHaveBeenCalledWith("T4", { message: "안녕" }, expect.any(AbortSignal));
  });

  test.each([
    ["busy", "에이전트가 바쁨"],
    ["down", "에이전트 연결 안 됨"],
    ["none", "맡은 에이전트 없음"],
  ] as const)("a %s refusal shows one line and keeps the message in the field", async (talk, line) => {
    const view = await open("#/goals/G2", { wide: true, source: new SyntheticSource({ talk }) });
    const { box, field, send } = talkParts(view);
    type(field, "오늘 어디까지 했어요?");
    fireEvent.click(send);
    await waitFor(() => expect(box.getByTestId("write-error").textContent).toBe(line));
    expect(field.value).toBe("오늘 어디까지 했어요?");
    expect(send.disabled).toBe(false);
    expect(box.queryByTestId("talk-mine")).toBeNull();
  });
});

describe("live updates", () => {
  test("a write on another device shows here within 2 s; a resync, a drop and a reconnect keep the open row and the screen", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source: core });
      const screen = view.getByTestId("screen-inbox");
      const row = decisionButton(view, "배포를 금요일 오후에 해도 될까요");
      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const read = vi.spyOn(core, "read");

      const otherDevice = new Store(new SyntheticSource({ scene: core.scene }));
      expect(await otherDevice.write((source) => source.done("T3", {}))).toMatchObject({ ok: true });
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(view.queryByRole("checkbox", { name: /^공지 문구 확인/ })).toBeNull();
      expect(view.getByTestId("nav-inbox").textContent).toContain("7");
      // Only the routes a done mark touches were read, not every snapshot.
      expect([...new Set(read.mock.calls.map(([name, id]) => (id ? `${name}:${id}` : name)))].sort()).toEqual(["board", "items"]);
      read.mockRestore();

      core.resyncStreams();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS);
      });
      await act(async () => core.dropStreams());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await otherDevice.write((source) => source.readNotices({ keys: [core.scene.board.notices.find((notice) => !notice.read)?.key ?? ""] }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(core.stream.at(-1)).toMatchObject({ first: "missed", missed: 1, open: true });
      await waitFor(() => expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy());
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");

      expect(view.getByTestId("screen-inbox")).toBe(screen);
      expect(decisionButton(view, "배포를 금요일 오후에 해도 될까요")).toBe(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      expect(core.stream.filter((connection) => connection.open)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
test("a core restarted with a new token: the page reads it once and resumes, without a reload", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source: core });
      const screen = view.getByTestId("screen-inbox");
      await act(async () => core.restartCore());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(core.renewals).toBe(1);
      // Whichever the new token refused first, a read or the reconnect, the page resumed from its cursor.
      expect(core.stream[0].first).toBe("tail");
      expect(core.stream.at(-1)).toMatchObject({ since: expect.stringMatching(/^s\./), first: "missed", missed: 1, open: true });
      expect(core.stream.filter((connection) => connection.open)).toHaveLength(1);
      await waitFor(() => expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy());
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
      expect(view.getByTestId("screen-inbox")).toBe(screen);
    } finally {
      vi.useRealTimers();
    }
  });

  test("refused again after one renewal, the line turns red 연결 끊김 and the page asks nothing more", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      class StuckSource extends SyntheticSource {
        override async renewCredential() {
          this.renewals += 1;
          return "same" as const;
        }
      }
      const core = new StuckSource();
      const view = await open("#/inbox", { wide: true, source: core });
      await act(async () => core.restartCore());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      const line = view.getByTestId("freshness-line");
      expect(line.textContent).toBe("연결 끊김");
      expect(line.classList.contains("is-red")).toBe(true);
      const tries = core.stream.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 4);
      });
      expect(core.stream).toHaveLength(tries);
      expect(core.renewals).toBe(1);
      expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The synthetic core with one more hand: the agent behind a card writes its checked lines, as lina#151's writer does. */
class WritingSource extends SyntheticSource {
  writeLines(cardId: string, lines: { title?: string | null; now?: string | null }) {
    const summary = this.scene.cards.cards.find((card) => card.id === cardId);
    for (const target of [summary, this.scene.cardDetails[cardId]]) if (target) target.plain = { ...target.plain, ...lines };
    this.changed({ source: "kanban", kind: "plain_written", id: cardId });
  }
}

describe("work cards", () => {
  beforeEach(() => setWide(true));

  test("the home reads: decisions in one line, stopped then running, waiting, the last 24 hours, then older", async () => {
    const view = await open("#/running", { wide: true });
    const screen = view.getByTestId("screen-running");
    const lists = [...screen.querySelectorAll("ul.rows")].map((list) => list.getAttribute("aria-label"));
    expect(lists).toEqual(["수신함", "진행 중인 작업", "대기", "24시간 안에 끝남", "이전에 끝남"]);
    expect(view.getByTestId("home-decisions").textContent).toContain(String(SCENE_COUNTS.decisions));
    const names = (label: string) => [...(screen.querySelector(`[aria-label="${label}"]`)?.querySelectorAll(":scope > li > a") ?? [])].map((link) => link.getAttribute("aria-label") ?? "");
    expect(names("진행 중인 작업")[0]).toMatch(/중단됨 · 응답 없음$/);
    expect(names("24시간 안에 끝남")).toHaveLength(2);
    expect(names("이전에 끝남")).toHaveLength(1);
    for (const id of ["waiting", "recent", "older"]) {
      const section = view.getByTestId(`section-${id}`);
      expect(rowsIn(section)).toBe(count(section.querySelector("[data-testid=count]")));
    }
    expect(names("24시간 안에 끝남").length + names("이전에 끝남").length).toBe(count(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")));
  });

  test("a card with no checked lines is named by its kind of work in grey, never by raw text, on the home, its detail and its agent", async () => {
    const source = new SyntheticSource();
    const raw = [...source.scene.cards.cards.map((card) => card.title), ...source.scene.board.cards.flatMap((run) => [run.title, run.now ?? ""]), ...source.scene.cards.cards.map((card) => card.now ?? "")].filter(Boolean);
    for (const hash of ["#/running", "#/done", "#/inbox", "#/cards/k-102", "#/cards/k-101", "#/runs/r2", "#/agents/ag-2"]) {
      const view = await open(hash, { wide: true, source: new SyntheticSource({ scene: source.scene }) });
      const text = screenText(view.container);
      for (const line of raw) expect(text).not.toContain(line);
      view.unmount();
    }
    const view = await open("#/cards/k-102", { wide: true });
    const detail = view.getByTestId("screen-card");
    const head = detail.querySelector(".detail-title");
    expect(head?.textContent).toBe("코드 작업");
    expect(head?.classList.contains("is-kind")).toBe(true);
    expect(within(detail).getByTestId("kind").textContent).toBe("코드");
    expect(within(detail).queryByTestId("card-now")).toBeNull();
    const row = within(view.getByTestId("screen-running")).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-102");
    expect(row?.querySelector(".title")?.textContent).toBe("코드 작업");
    expect(row?.querySelector(".title")?.classList.contains("is-kind")).toBe(true);
    expect(row?.querySelector("a")?.getAttribute("aria-label")).toMatch(/ · 코드 작업 · 진행 중/);
    expect(row?.querySelector(".state")?.textContent).toBe("진행 중");
    view.unmount();
    const agent = await open("#/agents/ag-2", { wide: true });
    const agentRow = agent.container.querySelector('.list-pane li:has(> a[href="#/cards/k-102"]) .title');
    expect(agentRow?.textContent).toBe("코드 작업");
    expect(agentRow?.classList.contains("is-kind")).toBe(true);
  });

  test("two jobs on one to-do with one generated title stay two cards; three rounds of one card stay one card", async () => {
    const view = await open("#/done", { wide: true });
    const twins = within(view.getByTestId("screen-done")).getAllByRole("link", { name: /가이드 초안 다듬기/ });
    expect(new Set(twins.map((link) => link.getAttribute("href")))).toEqual(new Set(["#/runs/r7", "#/runs/r8"]));
    view.unmount();
    const home = await open("#/running", { wide: true });
    expect(within(home.getByTestId("screen-running")).getAllByRole("link", { name: /릴리스 노트: 변경 목록 정리/ })).toHaveLength(1);
    expect(home.container.querySelectorAll('a[href="#/runs/r9"], a[href="#/runs/r10"]')).toHaveLength(0);
  });

  test("a card's detail: now, its to-dos, then its worker runs by round; no box repeats the to-do list", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const detail = view.getByTestId("screen-card");
    const boxes = [...detail.querySelectorAll(":scope > .box > .box-head")].map((head) => head.textContent);
    // One round list: the record's blocks; 실행 does not stand beside them.
    expect(boxes).toEqual(["지금", "할 일", "기록", "댓글"]);
    expect([...detail.querySelectorAll(".checklist .title")].map((title) => title.textContent)).toEqual(["변경 목록 모으기", "모은 변경 확인", "공지 문구 확인"]);
    expect(within(detail).getByTestId("card-now").textContent).toContain("변경마다 한 줄 요약을 붙이는 중");
    expect(within(detail).queryByTestId("card-done-so-far")).toBeNull();
    expect(within(detail).queryByTestId("card-next")).toBeNull();
    expect(within(detail).queryByTestId("worker-runs")).toBeNull();
    // Each round's head is the link to its worker run.
    const links = within(detail).getAllByTestId("timeline-link");
    expect(links.map((link) => link.textContent?.split(" · ")[0])).toEqual(["라운드 3", "라운드 2", "라운드 1"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#/runs/r1", "#/runs/r10", "#/runs/r9"]);
    view.unmount();
    const waiting = await open("#/cards/k-104", { wide: true });
    expect(waiting.getByTestId("card-done-so-far").textContent).toBe("끝난 것실패 화면 세 곳의 문구와 버튼을 비교함");
  });

  test("a stopped writer: one 요약 멈춤 line, and the missing lines still show nothing", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ writerStopped: true }) });
    expect(view.getByTestId("summaries-stopped").textContent).toBe(" · 요약 멈춤");
    expect(view.getAllByTestId("summaries-stopped")).toHaveLength(1);
    view.unmount();
    const ok = await open("#/running", { wide: true });
    expect(ok.queryByTestId("summaries-stopped")).toBeNull();
  });

  test("a card's checked lines land in place from its kanban event: only its summary and detail are read", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new WritingSource();
      const view = await open("#/running", { wide: true, source });
      const row = () => within(view.getByTestId("screen-running")).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-102");
      const before = row();
      expect(before?.querySelector(".title")?.textContent).toBe("코드 작업");
      // Let the reads the page started on its own (the first tail, the open screen's wants) finish first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS);
      });
      const read = vi.spyOn(source, "read");
      source.writeLines("k-102", { title: "결제: 카드 입력 폼 다듬기", now: "보안 코드 칸을 맞추는 중" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 2);
      });
      await waitFor(() => expect(row()?.querySelector(".title")?.textContent).toBe("결제: 카드 입력 폼 다듬기"));
      expect(row()?.querySelector(".now")?.textContent).toBe("보안 코드 칸을 맞추는 중");
      expect(row()).toBe(before);
      const routes = new Set(read.mock.calls.map(([name, id]) => (id ? `${name}:${id}` : name)));
      expect(routes.has("cards") && routes.has("card:k-102")).toBe(true);
      expect([...routes].filter((route) => route.startsWith("card:"))).toEqual(["card:k-102"]);
      expect(routes.has("board") || routes.has("items")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("work cards, round 4", () => {
  beforeEach(() => setWide(true));

  test("a comment that would show a path, a hash or a cut-off fragment is one folded entry; its text opens on demand", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const comments = view.getAllByTestId("comment");
    expect(comments.map((comment) => comment.getAttribute("data-folded"))).toEqual([null, "hash", "fragment"]);
    expect(comments[0].querySelector(".comment-text")?.textContent).toBe("오류 문구 초안을 공유했어요.");
    expect(comments[1].querySelector("summary")?.textContent).toMatch(/^접힌 댓글 · \S+ · \d+(분|시간) 전$/);
    expect(screenText(view.container)).not.toContain("errors.json");
    const fold = comments[1].querySelector("details") as HTMLDetailsElement;
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    await waitFor(() => expect(comments[1].querySelector(".comment-raw")?.textContent).toContain("errors.json"));
  });

  test("완료's agent filter is the address: it survives a reload and a live update, and each count is its list", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/done?agent=ag-1", { wide: true, source: core });
      const listed = () => [...view.getByTestId("screen-done").querySelectorAll('[aria-label="완료"] > li > a')].map((link) => link.getAttribute("href"));
      expect(listed()).toEqual(["#/runs/r7", "#/runs/r8"]);
      const choices = within(view.getByTestId("done-filter")).getAllByRole("button");
      expect(choices.find((button) => button.getAttribute("aria-pressed") === "true")?.getAttribute("aria-label")).toMatch(/ 2$/);
      for (const button of choices) {
        const id = button.getAttribute("aria-label")?.startsWith("전체") ? "" : null;
        if (id === "") expect(button.getAttribute("aria-label")).toBe(`전체 ${SCENE_COUNTS.done}`);
      }
      const otherDevice = new Store(new SyntheticSource({ scene: core.scene }));
      await otherDevice.write((source) => source.comment("T4", { text: "확인 부탁해요" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 3);
      });
      expect(window.location.hash).toBe("#/done?agent=ag-1");
      expect(listed()).toEqual(["#/runs/r7", "#/runs/r8"]);
      view.unmount();
      const reloaded = await open("#/done?agent=ag-1", { wide: true, source: new SyntheticSource({ scene: core.scene }) });
      expect([...reloaded.getByTestId("screen-done").querySelectorAll('[aria-label="완료"] > li > a')]).toHaveLength(2);
      fireEvent.click(within(reloaded.getByTestId("done-filter")).getByRole("button", { name: /^전체/ }));
      await waitFor(() => expect(window.location.hash).toBe("#/done"));
      expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an agent's latest activity reads the same on its screen and on its 완료", async () => {
    const agentScreen = await open("#/agents/ag-2", { wide: true });
    const onAgent = agentScreen.getByTestId("agent-latest").textContent;
    agentScreen.unmount();
    const done = await open("#/done?agent=ag-2", { wide: true });
    expect(onAgent).toMatch(/^최근 활동 /);
    expect(done.getByTestId("done-latest").textContent).toBe(onAgent);
  });

  test("a running card with to-dos shows a thin bar and its count on a wide window; on a phone only in its detail", async () => {
    const wide = await open("#/running", { wide: true });
    const row = wide.container.querySelector('li:has(> a[href="#/cards/k-101"])') as HTMLElement;
    expect(within(row).getByTestId("progress").getAttribute("aria-label")).toBe("할 일 1/3");
    expect(row.querySelector(".progress-count")?.textContent).toBe("1/3");
    expect(wide.container.querySelector('li:has(> a[href="#/runs/r7"]) [data-testid=progress]')).toBeNull();
    wide.unmount();
    const phone = await open("#/running", { wide: false });
    expect(phone.container.querySelectorAll("[data-testid=progress]")).toHaveLength(0);
    phone.unmount();
    const detail = await open("#/cards/k-101", { wide: false });
    expect(detail.container.querySelector(".detail-head [data-testid=progress]")?.getAttribute("aria-label")).toBe("할 일 1/3");
  });

  test("a round with no start on record shows one dim line when it holds content; an end receipt alone shows nothing", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const heads = view.getAllByTestId("round").map((round) => round.querySelector(".round-head")?.textContent);
    // Round 3 has no end and its run no longer beats: the head says 중단됨, not 진행 중.
    expect(heads).toEqual([expect.stringMatching(/^라운드 3 · (어제 )?\d\d:\d\d · 중단됨$/), "라운드 1 · 시작 기록 없음"]);
    expect(view.getAllByTestId("round")[1].classList.contains("is-no-start")).toBe(true);
    expect(view.getAllByTestId("round")[1].querySelector("li")).toBeNull();
  });
});

describe("work cards, round 5", () => {
  beforeEach(() => setWide(true));

  test("the stopped and running group has its heading and counts like every other group", async () => {
    const view = await open("#/running", { wide: true });
    const head = view.getByTestId("head-active");
    expect(head.querySelector("span")?.textContent).toBe("진행 중");
    expect(count(head.querySelector("[data-testid=count]"))).toBe(SCENE_COUNTS.running);
    expect(count(head.querySelector("[data-testid=stopped-count]"))).toBe(SCENE_COUNTS.stopped);
    const section = view.getByTestId("section-active");
    expect(rowsIn(section) - stoppedRows(section)).toBe(SCENE_COUNTS.running);
    expect(within(section).getByRole("list").getAttribute("aria-label")).toBe("진행 중인 작업");
  });

  test("a finished card says when it ended on the home and the agent screen; how long it took is in its detail", async () => {
    const view = await open("#/running", { wide: true });
    const times = (id: string) => [...view.getByTestId(`section-${id}`).querySelectorAll(".sub")].map((line) => line.textContent);
    expect(times("recent")).toEqual(["완료 · 30분 전", "완료 · 2시간 전"]);
    expect(times("older")).toEqual(["완료 · 2일 전"]);
    view.unmount();
    const agent = await open("#/done?agent=ag-1", { wide: true });
    expect([...agent.getByTestId("screen-done").querySelectorAll(".sub")].map((line) => line.textContent)).toEqual(["완료 · 30분 전", "완료 · 2일 전"]);
    agent.unmount();
    const detail = await open("#/runs/r7", { wide: true });
    expect(detail.container.querySelector(".detail-head .sub")?.textContent).toBe("완료 · 30분 전 · 20분 걸림");
  });
});

describe("work cards, round 6", () => {
  beforeEach(() => setWide(true));

  test("a card just created (예정) shows on its agent's screen after 검토 필요, with no time; never on the home", async () => {
    const view = await open("#/agents/ag-3", { wide: true });
    const section = view.getByTestId("section-planned");
    expect(view.getByTestId("head-planned").textContent).toBe("예정1");
    const row = section.querySelector('li:has(> a[href="#/cards/k-106"])') as HTMLElement;
    expect(row.querySelector(".title")?.textContent).toBe("백업: 복구 연습 준비하기");
    expect(row.querySelector(".state")?.textContent).toBe("예정");
    expect(row.querySelector(".time")).toBeNull();
    expect(view.getByTestId("agent-count-planned").textContent).toBe(" · 예정 1");
    const order = [...view.getByTestId("screen-agent").querySelectorAll("[data-testid^=section-]")].map((element) => element.getAttribute("data-testid"));
    expect(order.indexOf("section-planned")).toBeGreaterThan(Math.max(order.indexOf("section-running"), order.indexOf("section-review")));
    expect(order.indexOf("section-planned")).toBeLessThan(order.indexOf("section-goals"));
    view.unmount();
    const home = await open("#/running", { wide: true });
    expect(home.container.querySelector('a[href="#/cards/k-106"]')).toBeNull();
  });

  test("an agent's 완료 · 오늘 line opens 완료 filtered to that agent", async () => {
    const view = await open("#/agents/ag-1", { wide: true });
    expect(view.getByTestId("done-today").querySelector("a")?.getAttribute("href")).toBe("#/done?agent=ag-1");
  });

  test("a round with no start on record draws the line it left, dimmed, under its head", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const round = view.getAllByTestId("round")[1];
    expect(round.querySelector(".round-head")?.textContent).toBe("라운드 1 · 시작 기록 없음");
    expect(round.querySelector("[data-testid=round-line]")?.textContent).toBe("오류 문구 초안을 남김");
  });

  test("a running card's detail head reads its to-dos in words: 할 일 1/3", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    expect(view.container.querySelector(".detail-head .progress-count")?.textContent).toBe("할 일 1/3");
    view.unmount();
    const home = await open("#/running", { wide: true });
    expect(home.container.querySelector('li:has(> a[href="#/cards/k-101"]) .progress-count')?.textContent).toBe("1/3");
  });
});

describe("the run's own timeline", () => {
  beforeEach(() => setWide(true));

  test("a card's detail reads its rounds newest first, each headed by its own span and outcome, below its boxes", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const heads = [...view.getByTestId("detail-pane").querySelectorAll(".detail > .box > .box-head")].map((head) => head.textContent);
    expect(heads.slice(-2)).toEqual(["기록", "댓글"]);
    const blocks = view.getAllByTestId("timeline-block");
    expect(blocks.map((block) => block.getAttribute("data-outcome"))).toEqual(["going", "comment", "rejected", "comment", "ended"]);
    const titles = blocks.map((block) => block.querySelector(".timeline-head")?.textContent);
    expect(titles[0]).toMatch(/^라운드 3 · (어제 )?\d\d:\d\d · 진행 중$/);
    expect(titles[1]).toMatch(/^댓글 · (어제 )?\d\d:\d\d$/);
    expect(titles[2]).toMatch(/^라운드 2 · (어제 )?\d\d:\d\d–(어제 )?\d\d:\d\d · 검토 반려$/);
    // No start on record: the end alone, no dangling dash; the dim line below says the start is missing.
    expect(titles[3]).toMatch(/^댓글 · (어제 )?\d\d:\d\d$/);
    expect(titles[4]).toMatch(/^라운드 1 · (어제 )?\d\d:\d\d · 작업 마침$/);
    expect(titles.join("\n")).not.toMatch(/ –|^–/m);
  });

  test("rows read oldest first: sentences bright, tools one dim line with its count, a repeat once with ×n, raw text left out", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const going = view.getAllByTestId("timeline-block")[0];
    const rows = [...going.querySelectorAll(".timeline-row")].map((row) => [row.getAttribute("data-kind"), row.classList.contains("is-dim"), row.textContent]);
    expect(rows).toEqual([
      ["said", false, "변경마다 한 줄 요약을 붙이는 중"],
      ["tools", true, "도구 사용 4번"],
      ["said", false, "요약을 표로 옮기는 중 ×3"],
    ]);
    expect(going.querySelector("[data-testid=timeline-result]")).toBeNull();
    const text = screenText(view.getByTestId("timeline"));
    expect(text).not.toMatch(/Running|npm|packages|3f2a1c9|run 3/);
    expect(text).not.toContain("가린 문장");
  });

  test("a round with no start on record shows one dim line at its top; the owner's comments show with author and time", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const blocks = view.getAllByTestId("timeline-block");
    expect(blocks[4].querySelector("[data-testid=timeline-no-start]")?.textContent).toBe("시작 기록 없음");
    expect(blocks[4].querySelector("[data-testid=timeline-result]")?.textContent).toBe("결과병합된 변경 41개를 모음");
    // The owner asked for the doc-only group between rounds 1 and 2, before round 2 did it.
    expect(blocks[3].querySelector(".timeline-text")?.textContent).toBe("문서만 바뀐 변경은 따로 묶어 주세요.");
    expect(blocks[1].querySelector(".timeline-text")?.textContent).toBe("변경 목록은 표로 보여 주세요");
    // A comment's own block already carries its time in the head; the row names its author only.
    expect(blocks[1].querySelector(".sub")?.textContent).toBe("나");
    expect(blocks[2].querySelector(".sub")?.textContent).toMatch(/^나 · (어제 )?\d\d:\d\d$/);
    expect(blocks[2].querySelector(".timeline-text")?.textContent).toBe("변경마다 한 줄 요약을 붙여 주세요");
  });

  test("a run's own page shows its timeline; a raw result line is left out and the round keeps its head", async () => {
    const view = await open("#/runs/r6", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const block = view.getByTestId("timeline-block");
    expect(block.getAttribute("data-outcome")).toBe("ended");
    expect(block.querySelector(".timeline-head")?.textContent).toMatch(/^라운드 1 · (어제 )?\d\d:\d\d–(어제 )?\d\d:\d\d · 작업 마침$/);
    expect(block.querySelector("[data-testid=timeline-result]")).toBeNull();
    expect(block.querySelector(".timeline-rows")).toBeNull();
    const text = screenText(view.getByTestId("timeline"));
    expect(text).not.toMatch(/index-structure|benchmark|3f2a1c9/);
    expect(text).not.toContain("가린 문장");
  });

  test("a worker run a card started opens its own page from the card even though the board does not list it", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const link = view.getByTestId("timeline").querySelector('a[href="#/runs/r1"]') as HTMLAnchorElement;
    expect(link.textContent).toMatch(/^라운드 3 · /);
    view.unmount();
    const run = await open("#/runs/r1", { wide: true });
    await waitFor(() => expect(run.getByTestId("timeline")).toBeTruthy());
    expect(run.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("코드 작업");
    expect(run.getByTestId("screen-run").querySelector('a[href="#/cards/k-101"]')).not.toBeNull();
  });

  test("a worker change event refetches that run's record in place: the new line shows, the blocks and their open state stay", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/cards/k-101", { wide: true, source });
      await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
      const blocks = view.getAllByTestId("timeline-block");
      const older = blocks[2] as HTMLDetailsElement;
      older.open = false;
      fireEvent(older, new Event("toggle"));
      const read = vi.spyOn(source, "read");
      source.recordSays("r1", "표 형식으로 바꾸는 중");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 2);
      });
      await waitFor(() => expect(view.getAllByTestId("timeline-block")[0].textContent).toContain("표 형식으로 바꾸는 중"));
      expect(read.mock.calls.some(([name, id]) => name === "record" && id === "r1")).toBe(true);
      expect(view.getAllByTestId("timeline-block")[0]).toBe(blocks[0]);
      expect((view.getAllByTestId("timeline-block")[2] as HTMLDetailsElement).open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failed record read shows one error line in the timeline's place; the rest of the detail keeps working", async () => {
    const view = await open("#/cards/k-101", { wide: true, source: new FailingSource((name) => (name === "record" ? "failed" : null)) });
    await waitFor(() => expect(view.getByTestId("timeline-error").textContent).toBe("읽기 실패: 기록"));
    expect(view.queryAllByTestId("timeline-block")).toHaveLength(0);
    // The worker links never disappear: 실행 stands under the error line.
    const boxes = [...view.getByTestId("screen-card").querySelectorAll(":scope > .box > .box-head")].map((head) => head.textContent);
    expect(boxes).toEqual(["지금", "할 일", "기록", "실행", "댓글"]);
    expect([...view.getByTestId("worker-runs").querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["#/runs/r1", "#/runs/r10", "#/runs/r9"]);
    expect(view.getByTestId("card-now").textContent).toContain("변경마다 한 줄 요약을 붙이는 중");
    expect(view.getAllByTestId("comment")).toHaveLength(4);
  });
});

describe("#13 audit, round 7", () => {
  beforeEach(() => setWide(true));

  test("an owner to-do an open decision targets by id shows once, as the decision, in the inbox, the sidebar and the bell", async () => {
    const source = new SyntheticSource();
    const board = source.scene.board;
    // T2 is a decision; the core also lists it as the owner's to-do, with its own notice.
    board.inbox.mine.push({ id: "T2", title: "배포 순서 정하기", waiting: false, due: null, agent: "ag-1" });
    board.notices.push({ key: "todo:T2:1", target: "T2", at: board.at - 60, kind: "todo", line: "배포 순서 정하기: 내 할 일", read: false });
    board.counts.unread = (board.counts.unread ?? 0) + 1;
    // A to-do with similar words but its own id stays.
    const view = await open("#/inbox", { wide: true, source });
    const inbox = view.getByTestId("screen-inbox");
    expect(inbox.querySelectorAll('a[href="#/items/T2"], button[aria-label*="배포를 금요일"]')).toHaveLength(1);
    expect(rowsIn(inbox)).toBe(SCENE_COUNTS.inbox);
    expect(count(view.getByTestId("nav-inbox").querySelector("[data-testid=nav-count]"))).toBe(SCENE_COUNTS.inbox);
    expect(view.getByRole("button", { name: `알림 ${SCENE_COUNTS.unread}` })).toBeTruthy();
  });

  test("an all-agent goal counts all agents' to-dos; an agent's view counts only its own, another agent's goal included", async () => {
    const all = await open("#/goals", { wide: true });
    const allLabel = all.container.querySelector('.list-pane a[href="#/goals/G5"]')?.getAttribute("aria-label");
    expect(allLabel).toMatch(/검색 속도 개선 · 0\/2$/);
    all.unmount();
    const owner = await open("#/agents/ag-2", { wide: true });
    expect(owner.getByTestId("section-goals").querySelector('a[href="#/goals/G5"]')?.getAttribute("aria-label")).toBe("검색 속도 개선 · 0/1");
    owner.unmount();
    const other = await open("#/agents/ag-3", { wide: true });
    const goals = other.getByTestId("section-goals");
    expect(goals.querySelector('a[href="#/goals/G5"]')?.getAttribute("aria-label")).toBe("검색 속도 개선 · 0/1");
    expect(rowsIn(goals)).toBe(count(other.getByTestId("agent-count-goals").querySelector(".count")));
  });

  test("a card's detail head names the goal it serves beside its state and reason", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    expect(view.getByTestId("card-goal").textContent).toBe("목표 · 결제 화면 개편");
    expect(view.container.querySelector(".detail-head [data-testid=state]")?.textContent).toBe("중단됨 · 응답 없음");
  });
});

describe("test environment teardown", () => {
  test("an effect left pending when the environment is torn down does not throw", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    function Pending() {
      const [ran, setRan] = useState(false);
      useEffect(() => setRan(true), []);
      return <span>{ran ? "ran" : "pending"}</span>;
    }

    // testing-library's render runs inside act, which flushes effects and their
    // after-paint flush. Rendering with preact directly leaves the effect in
    // preact's after-paint queue, as a test that ends mid-update does.
    renderPreact(<Pending />, container);

    // The same flush src/test-setup.ts runs before a file's environment goes.
    // The setup before this fix had no such step, so the effect is still
    // pending below and its fallback timer throws once the globals are gone.
    const { flushAfterPaint } = (await import("./test-setup")) as {
      flushAfterPaint?: () => Promise<void>;
    };
    await flushAfterPaint?.();

    // vitest's jsdom teardown deletes the window globals. A preact fallback
    // timer still pending then calls cancelAnimationFrame and throws, which
    // vitest reports as an unhandled error and fails the run for.
    const cancelAnimationFrame = globalThis.cancelAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: typeof globalThis.cancelAnimationFrame }).cancelAnimationFrame;
    let text: string | null;
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      text = container.textContent;
    } finally {
      globalThis.cancelAnimationFrame = cancelAnimationFrame;
      renderPreact(null, container);
      container.remove();
    }

    expect(text).toBe("ran");
    expect(flushAfterPaint).toBeTypeOf("function");
  });
});
