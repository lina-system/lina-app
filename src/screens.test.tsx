import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RouteName } from "./api/client";
import { App } from "./app";
import { SYNTHETIC_REPLY_AFTER, SyntheticSource } from "./data/synthetic-source";
import type { ReadResult, Source } from "./data/source";
import { Store } from "./data/store";
import { SCENE_COUNTS } from "./fixtures/synthetic";
import { buildModel } from "./model";
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
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toMatch(/^갱신 \d+초 전$/));
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

describe("machines and quota", () => {
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
      const list = view.container.querySelector(".list-pane .list");
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

  test("갱신 지연 after 30 s with no answer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      let answer = true;
      const view = await open("#/inbox", { wide: true, source: new FailingSource(() => (answer ? null : "failed")) });
      answer = false;
      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
    } finally {
      vi.useRealTimers();
    }
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
      const title = view.container.querySelector(".detail-title")?.textContent ?? "";
      expect(row.context === title || row.context.endsWith(` › ${title}`)).toBe(true);
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
      const send = view.getByRole("button", { name: "보내기" }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      field.value = "가로 폭도 봐 주세요";
      fireEvent.input(field);
      expect(send.disabled).toBe(false);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.getByTestId("comment-pending").textContent).toBe(`${agent}에게 보냄 · 방금`);
      expect((view.getByRole("button", { name: "보내기" }) as HTMLButtonElement).disabled).toBe(true);
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
  return view.getByRole("button", { name: new RegExp(text.replace(/[?.]/g, "\\$&")) });
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
  test("다시 시도 on a stopped card asks its to-do's agent and says so until the next refresh", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/running", { wide: true, source });
      const buttons = view.getAllByRole("button", { name: /다시 시도$/ });
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);
      await waitFor(() => expect(source.calls).toEqual(['retry ["T5"]']));
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
    const first = within(dialog).getAllByRole("link")[0];
    const target = first.getAttribute("href");
    fireEvent.click(first);
    expect(window.location.hash).toBe(target);
    expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy();
    await waitFor(() => expect(source.scene.board.notices.filter((notice) => !notice.read)).toHaveLength(4));
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

  test("a read on one device is the count on the other after its next refresh, both ways", async () => {
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
        vi.advanceTimersByTime(10_000);
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

  test("a refused read mark puts the notice back as unread with the core's line", async () => {
    const source = new SpySource();
    source.readNotices = async () => ({ ok: false, status: 429, detail: "too many writes" });
    const view = await open("#/inbox", { wide: true, source });
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByRole("button", { name: "모두 읽음" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("too many writes"));
    expect(view.getByRole("button", { name: "알림 5" })).toBeTruthy();
  });
});

function buildModelCount(store: Store): number {
  return buildModel(store.input(), Date.now() / 1000).counts.unread;
}
