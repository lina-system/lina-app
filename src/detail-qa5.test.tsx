import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#153: the detail frame on scenes shaped like the real hub response (UI QA round 5): the head reads the name
// of the row that was tapped, a read-only card makes no claim on the owner, an answered decision reads 답함 with its
// question and answer, the history is in time order with no tags or repeated state words, the kind is never guessed
// as 코드, and a goal opened in 대화 adds no second talk box.

const MIN = 60;
const TIME = "(?:어제 |\\d+월 \\d+일 )?(\\d\\d):(\\d\\d)";
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

const scene = () => new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns: true });

/** As the real hub serves its board: every work card read-only, and a question on k-112, the card waiting on the owner. */
function readOnlyScene(): SyntheticSource {
  const { scene: base } = scene();
  const cards = base.cards.cards.map((card) => ({ ...card, readOnly: true }));
  const cardDetails = Object.fromEntries(Object.entries(base.cardDetails).map(([id, detail]) => [id, { ...detail, readOnly: true }]));
  const inbox = { ...base.inbox, questions: [...base.inbox.questions, { ...base.inbox.questions[0], cardId: "k-112", commentId: 9 }] };
  return new SyntheticSource({ now: base.now, scene: { ...base, cards: { cards }, cardDetails, inbox } });
}

/** Seconds since midnight of a history line's time, for checking the order. */
function clock(line: string): number {
  const match = LINE.exec(line);
  if (!match) throw new Error(`no time on ${JSON.stringify(line)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

test("item 1: the head reads the name of the row that was tapped; the card's own title is the line under it when it differs", async () => {
  const view = await open("#/running", scene());
  const links = [...view.getByTestId("screen-running").querySelectorAll<HTMLAnchorElement>("[data-testid=row] > a[href^='#/cards/']")];
  expect(links.length).toBeGreaterThan(2);
  let differs = 0;
  for (const hash of links.map((link) => link.getAttribute("href") ?? "")) {
    const link = view.getByTestId("screen-running").querySelector<HTMLAnchorElement>(`[data-testid=row] > a[href='${hash}']`);
    const rowTitle = link?.querySelector(".title")?.textContent ?? "";
    fireEvent.click(link!);
    const card = await frame(view);
    await waitFor(() => expect(card.querySelector("h1.detail-title")?.textContent, hash).toBe(rowTitle));
    const own = card.querySelector("[data-testid=card-own-title]")?.textContent ?? null;
    if (own !== null) {
      differs += 1;
      expect(own).not.toBe(rowTitle);
    }
  }
  // The scene has cards whose row leads with the goal's title (lina-app#122): their own title is under the head.
  expect(differs).toBeGreaterThan(0);
});

test("item 2: a read-only card says it cannot be changed here, in neutral words, and makes no claim that the owner must act", async () => {
  const view = await open("#/cards/k-112", readOnlyScene());
  const card = within(await frame(view));
  expect(card.getByTestId("read-only").textContent).toBe("읽기 전용 · 여기서는 바꿀 수 없음");
  expect(card.getByTestId("decision").textContent).toContain("카드 번호를 앞 여섯 자리까지 표시할지 결정 필요");
  expect(card.queryByRole("textbox")).toBeNull();
  const state = view.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")?.textContent ?? "";
  expect(state).toBe("중단됨");
  expect(view.getByTestId("detail-frame").textContent).not.toMatch(/칸반|확인 필요|피드백 대기/);
});

test("item 2: a writable card waiting on the owner keeps its answer box and its words of why it waits", async () => {
  const view = await open("#/cards/k-112", scene());
  const card = within(await frame(view));
  expect(card.getByTestId("card-answer")).toBeTruthy();
  expect(view.getByTestId("detail-frame").querySelector(".detail-head [data-testid=state]")?.textContent).toBe("중단됨 · 결정 대기 · 이유 기록 없음");
});

/** T2 as the real core serves it after the owner answered: still waiting on a decision, the decision answered, the answer stored as a comment of kind answer. */
function answeredScene(): { source: SyntheticSource; answeredAt: number } {
  const { scene: base } = scene();
  const answeredAt = base.now - 20 * MIN;
  const T2 = base.itemDetails.T2;
  const itemDetails = {
    ...base.itemDetails,
    T2: { ...T2, state: "waiting" as const, reason: "decision", decision: T2.decision ? { ...T2.decision, answered: true, cid: "n9" } : null, comments: [...T2.comments, { cid: "n9", by: base.items.owner?.id ?? "owner", at: answeredAt, text: "금요일 오후", status: "open" as const, kind: "answer" as const, replies: [] }] },
  };
  return { source: new SyntheticSource({ now: base.now, scene: { ...base, itemDetails } }), answeredAt };
}

test("item 3: an answered decision reads 답함 with the answer's time; its question and answer show together; the history has 질문에 답함", async () => {
  const { source } = answeredScene();
  const view = await open("#/items/T2", source);
  const item = await frame(view);
  const head = item.querySelector(".detail-head .sub")?.textContent ?? "";
  expect(head).toBe("답함 · 20분 전");
  expect(head).not.toContain("결정 필요");
  const answered = within(item).getByTestId("decision-answered");
  expect(answered.querySelector(".box-head")?.textContent).toBe("질문 · 답");
  expect(answered.textContent).toContain("배포를 금요일 오후에 할지 결정 필요");
  expect(answered.textContent).toContain("금요일 오후");
  expect(within(item).queryByTestId("decision")).toBeNull();
  expect(within(item).queryByTestId("decision-answer")).toBeNull();
  const history = [...within(item).getByTestId("item-history").querySelectorAll("[data-testid=history-row]")].map((row) => row.textContent ?? "");
  expect(history.filter((line) => line.replace(LINE, "") === "질문에 답함")).toHaveLength(1);
  for (const line of history) expect(line).toMatch(LINE);
});

/**
 * Comments as the real hub served one card (round 5; ids and roles in their shape, none real): bracket tags with a
 * role and a time, a whole sentence in brackets, a worker's 완료 four times in one minute, out of time order, and a
 * sentence holding another time than its own.
 */
function noisyComments(now: number) {
  const at = (minutesAgo: number) => Math.floor(now - minutesAgo * MIN);
  const rows: [number, string, string][] = [
    [30, "worker-a", "완료"],
    [30, "worker-a", "완료"],
    [31, "worker-a", "[검토자 02:21 결정] 배포는 금요일 오후로 함."],
    [30, "worker-a", "완료"],
    [30, "worker-a", "완료"],
    [45, "worker-a", "[작업자 04:40 코드 반영 끝, 시험 통과]"],
    [44, "worker-a", "[작업자 04:41 문구 정리, 화면 확인]"],
    [12, "worker-a", "22:45 기준으로 문구를 다시 확인함."],
    [60, "worker-a", "첫 화면 문구를 짧게 고쳤어요."],
    [59, "worker-a", "두 번째 화면도 같이 맞췄어요."],
  ];
  return rows.map(([ago, author, body], index) => ({ id: 300 + index, author, body, createdAt: at(ago) }));
}

test("item 4: a card's history is in time order, with no bracket tags, no repeated state word, dropped comments folded once and no time inside a sentence", async () => {
  const { scene: base } = scene();
  const cardDetails = { ...base.cardDetails, "k-103": { ...base.cardDetails["k-103"], comments: noisyComments(base.now) } };
  const view = await open("#/cards/k-103", new SyntheticSource({ now: base.now, scene: { ...base, cardDetails } }));
  await frame(view);
  const lines = within(view.getByTestId("card-comments"))
    .getAllByTestId("history-row")
    .map((row) => row.textContent ?? "");
  const texts = lines.map((line) => line.replace(LINE, ""));
  expect(texts).toEqual(["기준으로 문구를 다시 확인함.", "완료", "배포는 금요일 오후로 함.", "접힌 댓글 2건", "두 번째 화면도 같이 맞췄어요.", "첫 화면 문구를 짧게 고쳤어요."]);
  for (let index = 1; index < lines.length; index += 1) expect(clock(lines[index]), lines.join(" | ")).toBeLessThanOrEqual(clock(lines[index - 1]));
  for (const text of texts) expect(text).not.toMatch(/^\[|\d\d:\d\d/);
});

test("item 5: a card with no kind of its own shows no kind in its head, never 코드; a documents card keeps 문서", async () => {
  const plain = await open("#/cards/k-101", scene());
  const head = (await frame(plain)).querySelector(".detail-head");
  expect(head?.querySelector("[data-testid=kind]")).toBeNull();
  expect(head?.textContent).not.toContain("코드");
  plain.unmount();
  const docs = await open("#/cards/k-102", scene());
  expect((await frame(docs)).querySelector(".detail-head [data-testid=kind]")?.textContent).toBe("문서");
});

test("item 7: a goal opened in 대화 on a wide window adds no second talk box beside the agent's window", async () => {
  const view = await open("#/talk/ag-1?goal=G1", scene());
  await waitFor(() => expect(view.getByTestId("card-pane").querySelector("[data-testid=screen-goal]")).not.toBeNull());
  expect(view.getAllByRole("textbox", { name: "메시지" })).toHaveLength(1);
  expect(within(view.getByTestId("card-pane")).queryByRole("textbox", { name: "메시지" })).toBeNull();
});

test("item 7: on a phone the goal sheet in 대화 keeps its one talk box", async () => {
  const view = await open("#/talk/ag-1?goal=G1", scene(), false);
  await waitFor(() => expect(view.container.querySelector("[data-testid=screen-goal]")).not.toBeNull());
  expect(view.getAllByRole("textbox", { name: "메시지" })).toHaveLength(1);
});
