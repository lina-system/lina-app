import { USAGE_RANGES, type ModelsState, type UsageRange, type UsageRow, type UsageView } from "../api/client";

/** How many rows each usage list keeps: the costliest five, or every row when there are fewer. */
export const USAGE_TOP = 5;

/** One line of the usage panel: a model's or a machine's cost and tokens. */
export interface UsageLine {
  readonly name: string;
  readonly cost: number | null;
  readonly tokens: number;
}

/** One range's numbers: the totals and the top rows by cost. */
export interface UsageRangeView {
  readonly range: UsageRange;
  readonly cost: number | null;
  readonly tokens: number;
  readonly models: readonly UsageLine[];
  readonly machines: readonly UsageLine[];
}

function line(row: UsageRow, name: string | null | undefined): UsageLine | null {
  if (!name) return null;
  return { name, cost: row.costUsd, tokens: row.tokens.total };
}

/** The costliest rows first; a row OCX priced none of sorts last, never after one that cost something. */
function topRows(rows: readonly UsageRow[], nameOf: (row: UsageRow) => string | null | undefined): UsageLine[] {
  const lines = rows.map((row) => line(row, nameOf(row))).filter((each): each is UsageLine => each !== null);
  return lines.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)).slice(0, USAGE_TOP);
}

/** One range as the panel reads it; null until the route answered. */
export function usageRangeView(view: UsageView | undefined): UsageRangeView | null {
  if (!view) return null;
  return {
    range: view.range,
    cost: view.costUsd,
    tokens: view.tokens.total,
    models: topRows(view.byModel, (row) => row.model),
    machines: topRows(view.byMachine, (row) => row.machine),
  };
}

/** The ranges read so far, in the screen's order: today, 7 days, 30 days. */
export function usageViews(views: Readonly<Partial<Record<UsageRange, UsageView>>> | undefined): readonly UsageRangeView[] {
  return USAGE_RANGES.map((range) => usageRangeView(views?.[range])).filter((view): view is UsageRangeView => view !== null);
}

/** OCX's own line: the models on, and the machines whose link is down (none when every link is fine). */
export interface OcxView {
  readonly enabled: number;
  readonly down: readonly string[];
}

export function ocxView(state: ModelsState | undefined): OcxView | null {
  if (!state) return null;
  const down = state.machines.filter((link) => !link.ok).map((link) => link.machine ?? "");
  return { enabled: state.enabled, down: down.filter(Boolean) };
}
