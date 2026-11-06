import { expect, test } from "vitest";
import type { WorkCardDetail, WorkCardList, WorkCardSummary } from "../api/client";
import { buildModel } from "./index";

const NOW = 1_793_700_000;

function summary(id: string, title: string, plainTitle: string | null, state: WorkCardSummary["state"]): WorkCardSummary {
  return {
    id,
    title,
    agent: null,
    state,
    reason: null,
    elapsedSeconds: 60,
    todoProgress: { done: 0, total: 0 },
    now: null,
    plain: { title: plainTitle, now: null, result: null },
  };
}

function detail(card: WorkCardSummary): WorkCardDetail {
  return {
    id: card.id,
    title: card.title,
    agent: card.agent,
    state: card.state,
    reason: card.reason,
    elapsedSeconds: card.elapsedSeconds,
    todoProgress: card.todoProgress,
    now: card.now,
    plain: card.plain,
    todos: [],
    runs: [],
    workerRuns: [],
    gates: [],
    comments: [],
  };
}

test("a work card's own title names it until its checked title exists, and its kind is read from the same text", () => {
  const running = summary("k-running", "위키: 배포 문서 정리", null, "in_progress");
  const done = summary("k-done", "결제: 안내 문서 다듬기", null, "done");
  const checked = summary("k-checked", "위키: 결제 문서 정리", "결제: 카드 입력 폼 다듬기", "done");
  const cards: WorkCardList = { cards: [running, done, checked] };
  const model = buildModel(
    {
      cards,
      cardDetails: Object.fromEntries([running, done, checked].map((card) => [card.id, detail(card)])),
      failed: [],
    },
    NOW,
  );

  // No checked title: the card's own title stands in, in both the running and finished lists, and its kind comes
  // from that title (문서, not the code fallback the empty checked title would give).
  expect(model.cards.get("k-running")).toMatchObject({ name: "위키: 배포 문서 정리", title: "위키: 배포 문서 정리", work: "docs" });
  expect(model.cards.get("k-done")).toMatchObject({ name: "결제: 안내 문서 다듬기", title: "결제: 안내 문서 다듬기", work: "docs" });
  expect(model.home.active.rows.map((card) => card.name)).toContain("위키: 배포 문서 정리");
  expect(model.done.map((card) => card.name)).toContain("결제: 안내 문서 다듬기");

  // A checked title wins over the card's own title, and the kind is read from the checked one.
  expect(model.cards.get("k-checked")).toMatchObject({ name: "결제: 카드 입력 폼 다듬기", title: "결제: 카드 입력 폼 다듬기", work: "code" });
});
