// @vitest-environment node
import { expect, test } from "vitest";
import { scanText } from "../../scripts/check-personal-data.ts";
import { buildModel } from "../model";
import { holds } from "../model/rounds";
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
      usage: input.usage,
      modelsState: input.modelsState,
      checks: input.checks,
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
    const run = scene.runs.find((candidate) => candidate.id === runId);
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
    // A card just created (예정) has no run and no worker run yet; every other card has one.
    expect(scene.cardDetails[card.id].workerRuns.length > 0).toBe(card.state !== "planned");
  }
  expect(cards.filter((card) => card.state === "planned").map((card) => [card.id, card.reason])).toEqual([["k-106", "ready"]]);
  const owned = new Set(Object.values(scene.cardDetails).flatMap((detail) => detail.workerRuns.map((run) => run.id)));
  const outside = scene.board.cards.filter((run) => !owned.has(run.id));
  expect(outside.map((run) => run.id)).toEqual(["r6", "r7", "r8"]);
  // Two jobs with one generated title, outside any card and any goal's to-do, so both are listed (lina-app#116).
  const twins = outside.filter((run) => run.plain.title === "가이드 초안 다듬기");
  expect(twins.map((run) => run.todo)).toEqual([null, null]);
  expect(scene.board.writer.state).toBe("ok");
  expect(generateScene(SYNTHETIC_SEED, { now: NOW, writerStopped: true }).board.writer.state).toBe("stopped");

  expect(scene.devices.machines.map((machine) => machine.state).sort()).toEqual(["down", "ok", "ok", "warn"]);
  const workNodes = scene.devices.machines.filter((machine) => machine.role === "work");
  expect(workNodes.map((machine) => machine.runners.find((cell) => cell.name === "글결")?.why)).toEqual(["sign_in", "update", "unreachable"]);
  expect(scene.devices.machines.every((machine) => machine.runners.every((cell) => cell.signingIn === false))).toBe(true);
  expect(workNodes[2].runners.every((cell) => cell.why === "unreachable" && cell.installed === null)).toBe(true);
  expect(scene.devices.machines.filter((machine) => machine.role === "files")).toHaveLength(1);
  expect(scene.devices.person).toHaveLength(2);
  expect(scene.devices.person.filter((device) => device.reachable).length).toBe(1);
  expect(scene.quota.quota).toHaveLength(3);
  expect(scene.quota.quota.map((service) => service.accounts.length)).toEqual([2, 1, 2]);
  // The core's rule: a window warns when its rate reaches 100% before it resets; an account warns when a window does.
  for (const account of scene.quota.quota.flatMap((service) => service.accounts)) {
    for (const window of account.windows) {
      const reaches = window.ratePerHour !== null && window.resetAt !== null && window.percent + (window.ratePerHour * (window.resetAt - NOW)) / 3600 >= 100;
      expect(window.warn).toBe(reaches);
    }
    expect(account.warn).toBe(account.windows.some((window) => window.warn));
  }
  expect(scene.quota.quota.filter((service) => service.accounts.some((account) => account.warn))).toHaveLength(1);
  const accounts = scene.quota.quota.flatMap((service) => service.accounts);
  for (const window of accounts.flatMap((account) => account.windows)) expect(window.left).toBe(Math.min(100, Math.max(0, 100 - window.percent)));
  // One account needs signing in again, one is paused, and OCX holds no account for one service (lina#232). An account
  // that must be signed in again holds no window, so none of its numbers can be stale.
  expect(accounts.filter((account) => account.state === "reauth").map((account) => [account.windows.length, account.mainWindow])).toEqual([[0, null]]);
  expect(accounts.filter((account) => account.state === "paused").map((account) => account.paused)).toEqual([true]);
  expect(scene.quota.missing).toEqual(["Cursor"]);

  // Usage (lina#232): one view per control, its lists adding up to its own totals.
  expect(Object.keys(scene.usage)).toEqual(["today", "7d", "30d"]);
  for (const view of Object.values(scene.usage)) {
    const tokens = (rows: typeof view.byModel) => rows.reduce((total, row) => total + row.tokens.total, 0);
    const cost = (rows: typeof view.byModel) => rows.reduce((total, row) => total + (row.costUsd ?? 0), 0);
    for (const rows of [view.byModel, view.byProvider, view.byMachine]) {
      expect(tokens(rows)).toBe(view.tokens.total);
      expect(cost(rows)).toBeCloseTo(view.costUsd ?? 0, 6);
    }
    expect(view.byModel).toHaveLength(3);
    expect(view.byMachine).toHaveLength(3);
  }
  expect(scene.modelsState.enabled).toBe(SCENE_COUNTS.modelsEnabled);
  expect(scene.modelsState.machines.map((link) => link.ok)).toEqual([true, false]);

  expect(scene.checks.checks).toHaveLength(SCENE_COUNTS.checks);
  expect(scene.checks.checks.filter((check) => check.state === "ok")).toHaveLength(SCENE_COUNTS.checksOk);
  expect(scene.checks.checks.filter((check) => check.state !== "ok").map((check) => [check.name, check.state])).toEqual([
    ["백업 회선", "failing"],
    ["대기 봇", "stale"],
  ]);

  const threads = Object.values(scene.itemDetails).filter((detail) => detail.kind === "todo" && detail.comments.some((comment) => comment.replies.length));
  expect(threads).toHaveLength(2);

  const failed = generateScene(SYNTHETIC_SEED, { now: NOW, sourceError: true });
  expect(failed.board.errors.map((error) => error.source)).toEqual(["quota"]);
  const checksFailed = generateScene(SYNTHETIC_SEED, { now: NOW, checksError: true });
  expect(checksFailed.checks.checks).toEqual([]);
  expect(checksFailed.board.errors).toEqual([]);
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
  expect(model(scene).checks).toMatchObject({ ok: SCENE_COUNTS.checksOk, total: SCENE_COUNTS.checks });
  expect(model(scene).checks.open).toHaveLength(SCENE_COUNTS.checksOpen);
  expect(model(scene).usage.map((view) => view.range)).toEqual(["today", "7d", "30d"]);
  expect(model(scene).quotaMissing).toEqual(["Cursor"]);
  expect(model(scene).ocx).toEqual({ enabled: SCENE_COUNTS.modelsEnabled, down: [scene.devices.machines.find((machine) => machine.state === "down")?.name] });
});

// The core's rule (lina_board_quota.quota_view): a service row's percent and rate are the mean over the accounts that
// are not paused and have a main window, and its reset and warning come from those same accounts.
test("every service row equals the mean over the accounts that are not paused and have a main window", () => {
  const main = (account: (typeof scene.quota.quota)[number]["accounts"][number]) => account.windows.find((window) => window.key === account.mainWindow);
  const mean = (values: readonly number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
  const resetsOf = (accounts: readonly (typeof scene.quota.quota)[number]["accounts"][number][]) =>
    accounts.flatMap((account) => {
      const reset = main(account)?.resetAt ?? null;
      return reset === null ? [] : [reset];
    });
  for (const service of scene.quota.quota) {
    const live = service.accounts.filter((account) => !account.paused && main(account) !== undefined);
    // A service whose every account is paused or signed out would draw a row with no numbers at all.
    expect(live.length).toBeGreaterThan(0);
    expect({ service: service.service, percent: service.percent }).toEqual({ service: service.service, percent: mean(live.map((account) => main(account)?.percent ?? 0)) });
    const rates = live.map((account) => main(account)?.ratePerHour ?? null).filter((rate): rate is number => rate !== null);
    expect({ service: service.service, rate: service.ratePerHour }).toEqual({ service: service.service, rate: mean(rates) });
    // The row's reset is the nearest of the live windows: a paused account's later reset never wins it.
    const paused = resetsOf(service.accounts.filter((account) => account.paused));
    if (paused.length) expect(Math.min(...resetsOf(live))).toBeLessThan(Math.min(...paused));
  }
});

// Usage and OCX name the work nodes only. The file node is on the 기기 panel and in neither list.
test("usage and OCX's links name the work machines the 기기 panel names", () => {
  const work = scene.devices.machines.filter((machine) => machine.role === "work").map((machine) => machine.name);
  const files = scene.devices.machines.filter((machine) => machine.role === "files").map((machine) => machine.name);
  const down = scene.devices.machines.filter((machine) => machine.state === "down").map((machine) => machine.name);
  expect(work).toHaveLength(3);
  expect(files).toHaveLength(1);
  for (const view of Object.values(scene.usage)) {
    expect(view.byMachine.map((row) => row.machine).sort()).toEqual([...work].sort());
    expect(view.byMachine.map((row) => row.machine)).not.toContain(files[0]);
  }
  for (const link of scene.modelsState.machines) {
    expect(work).toContain(link.machine);
    expect(files).not.toContain(link.machine);
  }
  expect(scene.modelsState.machines.filter((link) => !link.ok).map((link) => link.machine)).toEqual(down);
});

test("names are invented and titles are Korean", () => {
  for (const agent of scene.items.agents) expect(agent.name).toMatch(/^[A-Z][a-z]{3,6}$/);
  for (const item of scene.items.items) expect(item.title).toMatch(/^[가-힣 ]+$/);
  // The raw card and run titles are what workers record; the checked titles the screens draw are Korean.
  for (const card of scene.cards.cards) if (card.plain.title !== null) expect(card.plain.title).toMatch(/^[가-힣 :]+$/);
  for (const run of scene.runs) {
    if (run.plain.title !== null) expect(run.plain.title).toMatch(/^[가-힣 ]+$/);
    expect(run.title).not.toBe(run.plain.title);
  }
  for (const machine of scene.devices.machines) expect(machine.name).toMatch(/^[가-힣]+$/);
});

test("the scene contains no personal-data pattern or configured name", () => {
  expect(scanText(JSON.stringify(scene), "scene.json", process.env.PERSONAL_DATA_NAMES)).toEqual([]);
});

test("the scene does not contradict itself", () => {
  const runs = new Map(scene.runs.map((run) => [run.id, run]));
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

test("every record round ends where its worker run ends, when both ends are known", () => {
  const runs = new Map(scene.runs.map((run) => [run.id, run]));
  let compared = 0;
  for (const [id, record] of Object.entries(scene.records)) {
    // A card's job: its rounds are the card's worker runs, oldest first; a run outside any card is its own round.
    const card = Object.values(scene.cardDetails).find((detail) => detail.workerRuns.some((worker) => worker.id === id));
    const workers = card ? [...card.workerRuns].sort((a, b) => a.firstSeenAt - b.firstSeenAt).map((worker) => worker.id) : [id];
    record.rounds.forEach((round, index) => {
      const n = round.run ?? record.rounds.length - index;
      const run = runs.get(card ? workers[n - 1] : id);
      expect(run, `${id} round ${n}`).toBeDefined();
      if (round.endedAt === null || run?.endedAt == null) return;
      expect(round.endedAt, `${id} round ${n} ends at its run's end`).toBe(run.endedAt);
      compared += 1;
    });
  }
  expect(compared).toBe(3);
});

/** The card whose worker runs include the record's run. */
function cardOf(runId: string) {
  return Object.values(scene.cardDetails).find((detail) => detail.workerRuns.some((worker) => worker.id === runId));
}

test("a record's comments and its card's 댓글 are one set: the owner's words, at the same times, in the round going then", () => {
  const owner = scene.items.owner?.id;
  let compared = 0;
  for (const [id, record] of Object.entries(scene.records)) {
    const card = cardOf(id);
    const inRounds = record.rounds.flatMap((round) => round.rows.filter((row) => row.kind === "comment").map((row) => ({ row, round })));
    const between = record.comments.map((row) => ({ row, round: null }));
    // Every comment the record holds is one of the card's comments, by the owner, with the same text and time.
    for (const { row } of [...inRounds, ...between]) {
      const twin = card?.comments.find((comment) => comment.createdAt === row.at && comment.body === row.text);
      expect(twin, `${id}: ${row.text}`).toBeDefined();
      expect(twin?.author).toBe(owner);
      compared += 1;
    }
  }
  // Every comment the owner made on a card is in its worker runs' records together (the card's 기록), exactly once:
  // in the round going at its time, else between rounds.
  for (const card of Object.values(scene.cardDetails)) {
    const records = Object.values(scene.records).filter((record) => cardOf(record.id)?.id === card.id);
    for (const comment of records.length ? card.comments.filter((candidate) => candidate.author === owner) : []) {
      const places = records.map((record) => {
        const going = record.rounds.find((round) => holds({ start: round.startedAt, end: round.endedAt }, comment.createdAt));
        return (going ? going.rows : record.comments).filter((row) => row.kind === "comment" && row.at === comment.createdAt && row.text === comment.body).length;
      });
      expect(places.reduce((sum, n) => sum + n, 0), `${card.id}: "${comment.body}" is in its records once`).toBe(1);
    }
  }
  expect(compared).toBe(3);
});

/** Whether a result does what a request asks: they share three or more words (by their first two letters). */
function answers(result: string, request: string): boolean {
  const stems = (text: string) => new Set(text.split(/\s+/).filter((word) => word.length >= 2).map((word) => word.slice(0, 2)));
  const done = stems(result);
  return [...stems(request)].filter((stem) => done.has(stem)).length >= 3;
}

test("no round's result does what the owner asked only after that round ended; the round going now does not redo a finished one", () => {
  expect(answers("문서만 바뀐 변경을 따로 묶음", "문서만 바뀐 변경은 따로 묶어 주세요.")).toBe(true);
  expect(answers("문서만 바뀐 변경을 따로 묶음", "변경마다 한 줄 요약을 붙여 주세요")).toBe(false);
  for (const [id, record] of Object.entries(scene.records)) {
    const requests = (cardOf(id)?.comments ?? []).filter((comment) => comment.author === scene.items.owner?.id);
    for (const round of record.rounds) {
      if (!round.result || round.endedAt === null) continue;
      const late = requests.filter((request) => request.createdAt > (round.endedAt ?? 0) && answers(round.result ?? "", request.body));
      expect(late.map((request) => request.body), `${id} round ${round.run ?? "?"}: ${round.result}`).toEqual([]);
    }
    const going = record.rounds.find((round) => round.endedAt === null && !round.endKnown);
    const finished = record.rounds.flatMap((round) => (round.result ? [round.result] : []));
    for (const row of going?.rows.filter((candidate) => candidate.kind === "said") ?? [])
      expect(finished.filter((result) => answers(result, row.text ?? "")), `${id}: "${row.text}"`).toEqual([]);
  }
});

test("cards differ in kind: code, docs, research and device all appear", () => {
  const kinds = new Set([...model(scene).cards.values()].map((card) => card.work));
  expect(kinds).toEqual(new Set(["code", "docs", "research", "device"]));
  const running = model(scene).running.rows.filter((card) => card.state === "in_progress");
  expect(new Set(running.map((card) => card.work)).size).toBe(running.length);
});
