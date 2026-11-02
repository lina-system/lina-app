import type { Home, NotificationList, Status } from "../api/client";

export const syntheticHome: Home = {
  summary: { goalCount: 2, todoCount: 3, runCount: 1 },
  agents: [
    {
      id: "agent-river",
      name: "River",
      goals: [
        {
          id: "goal-sample",
          title: "샘플 목표",
          todos: [
            {
              id: "todo-draft",
              title: "Write the fixture",
              state: "in_progress",
              reason: "working",
              addedBy: "River",
              runs: [{ id: "run-draft", title: "Draft the fixture", state: "in_progress", reason: "working" }],
            },
          ],
        },
      ],
    },
    {
      id: "agent-harbor",
      name: "Harbor",
      goals: [
        {
          id: "goal-check",
          title: "Check the shell",
          todos: [
            {
              id: "todo-read",
              title: "Read the summary",
              state: "planned",
              addedBy: "Harbor",
              runs: [],
            },
            {
              id: "todo-note",
              title: "Note a line",
              state: "waiting",
              reason: "input",
              addedBy: "Harbor",
              runs: [],
            },
          ],
        },
      ],
    },
  ],
};

export const syntheticNotifications: NotificationList = {
  unreadCount: 1,
  items: [{ id: "note-1", title: "Fixture notice", read: false }],
};

export const syntheticStatus: Status = {
  machines: [{ id: "machine-desk", name: "Desk", state: "up" }],
  quota: [{ model: "fixture-model", remaining: 40, window: "hour" }],
};

export function countsFromAgents(home: Home): { goals: number; todos: number; runs: number } {
  let goals = 0;
  let todos = 0;
  let runs = 0;
  for (const agent of home.agents) {
    goals += agent.goals.length;
    for (const goal of agent.goals) {
      todos += goal.todos.length;
      for (const todo of goal.todos) runs += todo.runs.length;
    }
  }
  return { goals, todos, runs };
}
