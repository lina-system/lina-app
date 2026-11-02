import type { Home, NotificationList, Status } from "../api/client";

/**
 * Test fixtures are generated, never copied from a real home. A fixed seed keeps
 * tests and captures stable; names, titles and ids are synthetic tokens, so a
 * person's or agent's name cannot drift in from a capture or a manual edit.
 */
export const SYNTHETIC_SEED = 0x5eed;

const AGENT_NAMES = ["Agent 1", "Agent 2"] as const;
const GOAL_TITLES = ["샘플 목표", "점검 목표"] as const;
const TODO_TITLES = ["Draft the fixture", "Read the summary", "Note a line"] as const;
const RUN_TITLES = ["Draft the fixture", "Run the check"] as const;
const NOTICE_TITLES = ["Fixture notice", "Synthetic notice"] as const;
const MACHINE_NAMES = ["Machine 1", "Machine 2"] as const;
const MODELS = ["fixture-model", "fixture-model-small"] as const;
const REMAINING = [20, 40, 60] as const;

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(rng: Rng, values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    const value = result[index];
    result[index] = result[other];
    result[other] = value;
  }
  return result;
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)];
}

function counts(agents: Home["agents"]): { goals: number; todos: number; runs: number } {
  let goals = 0;
  let todos = 0;
  let runs = 0;
  for (const agent of agents) {
    goals += agent.goals.length;
    for (const goal of agent.goals) {
      todos += goal.todos.length;
      for (const todo of goal.todos) runs += todo.runs.length;
    }
  }
  return { goals, todos, runs };
}

export function countsFromAgents(home: Home): { goals: number; todos: number; runs: number } {
  return counts(home.agents);
}

function summaryOf(agents: Home["agents"]): Home["summary"] {
  const { goals, todos, runs } = counts(agents);
  return { goalCount: goals, todoCount: todos, runCount: runs };
}

export function generateHome(seed = SYNTHETIC_SEED): Home {
  const rng = mulberry32(seed);
  const agents = shuffle(rng, AGENT_NAMES);
  const goalTitles = shuffle(rng, GOAL_TITLES);
  const todoTitles = shuffle(rng, TODO_TITLES);
  const runTitles = shuffle(rng, RUN_TITLES);
  const rows: Home["agents"] = [
    {
      id: "agent-1",
      name: agents[0],
      goals: [
        {
          id: "goal-1",
          title: goalTitles[0],
          todos: [
            {
              id: "todo-1",
              title: todoTitles[0],
              state: "in_progress",
              reason: "working",
              addedBy: agents[0],
              runs: [{ id: "run-1", title: runTitles[0], state: "in_progress", reason: "working" }],
            },
          ],
        },
      ],
    },
    {
      id: "agent-2",
      name: agents[1],
      goals: [
        {
          id: "goal-2",
          title: goalTitles[1],
          todos: [
            {
              id: "todo-2",
              title: todoTitles[1],
              state: "planned",
              addedBy: agents[1],
              runs: [],
            },
            {
              id: "todo-3",
              title: todoTitles[2],
              state: "waiting",
              reason: "input",
              addedBy: agents[1],
              runs: [],
            },
          ],
        },
      ],
    },
  ];
  return { summary: summaryOf(rows), agents: rows };
}

export function generateNotifications(seed = SYNTHETIC_SEED): NotificationList {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  return {
    unreadCount: 1,
    items: [{ id: "note-1", title: pick(rng, NOTICE_TITLES), read: false }],
  };
}

export function generateStatus(seed = SYNTHETIC_SEED): Status {
  const rng = mulberry32(seed ^ 0x85ebca6b);
  return {
    machines: [{ id: "machine-1", name: pick(rng, MACHINE_NAMES), state: "up" }],
    quota: [{ model: pick(rng, MODELS), remaining: pick(rng, REMAINING), window: "hour" }],
  };
}

export interface SyntheticFixtures {
  readonly home: Home;
  readonly notifications: NotificationList;
  readonly status: Status;
}

export function generateFixtures(seed = SYNTHETIC_SEED): SyntheticFixtures {
  return {
    home: generateHome(seed),
    notifications: generateNotifications(seed),
    status: generateStatus(seed),
  };
}

const fixtures = generateFixtures();

export const syntheticHome: Home = fixtures.home;
export const syntheticNotifications: NotificationList = fixtures.notifications;
export const syntheticStatus: Status = fixtures.status;
