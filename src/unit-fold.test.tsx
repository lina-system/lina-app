import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#241 on `&hub=round24`, the hub's long card shapes in made-up words: a folded line is a button that opens what
// it holds, whole and as written, with its time and its author's name; a stop reason is never cut; a record row that
// does not stand whole folds into a line that opens; an item's thread merges a repeated state word and says 접힌 댓글.

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), hubRound24: true });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return { view, frame: within(view.getByTestId("detail-frame")), scene: source.scene };
}

/** A history line less its time (`12:50 · `, or `어제 23:41 · ` before today). */
const lineText = (node: Element) => node.textContent?.replace(/^.*?\d{1,2}:\d{2} · /, "") ?? "";
const TIME = String.raw`^(?:\S+ )?\d{1,2}:\d{2}`;

test("a card's folded comments open to each comment whole, newest first, with its time and its author's name", async () => {
  const { frame, scene } = await open("#/cards/k-101");
  const box = frame.getByTestId("card-comments");
  const lines = within(box).getAllByTestId("history-row").map(lineText);
  expect(lines).toContain("가짜 검토를 마쳤고 병합해도 된다.");
  expect(lines).toContain("진행 중 ×2");
  const folds = within(box).getAllByRole("button", { expanded: false });
  expect(folds.map((button) => lineText(button))).toEqual(["접힌 댓글", "접힌 댓글", "접힌 댓글 2건"]);
  fireEvent.click(folds[2]);
  expect(folds[2].getAttribute("aria-expanded")).toBe("true");
  const held = within(box).getByTestId("fold-held");
  const bodies = [...held.querySelectorAll("[data-testid=held-text]")].map((node) => node.textContent);
  const card = scene.cardDetails["k-101"].comments;
  expect(bodies).toEqual([card.find((each) => each.id === 204)?.body, card.find((each) => each.id === 201)?.body]);
  const heads = [...held.querySelectorAll("[data-testid=held-head]")].map((node) => node.textContent ?? "");
  expect(heads.every((head) => new RegExp(`${TIME} · \\S`).test(head))).toBe(true);
  expect(held.textContent).not.toMatch(/lina-worker|dispatcher|받음|깨움/);
  fireEvent.click(within(held).getByRole("button", { name: "접기" }));
  expect(folds[2].getAttribute("aria-expanded")).toBe("false");
  expect(within(box).queryByTestId("fold-held")).toBeNull();
  expect(document.activeElement).toBe(folds[2]);
  // A note by an author the app has no name for opens with its time alone, never an id.
  fireEvent.click(folds[0]);
  expect(within(box).getByTestId("held-head").textContent).toMatch(new RegExp(`${TIME}$`));
});

test("an ended round's said rows and report lines that do not stand whole fold into 접힌 기록, which opens to them as written", async () => {
  const { frame, scene } = await open("#/cards/k-101");
  const timeline = frame.getByTestId("timeline");
  // The going round's live lines still stand; no line of an ended round is a fragment or joins events.
  const said = [...timeline.querySelectorAll("[data-kind=said]")].map(lineText);
  expect(said).toContain("변경마다 한 줄 요약을 붙이는 중");
  for (const line of said) expect(line).not.toMatch(/ \/ |^[.~]|\|$|[A-Za-z]/);
  const heads = [...timeline.querySelectorAll(".timeline-head")].map((node) => node.textContent ?? "");
  expect(heads).toContainEqual(expect.stringMatching(/검토 통과(?: ×\d+)? · 가짜 표를 다시 그렸다\.$/));
  for (const head of heads) expect(head).not.toMatch(/[A-Za-z]/);
  const folds = within(timeline).getAllByRole("button", { name: /접힌 기록/ });
  for (const fold of folds) fireEvent.click(fold);
  const opened = within(timeline).getAllByTestId("held-text").map((node) => node.textContent);
  for (const row of scene.records.r9.rounds.flatMap((round) => round.rows)) expect(opened).toContain(row.text);
  for (const round of scene.records.r9.rounds) if (round.result && round.result !== "가짜 표를 다시 그렸다.") expect(opened).toContain(round.result);
});
