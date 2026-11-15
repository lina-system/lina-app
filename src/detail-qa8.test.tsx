import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { TOAST_MS } from "./ui/actions";

// lina-app#166: the detail frame after UI QA round 8: a decision stays on screen while its answer waits for the toast,
// the desktop pane's 닫기 closes the pane however many records were opened in it, and no markdown marker or empty row
// reaches a history. Every title and sentence here is made up in the hub's shape; none is real.

const MIN = 60;
const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

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

const scene = () => new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;

for (const wide of [true, false]) {
  test(`item 1: while the answer's toast is up the head, the question, the answer and 답함 stay; undo brings the field back with the answer (${wide ? "1280" : "390"})`, async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
      const comments: unknown[] = [];
      const comment = source.comment.bind(source);
      source.comment = (...args) => {
        comments.push(args);
        return comment(...args);
      };
      const view = await open("#/inbox", source, wide);
      fireEvent.click(view.getByRole("link", { name: /자주 쓰는 검색어 열 개/ }));
      const item = await frame(view);
      const field = (await waitFor(() => within(item).getByRole("textbox", { name: "답 달기" }))) as HTMLInputElement;
      const title = item.querySelector(".detail-title")?.textContent ?? "";
      const question = item.querySelector("[data-testid=head-line]")?.textContent ?? "";
      expect(title).toContain(" › ");
      expect(question).toContain("자주 쓰는 검색어 열 개");
      field.value = "결제, 환불, 배송";
      fireEvent.input(field);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.getByTestId("toast").textContent).toBe("답함되돌리기");
      // The head is the one that was pressed: the goal name and the question stay; the state is 답함.
      expect(item.querySelector(".detail-title")?.textContent).toBe(title);
      expect(item.querySelector("[data-testid=head-line]")?.textContent).toBe(question);
      expect(item.querySelector(".detail-head [data-testid=state]")?.textContent).toBe("답함");
      expect(item.querySelector(".detail-head")?.textContent).not.toMatch(/결정 필요|피드백/);
      // The answer just sent stands where the question box stood, with no field to send it again.
      const sent = within(item).getByTestId("decision-answered");
      expect(sent.textContent).toContain("결제, 환불, 배송");
      expect(within(item).queryByRole("textbox", { name: "답 달기" })).toBeNull();
      // 되돌리기: the question box and the field are back, holding the answer that was not sent.
      fireEvent.click(view.getByRole("button", { name: "되돌리기" }));
      within(item).getByTestId("decision");
      expect((within(item).getByRole("textbox", { name: "답 달기" }) as HTMLInputElement).value).toBe("결제, 환불, 배송");
      expect(item.querySelector("[data-testid=head-line]")?.textContent).toBe(question);
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(comments).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
}

test("item 2: after A, then B chosen in the list, 닫기 and Esc close the pane at once and leave the list's scroll as it is", async () => {
  const view = await open("#/running", new SyntheticSource({ now: Math.floor(Date.now() / 1000) }));
  const list = () => view.container.querySelector<HTMLElement>(".list-pane")!;
  const row = (id: string) => view.container.querySelector<HTMLAnchorElement>(`.list-pane a[href='#/cards/${id}']`)!;
  for (const close of ["button", "escape"] as const) {
    fireEvent.click(row("k-101"));
    await frame(view);
    list().scrollTop = 120;
    fireEvent.click(row("k-104"));
    await waitFor(() => expect(window.location.hash).toBe("#/cards/k-104"));
    const pane = await frame(view);
    if (close === "button") fireEvent.click(within(pane.querySelector(".detail-head") as HTMLElement).getByRole("button", { name: "닫기" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(view.queryByTestId("detail-pane")).toBeNull());
    expect(window.location.hash).toBe("#/running");
    await waitFor(() => expect(document.activeElement).toBe(row("k-104")));
    expect(list().scrollTop).toBe(120);
  }
});

/** A card's record and comments, and a goal's comments, with markdown markers and entries that are only markers. */
function markedScene() {
  const base = scene();
  const now = base.now;
  const r1 = base.records.r1;
  const [going, sentBack, ...older] = r1.rounds;
  const said = (at: number, text: string) => ({ at, kind: "said" as const, text, count: 1 });
  const records = {
    ...base.records,
    r1: {
      ...r1,
      rounds: [
        { ...going, rows: [...going.rows, said(now - 5 * MIN, "**표 머리**를 짧게 고치는 중"), said(now - 4 * MIN, "   "), said(now - 3 * MIN, "** **")] },
        { ...sentBack, verdict: "accepted" as const, result: "**설정 파일 옮기기 (메모 이전 건너뜀)**" },
        ...older,
      ],
    },
  };
  const k101 = base.cardDetails["k-101"];
  const cardComment = (id: number, at: number, body: string) => ({ id, author: "owner", body, createdAt: at });
  const cardDetails = {
    ...base.cardDetails,
    "k-101": { ...k101, comments: [...k101.comments, cardComment(901, now - 2 * MIN, "**배포 순서**를 정해 주세요."), cardComment(902, now - MIN, "** **"), cardComment(903, now - 30, "  ")] },
  };
  const goal = Object.values(base.itemDetails).find((detail) => detail.kind === "goal")!;
  const goalComment = (cid: string, at: number, text: string) => ({ cid, by: "owner", at, text, status: "open" as const, kind: "comment" as const, replies: [] });
  const itemDetails = {
    ...base.itemDetails,
    [goal.id]: { ...goal, comments: [...goal.comments, goalComment("c901", now - 2 * MIN, "**굵게 쓴 말** 확인함."), goalComment("c902", now - MIN, "** **")] },
  };
  return { source: new SyntheticSource({ now, scene: { ...base, records, cardDetails, itemDetails } }), goal: goal.id, plainRows: k101.comments.length };
}

/** The history rows of a frame whose text after `time · ` is empty. */
const emptyRows = (root: HTMLElement) => [...root.querySelectorAll("li, .comment-text")].filter((row) => !(row.textContent ?? "").replace(new RegExp(`^${TIME}(?: · )?`), "").trim());

test("items 3 and 4: a card's 기록 and 댓글 show no markdown marker and no empty row; an entry of markers only is no row", async () => {
  const { source } = markedScene();
  const view = await open("#/cards/k-101", source);
  const card = await frame(view);
  await waitFor(() => within(card).getByTestId("timeline"));
  await waitFor(() => within(card).getByTestId("card-comments"));
  expect(card.textContent).not.toContain("*");
  expect(emptyRows(card)).toEqual([]);
  const heads = within(card).getAllByTestId("timeline-block").map((block) => block.querySelector(".timeline-head")?.textContent ?? "");
  expect(heads).toContainEqual(expect.stringMatching(new RegExp(`^${TIME} · 검토 통과 · 설정 파일 옮기기 \\(메모 이전 건너뜀\\)$`)));
  const said = [...card.querySelectorAll("[data-kind=said]")].map((row) => (row.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));
  expect(said[0]).toBe("표 머리를 짧게 고치는 중");
  const rows = [...within(card).getByTestId("card-comments").querySelectorAll("li")].map((row) => (row.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));
  expect(rows[0]).toBe("배포 순서를 정해 주세요.");
  expect(rows).not.toContain("접힌 댓글");
});

test("items 3 and 4: a goal's 기록 and its comments show no markdown marker, and a comment of markers only is no row", async () => {
  const { source, goal } = markedScene();
  const view = await open(`#/goals/${goal}`, source);
  const detail = await frame(view);
  const history = await waitFor(() => within(detail).getByTestId("goal-history"));
  expect(detail.textContent).not.toContain("*");
  expect(emptyRows(detail)).toEqual([]);
  const lines = [...history.querySelectorAll("li")].map((row) => (row.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));
  expect(lines[0]).toBe("굵게 쓴 말 확인함.");
  expect(lines).not.toContain("접힌 댓글");
  expect(within(detail).getByTestId("comments").textContent).toContain("굵게 쓴 말 확인함.");
});
