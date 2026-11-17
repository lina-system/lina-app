import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import type { RunRecord } from "./api/client";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// Criterion 2 (the real hub, 11-17): a closed history line reads `time · one sentence`. A bot's report there holds a branch,
// a run id or a hash in every sentence it opens with, so its whole text never stands and the round read its outcome
// alone. The line reads the first whole sentence of what the round left that says what came of it: its report line,
// then the record's notes and the bots' comments made as it ended. A sentence is taken whole or not at all; an English
// tool name is a word like any other, an id, a path or a run of English words is not, and a sentence that says what was
// not done is no result. Every text is made up.

const NOW = Math.floor(Date.now() / 1000);
const END = NOW - 2 * 3600;
const LONG = "가상 목록 화면의 머리 줄과 아래 줄 사이 간격을 두 폭에서 모두 같은 값으로 맞추고, 펼친 줄이 닫힌 줄을 밀어내지 않게 고쳐서 두 화면을 다시 찍어 비교한 뒤 차이가 없는 것을 확인했다.";
const REPORT = "가짜 브랜치 `omo/OT-FAKE0101`에 커밋 하나. 푸시는 하지 않았다. 가상 검사를 통과해서 합쳤다.";

function scene() {
  const base = new SyntheticSource({ now: NOW }).scene;
  const done = base.cardDetails["k-105"];
  const round = (run: number, fields: Partial<RunRecord["rounds"][number]>): RunRecord["rounds"][number] => {
    const endedAt = END - (6 - run) * 40 * 60;
    return { run, startedAt: endedAt - 9 * 60, endedAt, endKnown: true, startUnknown: false, result: null, verdict: "accepted", stopped: false, rows: [], ...fields };
  };
  const rounds = [
    round(6, { result: REPORT }),
    round(5, { result: "가짜 카드 t_ab12cd34에 가상 결과를 남겼다. Playwright로 두 폭 화면을 다시 찍었다." }),
    round(4, { result: "가짜 보고를 Fake Review Bot 메모로 남겼다. 가짜 작업 t_cd34ef56을 닫았다.", verdict: "rejected" }),
    round(3, { result: `가짜 경로 \`notes/fake.md\`를 고쳤다. ${LONG}` }),
    round(2, { result: null }),
    round(1, { result: "Merged the fake change after both widths passed.", verdict: null, stopped: true }),
  ];
  const record: RunRecord = { ...base.records.r1, id: "r5", at: NOW, cardId: "k-105", rounds, comments: [], errors: [] };
  // A bot's comment made as round 2 ended: its stamp and its id line are no words of it, its sentence after them is.
  const comment = { id: 9001, author: "worker-a", body: "[가짜 이름 16:52] 가짜 작업 OT-FAKE0202 끝.\n가상 알림 문구를 두 줄로 나눴다.", createdAt: round(2, {}).endedAt! + 60 };
  return {
    ...base,
    cardDetails: { ...base.cardDetails, "k-105": { ...done, comments: [...done.comments, comment], workerRuns: done.workerRuns.map((worker) => ({ ...worker, firstSeenAt: END - 6 * 40 * 60 })) } },
    records: { ...base.records, r5: record },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/cards/k-105");
  const view = render(<App store={new Store(new SyntheticSource({ now: NOW, scene: scene() }))} />);
  await waitFor(() => expect(view.getAllByTestId("timeline-block").length).toBeGreaterThan(0));
  return view;
}

const TIME = String.raw`(?:어제 |\d+월 \d+일 )?\d\d:\d\d`;
const heads = (view: ReturnType<typeof render>): string[] => view.getAllByTestId("timeline-block").map((block: HTMLElement) => (block.querySelector(".timeline-head")?.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a closed round reads time · one whole sentence of what it left, an English tool name in it but no id (${width})`, async () => {
    const view = await open(wide);
    expect(heads(view)).toEqual([
      "검토 통과 · 가상 검사를 통과해서 합쳤다.",
      "검토 통과 · Playwright로 두 폭 화면을 다시 찍었다.",
      "검토를 통과하지 못했다",
      `검토 통과 · ${LONG}`,
      "검토 통과 · 가상 알림 문구를 두 줄로 나눴다.",
      "작업이 중단됐다",
    ]);
    for (const head of view.getAllByTestId("timeline-block").map((block) => block.querySelector(".timeline-head")!)) expect(head.textContent).toMatch(new RegExp(`^${TIME} · `));
    const text = view.getByTestId("timeline").textContent ?? "";
    expect(text).not.toMatch(/t_ab12cd34|t_cd34ef56|OT-FAKE|notes\/fake|Fake Review|Merged the fake|…/);
  });

  test(`a long sentence stands whole in its line and the timeline's one fold still opens to a round's report as written (${width})`, async () => {
    const view = await open(wide);
    const blocks = view.getAllByTestId("timeline-block");
    expect(blocks[3].querySelector(".timeline-head")?.textContent?.endsWith(LONG)).toBe(true);
    const fold = within(view.getByTestId("timeline")).getByRole("button", { name: /접힌 기록 5건$/ });
    fireEvent.click(fold);
    expect(within(view.getByTestId("timeline")).getAllByTestId("held-text")[0].textContent).toBe(REPORT);
  });
}

// PR #260 review: the card's own round lines read the same window. A bot's comment made after round 1 ended and before
// round 2 began is round 1's line; round 2's window starts at its own start, so it does not take it.
for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a card's round line never reads a comment made before that round began (${width})`, async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
    const base = new SyntheticSource({ now: NOW }).scene;
    const done = base.cardDetails["k-105"];
    const ID_ONLY = "OT-FAKE0303 omo/OT-FAKE0303";
    const first = { start: NOW - 5 * 3600, end: NOW - 5 * 3600 + 600 };
    const second = { start: first.end + 120, end: first.end + 130 };
    const run = (id: number, span: { start: number; end: number }) => ({ id, profile: null, status: "done", outcome: null, startedAt: span.start, endedAt: span.end, lastHeartbeatAt: span.end, summary: ID_ONLY, live: false });
    const comment = { id: 9002, author: "worker-a", body: "가상 알림 문구를 두 줄로 나눴다.", createdAt: first.end + 100 };
    // The worker runs hold no record, so the card draws its own round lines (the Timeline's fallback).
    const detail = {
      ...done,
      runs: [run(2, second), run(1, first)],
      comments: [...done.comments, comment],
      workerRuns: [
        { ...done.workerRuns[0], id: "r5", firstSeenAt: first.start + 30 },
        { ...done.workerRuns[0], id: "r6", firstSeenAt: second.start + 5 },
      ],
    };
    window.history.replaceState(null, "", "/app/#/cards/k-105");
    const view = render(<App store={new Store(new SyntheticSource({ now: NOW, scene: { ...base, cardDetails: { ...base.cardDetails, "k-105": detail as typeof done }, records: Object.fromEntries(Object.entries(base.records).filter(([id]) => id !== "r5" && id !== "r6")) } }))} />);
    await waitFor(() => expect(view.getAllByTestId("round").length).toBeGreaterThan(0));
    const lines = view.queryAllByTestId("round-line").map((line) => line.textContent ?? "");
    expect(lines.filter((line) => line.includes("가상 알림 문구를 두 줄로 나눴다."))).toHaveLength(1);
    const rounds = view.getAllByTestId("round");
    expect(rounds).toHaveLength(2);
    // Round 1 reads the comment; round 2, with no line, is the one 이전 기록 group after it (criterion 2).
    expect(within(rounds[0]).getByTestId("round-line").textContent).toBe("가상 알림 문구를 두 줄로 나눴다.");
    expect(rounds[1].closest("[data-testid=round-fold]")).not.toBeNull();
    expect(within(rounds[1]).queryByTestId("round-line")).toBeNull();
  });
}
