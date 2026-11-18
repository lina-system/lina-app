import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import type { RunRecord } from "./api/client";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// Criterion 2 (the real hub, 11-17): every line of a card's 기록 reads `time · one sentence`. A round whose report and
// rows hold no sentence a now line would pass (lina-app#269) read its outcome word alone (`09:05 · 검토 통과`); it now reads its outcome's
// one fixed sentence. What does not stand whole is one folded line after the last round, never a line between two
// rounds, and it still opens to every text as written (a report the whole-text gate refuses folds even when its head reads its sentence).
// Every text is made up.

type Round = RunRecord["rounds"][number];

const NOW = Math.floor(Date.now() / 1000);
const END = NOW - 2 * 3600;
const LONG = "가상 목록 화면의 머리 줄과 아래 줄 사이 간격을 두 폭에서 모두 같은 값으로 맞추고, 펼친 줄이 닫힌 줄을 밀어내지 않게 고쳐서 두 화면을 다시 찍어 비교한 뒤 차이가 없는 것을 확인했다.";
const BRANCH = "가짜 브랜치 `omo/OT-FAKE0505`에 커밋 하나.";
const CLOSED = "가짜 카드 t_ab12cd34를 닫았다.";
const PLAYWRIGHT = "Playwright로 두 폭 화면을 다시 찍었다.";
const ASK = "Ask: fake round four - wanted: two fake captures.";
const TIME = String.raw`(?:어제 |\d+월 \d+일 )?\d\d:\d\d`;
const OUTCOME_WORDS = Object.values(W.outcome);

function round(run: number, fields: Partial<Round>): Round {
  const endedAt = END - (6 - run) * 40 * 60;
  return { run, startedAt: endedAt - 9 * 60, endedAt, endKnown: true, startUnknown: false, result: null, verdict: "accepted", stopped: false, rows: [], ...fields };
}

const ROUNDS = [
  round(6, {}),
  round(5, { result: BRANCH, verdict: null, stopped: true }),
  round(4, { result: PLAYWRIGHT, verdict: "rejected", rows: [{ at: END - 2 * 40 * 60 - 5 * 60, kind: "said", text: ASK, count: 1 }] }),
  round(3, { result: CLOSED }),
  round(2, { result: LONG, verdict: null }),
  round(1, {}),
];

function scene(rounds: readonly Round[] = ROUNDS) {
  const base = new SyntheticSource({ now: NOW }).scene;
  const done = base.cardDetails["k-105"];
  const record: RunRecord = { ...base.records.r1, id: "r5", at: NOW, cardId: "k-105", rounds: [...rounds], comments: [], errors: [] };
  return {
    ...base,
    cardDetails: { ...base.cardDetails, "k-105": { ...done, workerRuns: done.workerRuns.map((worker) => ({ ...worker, firstSeenAt: END - 6 * 40 * 60 })) } },
    records: { ...base.records, r5: record },
  };
}

/**
 * The hub's big card in its shape (made-up words): many worker runs, each serving its own record of one round whose
 * report opens on a branch line and closes on what was not done, its said row a tail that opens with an English lead-in,
 * and the bots' comments on the card made as rounds ended, each holding an id or a word the screens never use.
 */
function hubScene() {
  const base = new SyntheticSource({ now: NOW }).scene;
  const done = base.cardDetails["k-105"];
  const runs = Array.from({ length: 12 }, (_, index) => ({ id: `w-91${String(index).padStart(2, "0")}`, end: END - index * 50 * 60 }));
  const records = runs.map(({ id, end }, index): RunRecord => ({
    ...base.records.r1,
    id,
    at: end,
    cardId: "k-105",
    rounds: [
      {
        run: 1,
        startedAt: end - 30 * 60,
        endedAt: end,
        endKnown: true,
        startUnknown: false,
        result: index % 4 === 1 ? "가상 표의 열 너비를 맞췄다." : `브랜치 \`omo/OT-FAKE09${index}\` (기준 dev \`a1b2c3d\`). 푸시와 PR은 하지 않았습니다.`,
        verdict: index % 5 === 3 ? null : index % 6 === 4 ? "rejected" : "accepted",
        stopped: index % 5 === 3,
        rows: [{ at: end - 60, kind: "said", text: `Ask: fake run ${index} - wanted: fake things. For you: done.`, count: 1 }],
      },
    ],
    comments: [],
    errors: [],
  }));
  const comments = runs.map(({ end }, index) => ({ id: 9100 + index, author: "worker-a", body: `가짜 일꾼 OT-FAKE09${index} 결과를 받음.`, createdAt: end + 120 }));
  const detail = {
    ...done,
    comments: [...done.comments, ...comments],
    workerRuns: runs.map(({ id, end }) => ({ id, kind: "omo" as const, firstSeenAt: end - 30 * 60, lastSeenAt: end })),
  };
  return { ...base, cardDetails: { ...base.cardDetails, "k-105": detail }, records: { ...base.records, ...Object.fromEntries(records.map((record) => [record.id, record])) } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(wide: boolean, made: SyntheticSource["scene"], blocks: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/cards/k-105");
  const view = render(<App store={new Store(new SyntheticSource({ now: NOW, scene: made }))} />);
  await waitFor(() => expect(view.getAllByTestId("timeline-block")).toHaveLength(blocks));
  return view;
}

const heads = (view: ReturnType<typeof render>): string[] => view.getAllByTestId("timeline-block").map((block: HTMLElement) => block.querySelector(".timeline-head")?.textContent ?? "");
const words = (head: string) => head.replace(new RegExp(`^${TIME} · `), "");
/** The 기록 box's lines in the order they stand: each round's head (`head`) and each folded line (`fold`). */
const order = (view: ReturnType<typeof render>) => [...view.getByTestId("timeline").querySelectorAll(".timeline-head, .fold-toggle")].map((line) => (line.classList.contains("fold-toggle") ? "fold" : "head"));

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a round with no whole sentence reads its outcome's one sentence, never its outcome word alone (${width})`, async () => {
    const view = await open(wide, scene(), 6);
    expect(heads(view).map(words)).toEqual(["검토를 통과했다", "작업이 중단됐다", "검토를 통과하지 못했다", "검토를 통과했다", "작업을 마쳤다", "검토를 통과했다"]);
    for (const head of heads(view)) {
      expect(head).toMatch(new RegExp(`^${TIME} · `));
      expect(OUTCOME_WORDS).not.toContain(words(head));
    }
    const text = view.getByTestId("timeline").textContent ?? "";
    expect(text).not.toMatch(/t_ab12cd34|OT-FAKE|omo\/|Ask:|Playwright|…/);
  });

  test(`a sentence longer than a now line folds, and the folded texts are one line after the last round that opens to them as written (${width})`, async () => {
    const view = await open(wide, scene(), 6);
    expect(heads(view).some((head) => head.includes(LONG))).toBe(false);
    expect(order(view)).toEqual(["head", "head", "head", "head", "head", "head", "fold"]);
    const fold = within(view.getByTestId("timeline")).getByRole("button", { name: new RegExp(`^${TIME} · 접힌 기록 5건$`) });
    fireEvent.click(fold);
    expect(within(view.getByTestId("timeline")).getAllByTestId("held-text").map((held) => held.textContent)).toEqual([BRANCH, PLAYWRIGHT, ASK, CLOSED, LONG]);
  });

  test(`the hub's big card shape reads time · one sentence on every round line, with one folded line at its end (${width})`, async () => {
    // A round with a sentence never counts the bare rounds after it (lina-app#269): only two bare ones in a row are one line.
    const view = await open(wide, hubScene(), 11);
    const lines = heads(view);
    for (const head of lines) {
      expect(head).toMatch(new RegExp(`^${TIME} · \\S`));
      expect(OUTCOME_WORDS).not.toContain(words(head).replace(/ ×\d+$/, ""));
    }
    expect(lines.filter((head) => head.includes("가상 표의 열 너비를 맞췄다."))).toHaveLength(3);
    const lineOrder = order(view);
    expect(lineOrder.filter((line) => line === "fold")).toHaveLength(1);
    expect(lineOrder.at(-1)).toBe("fold");
    expect(view.getByTestId("timeline").textContent ?? "").not.toMatch(/OT-FAKE|omo\/|a1b2c3d|Ask:|For you/);
  });

  test(`a card whose runs hold no record lists its rounds with a line first and the rest as one 이전 기록 line after them (${width})`, async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
    const base = new SyntheticSource({ now: NOW }).scene;
    const done = base.cardDetails["k-105"];
    const spans = [3, 2, 1].map((n) => ({ n, start: END - n * 3600, end: END - n * 3600 + 600 }));
    const runs = spans.map(({ n, start, end }) => ({ id: n, profile: null, status: "done", outcome: null, startedAt: start, endedAt: end, lastHeartbeatAt: end, summary: n === 2 ? "가상 알림 문구를 두 줄로 나눴다." : "OT-FAKE0404 omo/OT-FAKE0404", live: false }));
    const detail = { ...done, runs, workerRuns: spans.map(({ n, start }) => ({ ...done.workerRuns[0], id: `w-92${n}`, firstSeenAt: start + 30 })) };
    window.history.replaceState(null, "", "/app/#/cards/k-105");
    const view = render(<App store={new Store(new SyntheticSource({ now: NOW, scene: { ...base, cardDetails: { ...base.cardDetails, "k-105": detail as typeof done } } }))} />);
    await waitFor(() => expect(view.getAllByTestId("round")).toHaveLength(3));
    const box = view.getByTestId("worker-runs");
    const lines = [...box.querySelectorAll(".round-line, .round-fold > summary")].map((line) => line.textContent);
    expect(lines).toEqual(["가상 알림 문구를 두 줄로 나눴다.", "이전 기록 2건"]);
  });
}
