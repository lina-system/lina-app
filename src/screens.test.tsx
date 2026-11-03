import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RouteName } from "./api/client";
import { App } from "./app";
import { SYNTHETIC_REPLY_AFTER, SyntheticSource } from "./data/synthetic-source";
import type { ReadResult, Source } from "./data/source";
import { Store } from "./data/store";
import { SCENE_COUNTS } from "./fixtures/synthetic";
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
    expect(labels[0]).toMatch(/^Claude · 72% · 시간당 \+9% · \d시간 후 · 주의$/);
    expect(labels[1]).toMatch(/^ChatGPT · 31% · 시간당 \+2% · \d일 후$/);
    expect(labels[2]).toMatch(/^가온셈 · 5% · \d+일 후$/);
    expect(services.map((row) => (row.querySelector("details") as HTMLDetailsElement).open)).toEqual([false, false, false]);
    expect(services.map((row) => row.querySelectorAll("[data-testid=account]").length)).toEqual([2, 1, 1]);
    expect(services[0].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toMatch(/^계정 1 · 72% · 시간당 \+9% · \d시간 후 · 주의$/);
    expect(services[2].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toMatch(/^계정 1 · 일시 정지 · 5% · \d+일 후$/);
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

  test("the device line counts machine rows and the bell counts notices", async () => {
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
    expect(rowsIn(view.getByTestId("notices"))).toBe(bell);
    expect(bell).toBe(SCENE_COUNTS.notices);
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
    const rows = [...inbox.getByRole("list", { name: "결정 필요" }).querySelectorAll("a")].map((link) => ({
      href: link.getAttribute("href") ?? "",
      text: link.querySelector(".title")?.textContent ?? "",
      context: link.querySelector(".context")?.textContent ?? "",
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
