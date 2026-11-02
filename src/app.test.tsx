import { render } from "@testing-library/preact";
import { expect, test } from "vitest";
import { App } from "./app";
import { countsFromAgents, syntheticHome } from "./fixtures/synthetic";
import { readVersion } from "../scripts/version.ts";
import { APP_VERSION } from "./version";

test("shows the alpha version and the synthetic summary", () => {
  const view = render(<App home={syntheticHome} />);
  expect(APP_VERSION).toBe(readVersion());
  expect(view.getByTestId("version").textContent).toBe(APP_VERSION);
  const counts = countsFromAgents(syntheticHome);
  expect(syntheticHome.summary).toEqual({
    goalCount: counts.goals,
    todoCount: counts.todos,
    runCount: counts.runs,
  });
  expect(view.getByTestId("goal-count").textContent).toBe(String(counts.goals));
  expect(view.getByText(syntheticHome.agents[0].goals[0].title)).toBeTruthy();
});
