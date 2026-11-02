import type { Home, WorkState } from "./api/client";
import { KoreanInput } from "./korean-input";
import { APP_VERSION } from "./version";
import { useState } from "preact/hooks";

const stateLabel: Record<WorkState, string> = {
  planned: "planned",
  in_progress: "in progress",
  waiting: "waiting",
  stopped: "stopped",
  done: "done",
};

function stateLine(state: WorkState, reason?: string): string {
  const label = stateLabel[state];
  return reason ? `${label} · ${reason}` : label;
}

export function App({ home }: { home: Home }) {
  const [note, setNote] = useState("");
  return (
    <main class="shell">
      <h1 class="mark">LINA</h1>
      <p class="version" data-testid="version">
        {APP_VERSION}
      </p>
      <ul class="summary" aria-label="Summary">
        <li>
          Goals <strong data-testid="goal-count">{home.summary.goalCount}</strong>
        </li>
        <li>
          To-dos <strong data-testid="todo-count">{home.summary.todoCount}</strong>
        </li>
        <li>
          Runs <strong data-testid="run-count">{home.summary.runCount}</strong>
        </li>
      </ul>
      <ul class="agents">
        {home.agents.map((agent) => (
          <li class="agent" key={agent.id}>
            <h2>{agent.name}</h2>
            {agent.goals.map((goal) => (
              <div class="goal" key={goal.id}>
                <p class="keep" lang="ko">
                  {goal.title}
                </p>
                <ul class="todos">
                  {goal.todos.map((todo) => (
                    <li key={todo.id}>
                      <span class="keep">{todo.title}</span>
                      <span>
                        {" "}
                        · {stateLine(todo.state, todo.reason)} · {todo.addedBy}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <KoreanInput label="Note" value={note} onValue={setNote} />
    </main>
  );
}
