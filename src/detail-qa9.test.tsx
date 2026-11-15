import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { LONG_STOP_REASON } from "./fixtures/synthetic";

// lina-app#171: UI QA round 9 on the detail frame, on the scene shaped like the hub's response (`&hub=round9`): every
// card read-only, a fold of three finished builds, a stopped card with no reason sentence and one whose ask the core
// cut while its inbox entry keeps the whole reason.

const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const LINE = new RegExp(`^${TIME} · `);

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, source: SyntheticSource, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound9: true });

/** The row of a list whose link opens this card. */
function rowOf(view: ReturnType<typeof render>, id: string): HTMLElement {
  const link = view.container.querySelector(`.list-pane a[href="#/cards/${id}"]`) as HTMLElement | null;
  if (!link?.parentElement) throw new Error(`no row for ${id}`);
  return link.parentElement;
}

test("a folded ×3 row's detail lists the three cards of the fold, the opened one first, each `time · state · sentence`", async () => {
  const view = await open("#/cards/k-131", hub());
  expect(rowOf(view, "k-131").textContent).toContain("×3");
  const lines = within(await frame(view)).getAllByTestId("fold-member").map((line) => line.textContent ?? "");
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toMatch(new RegExp(`^${TIME} · 완료 · `));
  expect(lines.map((line) => line.replace(LINE, ""))).toEqual(["완료 · 첫 화면 문구를 고친 빌드를 올림.", "완료 · 알림 줄을 고친 빌드를 올림.", "완료 · 목록 간격을 고친 빌드를 올림."]);
  view.unmount();
  // A card of the fold opened by its own link reads itself first, the rest newest first.
  const older = await open("#/cards/k-133", hub());
  const again = within(await frame(older)).getAllByTestId("fold-member").map((line) => (line.textContent ?? "").replace(LINE, ""));
  expect(again).toEqual(["완료 · 목록 간격을 고친 빌드를 올림.", "완료 · 첫 화면 문구를 고친 빌드를 올림.", "완료 · 알림 줄을 고친 빌드를 올림."]);
});

test("a card that is no fold lists no fold members, and group heads still count their rows", async () => {
  const view = await open("#/cards/k-105", hub());
  expect(within(await frame(view)).queryByTestId("fold-members")).toBeNull();
  for (const id of ["recent", "older", "stopped"]) {
    const head = view.queryByTestId(`head-${id}`);
    if (!head) continue;
    const section = head.closest("section") ?? head.parentElement!;
    const rows = section.querySelectorAll("[data-testid=row]").length;
    const more = Number(/외 (\d+)개/.exec(section.textContent ?? "")?.[1] ?? 0);
    const count = Number(within(head).queryByTestId("count")?.textContent ?? 0) + Number(within(head).queryByTestId("stopped-count")?.textContent ?? 0);
    expect(rows + more, id).toBe(count);
  }
});

test("a stopped read-only card with runs says its state and why once", async () => {
  const { scene } = new SyntheticSource({ now: now(), endedRuns: true });
  const cards = scene.cards.cards.map((card) => ({ ...card, readOnly: true }));
  const view = await open("#/cards/k-108", new SyntheticSource({ now: scene.now, scene: { ...scene, cards: { cards } } }));
  const card = await frame(view);
  expect(card.textContent?.match(/야간 보고서를 받을 사람/g)).toHaveLength(1);
  expect(card.textContent?.match(/확인 필요/g)).toHaveLength(1);
});

test("a card with folded comments and a record has one 댓글 heading", async () => {
  const { scene } = new SyntheticSource({ now: now() });
  const detail = scene.cardDetails["k-101"];
  const folded = [1, 2].map((n) => ({ id: 50 + n, author: "worker-a", body: "rc=1 t_27363156", createdAt: scene.now - n * 60 }));
  const cardDetails = { ...scene.cardDetails, "k-101": { ...detail, comments: [...detail.comments, ...folded] } };
  const view = await open("#/cards/k-101", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails } }));
  const card = await frame(view);
  await waitFor(() => expect(within(card).getByTestId("timeline")).toBeTruthy());
  const heads = [...card.querySelectorAll("h2, h3, summary")].filter((head) => head.textContent === "댓글");
  expect(heads).toHaveLength(1);
  expect(within(card).getByTestId("card-comments").textContent).toContain("접힌 댓글");
  expect(within(card).getByTestId("card-comments").textContent).toContain("변경 목록은 표로 보여 주세요");
});

test("a stopped row waiting on feedback with no reason sentence says 이유 기록 없음, in the row and the detail", async () => {
  const view = await open("#/cards/k-134", hub());
  expect(within(rowOf(view, "k-134")).getByTestId("state").textContent).toBe("중단됨 · 피드백 대기 · 이유 기록 없음");
  const card = within(await frame(view));
  expect(card.getByTestId("stop-why").textContent).toBe("피드백 대기 · 이유 기록 없음");
  expect(card.queryByText("initial_status", { exact: false })).toBeNull();
});

test("a long stop reason: the row cuts it at a word with …, the detail shows all of it", async () => {
  expect(LONG_STOP_REASON.length).toBeGreaterThanOrEqual(400);
  const view = await open("#/cards/k-135", hub());
  const state = within(rowOf(view, "k-135")).getByTestId("state").textContent ?? "";
  expect(state.startsWith("중단됨 · 결정 대기 · ")).toBe(true);
  const said = state.slice("중단됨 · 결정 대기 · ".length);
  expect(said.endsWith("…")).toBe(true);
  const kept = said.slice(0, -1);
  // Cut at a word: what is kept starts the reason and ends where a word of it ends.
  expect(LONG_STOP_REASON.startsWith(kept)).toBe(true);
  expect([" ", undefined]).toContain(LONG_STOP_REASON[kept.length]);
  expect([...kept].length).toBeLessThanOrEqual(40);
  const card = within(await frame(view));
  expect(card.getByTestId("stop-reason").textContent).toBe(LONG_STOP_REASON);
  expect(card.getByTestId("stop-reason").className).toContain("wrap-line");
});

test("a read-only card waiting on the owner names its agent and links to that agent's 대화; no write is added", async () => {
  const source = hub();
  const agent = source.scene.items.agents[1];
  const view = await open("#/cards/k-135", source);
  const card = within(await frame(view));
  expect(card.getByTestId("read-only").textContent).toBe("읽기 전용 · 여기서는 바꿀 수 없음");
  const where = card.getByTestId("answer-where");
  expect(where.textContent).toBe(`답할 곳 · ${agent.name} 대화`);
  expect(within(where).getByRole("link").getAttribute("href")).toBe(`#/talk/${agent.id}`);
  expect(card.queryByRole("textbox")).toBeNull();
  expect(card.queryByRole("button", { name: "보내기" })).toBeNull();
});

test("a read-only card whose owner the response does not give keeps the read-only line alone", async () => {
  const { scene } = hub();
  const cards = scene.cards.cards.map((card) => (card.id === "k-135" ? { ...card, agent: null } : card));
  const cardDetails = { ...scene.cardDetails, "k-135": { ...scene.cardDetails["k-135"], agent: null } };
  const view = await open("#/cards/k-135", new SyntheticSource({ now: scene.now, scene: { ...scene, cards: { cards }, cardDetails } }));
  const card = within(await frame(view));
  expect(card.getByTestId("read-only").textContent).toBe("읽기 전용 · 여기서는 바꿀 수 없음");
  expect(card.queryByTestId("answer-where")).toBeNull();
});
