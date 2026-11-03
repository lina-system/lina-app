// @vitest-environment node
import { expect, test } from "vitest";
import { scanText } from "../../scripts/check-personal-data.ts";
import { buildModel } from "../model";
import { generateScene, SCENE_COUNTS, SYNTHETIC_SEED, type Scene } from "./synthetic";

const NOW = 1_793_700_000;
const scene = generateScene(SYNTHETIC_SEED, { now: NOW });

function model(input: Scene) {
  return buildModel(
    {
      board: input.board,
      items: input.items,
      goals: input.goals,
      cards: input.cards,
      cardsAt: input.now,
      inbox: input.inbox,
      devices: input.devices,
      quota: input.quota,
      cardDetails: input.cardDetails,
      failed: [],
    },
    input.now,
  );
}

test("generates the same scene from the same seed and moves names with the seed", () => {
  expect(generateScene(SYNTHETIC_SEED, { now: NOW })).toEqual(scene);
  const names = new Set([1, 2, 3, 4, 5].map((offset) => generateScene(SYNTHETIC_SEED + offset, { now: NOW }).items.agents.map((agent) => agent.name).join()));
  expect(names.size).toBeGreaterThan(1);
});

test("the scene holds what every screen needs", () => {
  const items = scene.items.items;
  const goals = items.filter((item) => item.kind === "goal");
  const todos = items.filter((item) => item.kind === "todo");
  const today = scene.board.due.today.map((row) => row.id);
  const overdue = scene.board.due.overdue.map((row) => row.id);

  expect(scene.items.agents).toHaveLength(SCENE_COUNTS.agents);
  expect(goals).toHaveLength(SCENE_COUNTS.goals);
  expect(new Set(goals.map((goal) => goal.agent)).size).toBe(SCENE_COUNTS.agents);
  expect(goals.filter((goal) => goal.state === "done")).toHaveLength(1);
  expect(goals.filter((goal) => today.includes(goal.id))).toHaveLength(1);
  expect(goals.filter((goal) => overdue.includes(goal.id))).toHaveLength(1);

  expect(todos).toHaveLength(SCENE_COUNTS.todos);
  expect(new Set(todos.map((todo) => todo.state))).toEqual(new Set(["planned", "in_progress", "waiting", "stopped", "done"]));
  expect(todos.filter((todo) => todo.mine)).toHaveLength(2);

  const decisions = [...scene.board.inbox.decide.map((row) => row.kind), ...scene.inbox.questions.map(() => "ask")];
  expect(decisions).toHaveLength(SCENE_COUNTS.decisions);
  expect(decisions.filter((kind) => kind === "ask")).toHaveLength(2);
  expect(decisions.filter((kind) => kind === "act")).toHaveLength(2);

  const review = scene.board.inbox.review.map((id) => scene.board.cards.find((run) => run.id === id));
  expect(review.map((run) => run?.state)).toEqual(["waiting"]);

  const cards = scene.cards.cards;
  expect(cards.filter((card) => card.state === "in_progress")).toHaveLength(2);
  // One running card has its checked now line; the other has no checked line at all (lina#151).
  expect(cards.filter((card) => card.state === "in_progress" && card.plain.now)).toHaveLength(1);
  expect(cards.filter((card) => card.plain.title === null && card.plain.now === null && card.plain.result === null).map((card) => card.id)).toEqual(["k-102"]);
  expect(scene.cardDetails["k-101"].runs).toHaveLength(3);
  // A round with its worker run spans exactly that run, so the round's times and the run's duration agree.
  for (const [round, runId] of scene.cardDetails["k-101"].runs.map((each, index) => [each, ["r9", "r10", "r1"][index]] as const)) {
    const run = scene.board.cards.find((candidate) => candidate.id === runId);
    expect(run?.startedAt).toBe(round.startedAt);
    expect(run?.endedAt).toBe(round.endedAt);
  }
  const stopped = cards.filter((card) => card.state === "stopped");
  expect(stopped.map((card) => card.reason)).toEqual(["unresponsive"]);
  expect(scene.cardDetails[stopped[0].id].runs.every((run) => typeof run.lastHeartbeatAt === "number")).toBe(true);
  expect(cards.filter((card) => card.state === "waiting")).toHaveLength(1);
  expect(cards.filter((card) => card.state === "done")).toHaveLength(1);
  for (const card of cards) {
    expect(scene.cardDetails[card.id].todos.length).toBeGreaterThan(0);
    expect(scene.cardDetails[card.id].workerRuns.length).toBeGreaterThan(0);
  }
  const owned = new Set(Object.values(scene.cardDetails).flatMap((detail) => detail.workerRuns.map((run) => run.id)));
  const outside = scene.board.cards.filter((run) => !owned.has(run.id));
  expect(outside.map((run) => run.id)).toEqual(["r6", "r7", "r8"]);
  // Two jobs on one to-do with one generated title.
  const twins = outside.filter((run) => run.plain.title === "가이드 초안 다듬기");
  expect(twins.map((run) => run.todo)).toEqual(["T10", "T10"]);
  expect(scene.board.writer.state).toBe("ok");
  expect(generateScene(SYNTHETIC_SEED, { now: NOW, writerStopped: true }).board.writer.state).toBe("stopped");

  expect(scene.devices.machines.map((machine) => machine.state).sort()).toEqual(["down", "ok", "warn"]);
  expect(scene.quota.quota).toHaveLength(3);
  expect(scene.quota.quota.map((service) => service.accounts.length)).toEqual([2, 1, 1]);
  // The core's rule: a window warns when its rate reaches 100% before it resets; an account warns when a window does.
  for (const account of scene.quota.quota.flatMap((service) => service.accounts)) {
    for (const window of account.windows) {
      const reaches = window.ratePerHour !== null && window.resetAt !== null && window.percent + (window.ratePerHour * (window.resetAt - NOW)) / 3600 >= 100;
      expect(window.warn).toBe(reaches);
    }
    expect(account.warn).toBe(account.windows.some((window) => window.warn));
  }
  expect(scene.quota.quota.filter((service) => service.accounts.some((account) => account.warn))).toHaveLength(1);

  const threads = Object.values(scene.itemDetails).filter((detail) => detail.kind === "todo" && detail.comments.some((comment) => comment.replies.length));
  expect(threads).toHaveLength(2);

  const failed = generateScene(SYNTHETIC_SEED, { now: NOW, sourceError: true });
  expect(failed.board.errors.map((error) => error.source)).toEqual(["quota"]);
  expect(scene.board.errors).toEqual([]);
});

test("the model's counts on the scene are the numbers doctor and the drivers expect", () => {
  const counts = model(scene).counts;
  expect(counts).toMatchObject({
    inbox: SCENE_COUNTS.inbox,
    running: SCENE_COUNTS.running,
    stopped: SCENE_COUNTS.stopped,
    due: SCENE_COUNTS.due,
    done: SCENE_COUNTS.done,
    goals: SCENE_COUNTS.goals,
    notices: SCENE_COUNTS.notices,
    devices: { all: SCENE_COUNTS.machines, ok: SCENE_COUNTS.machinesOk, warn: SCENE_COUNTS.machinesWarn, down: SCENE_COUNTS.machinesDown },
  });
  expect(model(scene).running.rows).toHaveLength(SCENE_COUNTS.running + SCENE_COUNTS.stopped);
});

test("names are invented and titles are Korean", () => {
  for (const agent of scene.items.agents) expect(agent.name).toMatch(/^[A-Z][a-z]{3,6}$/);
  for (const item of scene.items.items) expect(item.title).toMatch(/^[가-힣 ]+$/);
  // The raw card and run titles are what workers record; the checked titles the screens draw are Korean.
  for (const card of scene.cards.cards) if (card.plain.title !== null) expect(card.plain.title).toMatch(/^[가-힣 :]+$/);
  for (const run of scene.board.cards) {
    if (run.plain.title !== null) expect(run.plain.title).toMatch(/^[가-힣 ]+$/);
    expect(run.title).not.toBe(run.plain.title);
  }
  for (const machine of scene.devices.machines) expect(machine.name).toMatch(/^[가-힣]+$/);
});

test("the scene contains no personal-data pattern or configured name", () => {
  expect(scanText(JSON.stringify(scene), "scene.json", process.env.PERSONAL_DATA_NAMES)).toEqual([]);
});

test("the scene does not contradict itself", () => {
  const runs = new Map(scene.board.cards.map((run) => [run.id, run]));
  for (const detail of Object.values(scene.cardDetails)) {
    const running = detail.workerRuns.some((worker) => runs.get(worker.id)?.state === "in_progress");
    // A running card has finished steps only from an earlier follow-up round.
    if (running && detail.runs.length === 1) expect(detail.todos.filter((todo) => todo.done)).toEqual([]);
    expect(running).toBe(detail.state === "in_progress");
  }
  for (const item of scene.items.items.filter((candidate) => candidate.kind === "todo")) {
    const own = scene.itemDetails[item.id].runs;
    if (item.state === "done") expect(own.every((run) => run.state === "done")).toBe(true);
    if (own.some((run) => run.state === "in_progress")) expect(item.state).toBe("in_progress");
  }
});

test("cards differ in kind: code, docs, research and device all appear", () => {
  const kinds = new Set([...model(scene).cards.values()].map((card) => card.work));
  expect(kinds).toEqual(new Set(["code", "docs", "research", "device"]));
  const running = model(scene).running.rows.filter((card) => card.state === "in_progress");
  expect(new Set(running.map((card) => card.work)).size).toBe(running.length);
});
