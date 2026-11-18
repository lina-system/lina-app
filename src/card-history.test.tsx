import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import type { RunRecord } from "./api/client";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND26, SyntheticSource } from "./data/synthetic-source";
import { cardHistory } from "./model/timeline";
import { W } from "./words";

// G138, lina-app#269 (the hub's card records, 11-18): a card's 기록 read `검토를 통과했다` and `검토 통과 ×3 · ...`, its
// rounds' verdicts, and never what each step did. Its lines are now the core's steps (`plain.history`), `time · what it
// did`, each round's verdict a small mark beside the step it ended in. Every text is made up.

const NOW = Math.floor(Date.now() / 1000);
const TIME = String.raw`(?:어제 |\d+월 \d+일 )?\d\d:\d\d`;
const VERDICTS = [...Object.values(W.outcome), ...Object.values(W.outcomeSaid)];

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function open(id: string, source = new SyntheticSource({ now: NOW, hubRound26: true })) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/#/cards/${id}`);
  return { view: render(<App store={new Store(source)} />), source };
}

const texts = (view: ReturnType<typeof render>) => view.queryAllByTestId("history-line").map((line: HTMLElement) => (line.querySelector(".timeline-text")?.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));

const round = (run: number, endedAt: number, verdict: "accepted" | "rejected"): RunRecord["rounds"][number] => ({ run, startedAt: endedAt - 600, endedAt, endKnown: true, startUnknown: false, result: null, verdict, stopped: false, rows: [] });
const records = (rounds: RunRecord["rounds"]) => [{ id: "w-1", record: { id: "w-1", cardId: "k-1", at: NOW, rounds, comments: [], errors: [] } as unknown as RunRecord }];
const step = (minutes: number, text: string, until: number | null = null) => ({ at: NOW - minutes * 60, until: until === null ? null : NOW - until * 60, text });

test("(a) a card's record lines are its steps, time · what it did, and no verdict word is a line", async () => {
  const { view } = open(ROUND26.done.id);
  await waitFor(() => expect(view.getAllByTestId("history-line")).toHaveLength(5));
  expect(texts(view)).toEqual([...ROUND26.done.history]);
  const record = view.getByTestId("timeline");
  expect(record.querySelectorAll(".timeline-head, [data-testid=timeline-block]")).toHaveLength(0);
  for (const line of texts(view)) for (const word of VERDICTS) expect(line).not.toContain(word);
});

test("(b) a round's verdict is a mark beside the step it ended in, and one with no step folds", async () => {
  const { view } = open(ROUND26.done.id);
  await waitFor(() => expect(view.getAllByTestId("history-mark")).toHaveLength(2));
  const marks = view.getAllByTestId("history-line").map((line) => [...line.querySelectorAll("[data-testid=history-mark]")].map((mark) => mark.textContent));
  expect(marks).toEqual([[], [W.outcome.accepted], [], [W.outcome.rejected], []]);
  const { lines, folded } = cardHistory([step(30, "가짜 표를 다시 맞춤", 10), step(60, "가짜 표를 처음 읽음", 30)], records([round(2, NOW - 20 * 60, "accepted"), round(1, NOW - 90 * 60, "rejected")]), () => false, NOW);
  expect(lines.map((line) => line.marks.map((mark) => mark.outcome))).toEqual([["accepted"], []]);
  expect(folded.map((row) => row.source)).toEqual([W.outcomeSaid.rejected]);
});

test("(c) a step with a Latin word or over 40 letters is no line and folds as written", () => {
  const latin = "fake-run 결과를 다시 읽음";
  const long = "가".repeat(39) + "함";
  expect([...long]).toHaveLength(40);
  const longer = "가".repeat(40) + "함";
  const { lines, folded } = cardHistory([step(10, latin), step(20, longer), step(30, long)], [], () => false, NOW);
  expect(lines.map((line) => line.text)).toEqual([long]);
  expect(folded.map((row) => [row.text, row.source])).toEqual([[null, latin], [null, longer]]);
});

test("(d) a card with no steps has no record line: its old record is one 이전 기록 fold, closed", async () => {
  for (const history of [undefined, []]) expect(cardHistory(history, records([round(1, NOW - 600, "accepted")]), () => false, NOW)).toEqual({ lines: [], folded: [] });
  const { view } = open(ROUND26.old.id);
  await waitFor(() => expect(view.getByTestId("earlier-records")).toBeTruthy());
  const fold = view.getByTestId("earlier-records") as HTMLDetailsElement;
  expect(fold.open).toBe(false);
  expect(view.getByTestId("earlier-records-head").textContent).toBe("이전 기록");
  expect(view.queryAllByTestId("history-line")).toHaveLength(0);
  expect(fold.querySelectorAll("[data-testid=timeline-block]").length).toBeGreaterThan(0);
  for (const block of view.getAllByTestId("timeline-block")) expect(fold.contains(block)).toBe(true);
});

test("(e) the same sentence twice in a row is one line at its newest time", () => {
  const { lines } = cardHistory([step(10, "가짜 검사를 다시 돌림", 5), step(20, "가짜 검사를 다시 돌림", 10), step(30, "가짜 목록을 읽음", 20), step(40, "가짜 검사를 다시 돌림", 30)], [], () => false, NOW);
  expect(lines.map((line) => [line.at, line.text])).toEqual([[NOW - 600, "가짜 검사를 다시 돌림"], [NOW - 1800, "가짜 목록을 읽음"], [NOW - 2400, "가짜 검사를 다시 돌림"]]);
});

test("(f) a step the card moves past while open is a new line on top, the lines below kept as drawn", async () => {
  const { view, source } = open(ROUND26.going.id);
  await waitFor(() => expect(view.getAllByTestId("history-line")).toHaveLength(3));
  expect(texts(view)).toEqual([...ROUND26.going.history]);
  const before = view.getAllByTestId("history-line");
  source.cardMovesOn(ROUND26.going.id, "가짜 안내 화면 둘을 다시 찍음", "가짜 화면을 카드에 올리는 중");
  await waitFor(() => expect(view.getAllByTestId("history-line")).toHaveLength(4), { timeout: 5000 });
  expect(texts(view)).toEqual(["가짜 안내 화면 둘을 다시 찍음", ...ROUND26.going.history]);
  expect(view.getAllByTestId("history-line").slice(1)).toEqual(before);
  expect(view.getByTestId("card-now").textContent).toContain("가짜 화면을 카드에 올리는 중");
});

test("a stopped card with steps alone reads them, never 아직 기록 없음 above them (G138)", async () => {
  const source = new SyntheticSource({ now: NOW, hubRound26: true });
  const [, bare] = ROUND26.stops;
  source.scene.cardDetails[bare.id].plain.history = [step(90, "가짜 연결 상태를 다시 살핌")];
  const { view } = open(bare.id, source);
  await waitFor(() => expect(view.getAllByTestId("history-line")).toHaveLength(1));
  expect(view.queryByTestId("card-nothing")).toBeNull();
});

test("a worker run going now that no step's mark links to stays a link under the steps, and a linked run is never drawn twice (G138)", async () => {
  const linked = open(ROUND26.going.id);
  await waitFor(() => expect(linked.view.getAllByTestId("history-mark")).toHaveLength(1));
  expect(linked.view.queryAllByTestId("history-run")).toHaveLength(0);
  linked.view.unmount();
  // The same card with only its round going now: no verdict, so no mark links its worker run.
  const source = new SyntheticSource({ now: NOW, hubRound26: true });
  const record = source.scene.records[ROUND26.going.run];
  record.rounds = record.rounds.filter((round) => round.endedAt === null);
  const { view } = open(ROUND26.going.id, source);
  await waitFor(() => expect(view.getAllByTestId("history-run")).toHaveLength(1));
  expect(view.getAllByTestId("history-line")).toHaveLength(ROUND26.going.history.length);
  expect(view.queryAllByTestId("history-mark")).toHaveLength(0);
  const run = view.getByTestId("history-run").querySelector("a")!;
  expect(run.getAttribute("href")).toBe(`#/cards/${ROUND26.going.id}/runs/1`);
  expect(run.textContent).toMatch(new RegExp(`^${TIME} · ${W.outcome.going}$`));
});
