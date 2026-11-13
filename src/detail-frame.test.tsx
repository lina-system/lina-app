import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ItemDetail } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { navigate } from "./router";

// lina-app#142: one detail frame, back keeps the place, one-line history rows, one stop reason on row and detail.

const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const EVENT = new RegExp(`^${TIME} · \\S[^\\n]*$`);

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, options: { wide: boolean; source?: SyntheticSource }) {
  setWide(options.wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = options.source ?? new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  return view;
}

/** The one frame a detail opens in, and the detail inside it once it has read. */
async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
  });
}

const currentTab = (view: ReturnType<typeof render>) => view.getByTestId("tabs").querySelector("[aria-current=page]")?.getAttribute("data-testid");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  ["1280", true, "panel"],
  ["390", false, "sheet"],
] as const)("the detail frame at %s", (_width, wide, kind) => {
  test("a to-do on the home opens in the frame; the tab, the header and the list stay", async () => {
    const view = await open("#/", { wide });
    const title = view.getByTestId("screen-title").textContent;
    // The owner's to-dos are folded to one line on the home (lina-app#141): the owner opens them first.
    fireEvent.click(view.getByTestId("home-mine").querySelector(".row-button") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("screen-running").querySelector("a[href^='#/items/']")).not.toBeNull());
    const todo = view.getByTestId("screen-running").querySelector("a[href^='#/items/']") as HTMLElement;
    fireEvent.click(todo);
    const shown = await frame(view);
    expect(shown.getAttribute("data-frame")).toBe(kind);
    expect(view.getByTestId("screen-title").textContent).toBe(title);
    expect(view.container.querySelector("[data-testid=screen-running]")).not.toBeNull();
    expect(view.container.querySelector("[data-testid=screen-inbox]")).toBeNull();
    expect(currentTab(view)).toBe("tab-work");
  });

  test("a goal opens in the frame over 목표; back closes the frame and the tapped row stays highlighted", async () => {
    const view = await open("#/goals", { wide });
    const row = view.getByTestId("screen-goals").querySelector("a[href^='#/goals/']") as HTMLElement;
    const target = row.getAttribute("href");
    fireEvent.click(row);
    const shown = await frame(view);
    expect(shown.getAttribute("data-frame")).toBe(kind);
    expect(within(shown).getByTestId("screen-goal")).toBeTruthy();
    expect(view.getByTestId("screen-title").textContent).toBe("목표");
    await goBack();
    await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
    expect(view.getByTestId("screen-title").textContent).toBe("목표");
    expect(view.getByTestId("screen-goals").querySelector(`a[href="${target}"]`)?.getAttribute("aria-current")).toBe("page");
  });

  test("every kind opens in the same frame: a work card, a run, a to-do, a goal and a decision's record", async () => {
    for (const hash of ["#/cards/k-101", "#/runs/r6", "#/items/T4", "#/goals/G2", "#/items/T2"]) {
      const view = await open("#/running", { wide });
      fireEvent.click(view.getByTestId("screen-running").querySelector("[data-testid=row] a") as HTMLElement);
      await frame(view);
      // The next one opens from inside the frame, as a link in a detail does.
      act(() => navigate(hash));
      const shown = await frame(view);
      expect(shown.getAttribute("data-frame"), hash).toBe(kind);
      expect(view.container.querySelectorAll("[data-testid=detail-frame]"), hash).toHaveLength(1);
      expect(view.container.querySelector("[data-testid=screen-running]"), hash).not.toBeNull();
      view.unmount();
    }
  }, 30_000);
});

test("a goal chosen on an agent's card in 대화 opens in the frame and keeps 대화", async () => {
  const view = await open("#/talk/ag-1", { wide: true });
  // The card's goal rows open under 대화 (`#/talk/<agent>?goal=<id>`, lina-app#143).
  const goalLink = "[data-testid=section-goals] a[href^='#/talk/ag-1?goal=']";
  await waitFor(() => expect(view.getByTestId("card-pane").querySelector(goalLink)).not.toBeNull());
  fireEvent.click(view.getByTestId("card-pane").querySelector(goalLink) as HTMLElement);
  const shown = await frame(view);
  expect(shown.getAttribute("data-frame")).toBe("panel");
  expect(window.location.hash).toMatch(/^#\/talk\/ag-1\?goal=/);
  expect(currentTab(view)).toBe("tab-talk");
  expect(view.container.querySelector(".talk-pane")).not.toBeNull();
  await goBack();
  await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
  expect(view.getByTestId("card-pane")).toBeTruthy();
});

describe("history rows (lina-app#123)", () => {
  test("a card's rounds read time · what happened, with the result sentence when there is one", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const heads = view.getAllByTestId("timeline-block").map((block) => block.querySelector(".timeline-head")?.textContent ?? "");
    const rounds = heads.filter((head) => head !== "댓글");
    for (const head of rounds) expect(head).toMatch(EVENT);
    expect(rounds).toContainEqual(expect.stringMatching(new RegExp(`^${TIME} · 완료 · 병합된 변경 41개를 모음$`)));
    // Every line under a head is one line too: a comment row carries no author line of its own.
    for (const row of view.getByTestId("timeline").querySelectorAll("li.timeline-row")) expect(row.textContent).toMatch(EVENT);
  });

  test("a card's worker runs do not repeat the card's title on every line", async () => {
    const view = await open("#/cards/k-104", { wide: false });
    const shown = await frame(view);
    const title = shown.querySelector(".detail-title")?.textContent ?? "";
    const lines = within(within(shown).getByTestId("worker-runs")).getAllByRole("link");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.textContent).not.toContain(title);
  });

  test("a goal with a merge, a question, a close, comments and runs lists one row per event in time order", async () => {
    const base = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const { scene } = base;
    const now = scene.now;
    const goal = scene.itemDetails.G4;
    const owner = scene.items.owner?.id ?? "";
    const G4: ItemDetail = {
      ...goal,
      comments: [{ cid: "c1", by: owner, at: now - 30 * 3600, text: "첫 화면 문구는 짧게 해 주세요. 자세한 건 docs/guide.md 참고", status: "resolved", kind: "comment", replies: [] }],
      decision: { text: "가이드를 문서 사이트 첫 화면에 걸지 결정 필요", kind: "ask", at: now - 29 * 3600, answered: true, choices: [], recommended: null, cid: null },
      runs: [{ id: "r-g4", title: "guide", state: "done", reason: null, startedAt: now - 28 * 3600, endedAt: now - 27 * 3600 }],
    };
    const source = new SyntheticSource({ now, scene: { ...scene, itemDetails: { ...scene.itemDetails, G4 } } });
    const view = await open("#/goals/G4", { wide: true, source });
    await frame(view);
    const rows = within(view.getByTestId("goal-history")).getAllByTestId("history-row");
    for (const row of rows) expect(row.textContent).toMatch(EVENT);
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual(["comment", "question", "run", "merge", "close"]);
    expect(rows.map((row) => (row.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""))).toEqual([
      "첫 화면 문구는 짧게 해 주세요.",
      "질문: 가이드를 문서 사이트 첫 화면에 걸지 결정 필요",
      "완료",
      "새 가이드를 문서 사이트에 올리고 첫 화면에 연결함",
      "완료",
    ]);
  });
});

describe("one stop reason on the row and its detail", () => {
  test("each stopped row on the home reads the same words and time as its detail's head", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true });
    const home = await open("#/running", { wide: true, source });
    const rows = [...within(home.getByTestId("screen-running")).getByRole("list", { name: "중단됨" }).querySelectorAll(":scope > [data-testid=row]")].map((row) => ({
      href: row.querySelector("a")?.getAttribute("href") ?? "",
      state: row.querySelector("[data-testid=state]")?.textContent ?? "",
      time: row.querySelector(".time")?.textContent ?? "",
    }));
    home.unmount();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      const view = await open(row.href, { wide: true, source: new SyntheticSource({ now: source.scene.now, endedRuns: true }) });
      const head = (await frame(view)).querySelector(".detail-head") as Element;
      await waitFor(() => expect(head.querySelector("[data-testid=state]")?.textContent, row.href).toBe(row.state));
      expect(head.querySelector(".time")?.textContent ?? "", row.href).toBe(row.time);
      view.unmount();
    }
  }, 30_000);
});

describe("a disabled control says why", () => {
  test("보내기 under a comment field says why while it cannot send, and nothing once it can", async () => {
    const view = await open("#/items/T4", { wide: true });
    const comments = within(await frame(view)).getByTestId("comments");
    const send = within(comments).getByRole("button", { name: "보내기" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(within(comments).getByTestId("send-why").textContent).toBe("글 입력 대기");
    fireEvent.input(within(comments).getByRole("textbox", { name: "댓글 달기" }), { target: { value: "가로 화면도 봐 주세요" } });
    await waitFor(() => expect(send.disabled).toBe(false));
    expect(within(comments).queryByTestId("send-why")).toBeNull();
  });

  test("a stopped card that waits on the owner has an answer place in its detail, with the same rule", async () => {
    const view = await open("#/cards/k-112", { wide: true, source: new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true }) });
    const answer = within(await frame(view)).getByTestId("card-answer");
    const send = within(answer).getByRole("button", { name: "보내기" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(within(answer).getByTestId("send-why").textContent).toBe("글 입력 대기");
    fireEvent.input(within(answer).getByRole("textbox", { name: "답 달기" }), { target: { value: "목요일 먼저 배포" } });
    await waitFor(() => expect(send.disabled).toBe(false));
    expect(within(answer).queryByTestId("send-why")).toBeNull();
  });

  test("a stopped card that waits on someone else has no answer place", async () => {
    const view = await open("#/cards/k-110", { wide: true, source: new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true }) });
    expect(within(await frame(view)).queryByTestId("card-answer")).toBeNull();
  });
});
