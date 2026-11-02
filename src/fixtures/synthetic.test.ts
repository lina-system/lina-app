// @vitest-environment node
import { expect, test } from "vitest";
import { scanText } from "../../scripts/check-personal-data.ts";
import {
  SYNTHETIC_SEED,
  countsFromAgents,
  generateFixtures,
  syntheticHome,
  syntheticNotifications,
  syntheticStatus,
} from "./synthetic";

const AGENT_NAME = /^Agent \d+$/;
const MACHINE_NAME = /^Machine \d+$/;
const ID = /^(?:agent|goal|todo|run|note|machine)-\d+$/;
const TITLE =
  /^(?:샘플 목표|점검 목표|Draft the fixture|Read the summary|Note a line|Run the check|Fixture notice|Synthetic notice)$/;
const MODEL = /^fixture-model(?:-[a-z]+)?$/;

test("generates the same fixtures from the same seed", () => {
  expect(generateFixtures()).toEqual({
    home: syntheticHome,
    notifications: syntheticNotifications,
    status: syntheticStatus,
  });
});

test("changes the fixtures when the seed changes", () => {
  const variants = new Set(
    [1, 2, 3, 4, 5].map((offset) => JSON.stringify(generateFixtures(SYNTHETIC_SEED + offset))),
  );

  expect(variants.size).toBeGreaterThan(1);
});

test("names, titles and ids are synthetic", () => {
  const fixtures = generateFixtures();

  for (const agent of fixtures.home.agents) {
    expect(agent.id).toMatch(ID);
    expect(agent.name).toMatch(AGENT_NAME);
    for (const goal of agent.goals) {
      expect(goal.id).toMatch(ID);
      expect(goal.title).toMatch(TITLE);
      for (const todo of goal.todos) {
        expect(todo.id).toMatch(ID);
        expect(todo.title).toMatch(TITLE);
        expect(todo.addedBy).toMatch(AGENT_NAME);
        for (const run of todo.runs) {
          expect(run.id).toMatch(ID);
          expect(run.title).toMatch(TITLE);
        }
      }
    }
  }
  for (const machine of fixtures.status.machines) {
    expect(machine.id).toMatch(ID);
    expect(machine.name).toMatch(MACHINE_NAME);
  }
  for (const window of fixtures.status.quota) {
    expect(window.model).toMatch(MODEL);
  }
  for (const item of fixtures.notifications.items) {
    expect(item.id).toMatch(ID);
    expect(item.title).toMatch(TITLE);
  }
});

test("summary counts match the generated rows", () => {
  const counts = countsFromAgents(syntheticHome);
  expect(syntheticHome.summary).toEqual({
    goalCount: counts.goals,
    todoCount: counts.todos,
    runCount: counts.runs,
  });
});

test("the generated fixtures contain no personal-data pattern or configured name", () => {
  expect(
    scanText(JSON.stringify(generateFixtures()), "fixtures.json", process.env.PERSONAL_DATA_NAMES),
  ).toEqual([]);
});
