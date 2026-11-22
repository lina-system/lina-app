import type { VNode } from "preact";
import { cellNumber, tableOf, type DocRules } from "../markdown";
import { Chart, MAX_SERIES, type ChartData, type ChartKind } from "../ui/chart";
import { REPORT_WORD } from "../words";
import { BrokenBlock } from "./broken";
import { MermaidBlock } from "./mermaid";

/**
 * The blocks a report body draws in fenced code (lina-app#83); the syntax is written out in
 * .agents/skills/verify-lina-app/features/reports.md. The info string names the block, the core's legacy `lina:chart`
 * first among them (hermes_cli/lina_reports_page.py keeps that fence name):
 *
 * - ```` ```lina:chart [bar|line|share|stacked] [title] ```` then a markdown table: the first column is the labels,
 *   each other column one series (four at most). `share` is a donut of one series, or stacked bars of several. A
 *   `type:` or `title:` line before the table says the same as the info string.
 * - ```` ```mermaid ```` (or `lina:mermaid`): a Mermaid diagram.
 * - ```` ```lina:callout [note|decision|warning] [title] ```` then markdown: a quiet box.
 * - ```` ````lina:fold <title> ```` then markdown, which may hold other blocks in shorter fences: a closed section. A
 *   fold holding a decision or warning box shows a mark on its closed line, and the box stays in place inside it.
 *
 * Any other `lina:` name, and a block that does not parse, shows its source with one line saying why.
 */
export type CalloutKind = "note" | "decision" | "warning";

export type Block =
  | { readonly kind: "chart"; readonly data: ChartData }
  | { readonly kind: "mermaid"; readonly source: string }
  | { readonly kind: "callout"; readonly tone: CalloutKind; readonly title: string | null; readonly body: readonly string[] }
  | { readonly kind: "fold"; readonly title: string; readonly body: readonly string[]; readonly holds: CalloutKind | null }
  | { readonly kind: "broken"; readonly name: string; readonly error: string };

const CHART_KINDS: Readonly<Record<string, ChartKind | "share">> = { bar: "bar", line: "line", share: "share", ratio: "share", donut: "donut", pie: "donut", stacked: "stacked" };
const CALLOUTS: readonly CalloutKind[] = ["note", "decision", "warning"];

/** The block a fence's info string names, parsed from its lines; null for a fence that is plain code. */
export function parseBlock(info: string, body: readonly string[]): Block | null {
  const [name = "", ...rest] = info.split(/\s+/).filter(Boolean);
  const args = rest.join(" ");
  if (name === "mermaid" || name === "lina:mermaid") {
    const source = body.join("\n");
    return source.trim() ? { kind: "mermaid", source } : { kind: "broken", name: REPORT_WORD.diagram, error: REPORT_WORD.emptyBlock };
  }
  if (!name.startsWith("lina:")) return null;
  switch (name) {
    case "lina:chart":
      return parseChart(args, body);
    case "lina:callout":
      return parseCallout(args, body);
    case "lina:fold":
      return args.trim() ? { kind: "fold", title: args.trim(), body, holds: foldHolds(body) } : { kind: "broken", name: REPORT_WORD.fold, error: REPORT_WORD.noTitle };
    default:
      return { kind: "broken", name: REPORT_WORD.report, error: REPORT_WORD.unknownBlock(name) };
  }
}

function broken(name: string, error: string): Block {
  return { kind: "broken", name, error };
}

export function parseChart(args: string, body: readonly string[]): Block {
  const fail = (error: string) => broken(REPORT_WORD.chart, error);
  let [kindWord = "", ...titleWords] = args.split(/\s+/).filter(Boolean);
  let title: string | null = null;
  if (kindWord && !Object.hasOwn(CHART_KINDS, kindWord.toLowerCase())) {
    // No kind first: the words are the title and the kind is bar, unless a type: line says otherwise.
    titleWords = [kindWord, ...titleWords];
    kindWord = "";
  }
  if (titleWords.length) title = titleWords.join(" ");
  for (const line of body) {
    const pair = /^\s*(type|title)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!pair) continue;
    if (pair[1].toLowerCase() === "type") kindWord = pair[2];
    else title = pair[2];
  }
  const kind = kindWord ? CHART_KINDS[kindWord.toLowerCase()] : "bar";
  if (!kind) return fail(REPORT_WORD.chartKind(kindWord));
  const table = tableOf(body);
  if (!table) return fail(REPORT_WORD.noTable);
  const rows = table.rows.filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) return fail(REPORT_WORD.noRows);
  const names = table.head.slice(1);
  if (!names.length) return fail(REPORT_WORD.noRows);
  if (names.length > MAX_SERIES) return fail(REPORT_WORD.tooManySeries(names.length));
  const series = [];
  for (let column = 0; column < names.length; column += 1) {
    const values: number[] = [];
    for (const row of rows) {
      const cell = row[column + 1] ?? "";
      const value = cellNumber(cell);
      if (value === null) return fail(REPORT_WORD.notNumber(cell));
      values.push(value);
    }
    series.push({ name: names[column], values });
  }
  const drawn: ChartKind = kind === "share" ? (series.length === 1 ? "donut" : "stacked") : kind;
  if (drawn === "donut" && series.length > 1) return fail(REPORT_WORD.tooManySeries(series.length));
  return { kind: "chart", data: { kind: drawn, title, labels: rows.map((row) => row[0] ?? ""), series } };
}

export function parseCallout(args: string, body: readonly string[]): Block {
  const [first = "", ...rest] = args.split(/\s+/).filter(Boolean);
  const named = CALLOUTS.find((kind) => kind === first.toLowerCase());
  // A lowercase Latin word first names the kind: one it does not know is a mistake, not the title's first word.
  if (first && !named && /^[a-z]+$/.test(first)) return broken(REPORT_WORD.callout, REPORT_WORD.calloutKind(first));
  const titleWords = named ? rest : [first, ...rest].filter(Boolean);
  if (!body.join("").trim() && !titleWords.length) return broken(REPORT_WORD.callout, REPORT_WORD.emptyBlock);
  return { kind: "callout", tone: named ?? "note", title: titleWords.length ? titleWords.join(" ") : null, body };
}

/** The strongest box a fold holds anywhere inside it: a warning, else a decision, else none. */
function foldHolds(body: readonly string[]): CalloutKind | null {
  const tones = body.map((line) => /^\s*(`{3,}|~{3,})\s*lina:callout\s+(decision|warning)\b/i.exec(line)?.[2]?.toLowerCase());
  if (tones.includes("warning")) return "warning";
  if (tones.includes("decision")) return "decision";
  return null;
}

/** A block drawn; a fold's and a callout's own markdown is drawn by `inner` with the same rules (src/report/body.tsx). */
export function BlockView({ block, inner }: { block: Exclude<Block, { kind: "broken" }>; inner: (lines: readonly string[]) => VNode[] }): VNode {
  switch (block.kind) {
    case "chart":
      return <Chart data={block.data} />;
    case "mermaid":
      return <MermaidBlock source={block.source} />;
    case "callout":
      return (
        <aside class="report-callout" data-tone={block.tone} aria-label={block.title ?? REPORT_WORD.calloutWord[block.tone]}>
          <p class="report-callout-head">
            <span class="report-callout-word">{REPORT_WORD.calloutWord[block.tone]}</span>
            {block.title ? <span class="report-callout-title">{block.title}</span> : null}
          </p>
          {block.body.join("").trim() ? <div class="report-callout-body">{inner(block.body)}</div> : null}
        </aside>
      );
    case "fold":
      return (
        <details class="report-fold" data-holds={block.holds ?? undefined}>
          <summary>
            <span class="report-fold-title">{block.title}</span>
            {block.holds ? (
              <span class="report-fold-mark" data-tone={block.holds}>
                {REPORT_WORD.foldHolds(REPORT_WORD.calloutWord[block.holds])}
              </span>
            ) : null}
          </summary>
          <div class="report-fold-body">{inner(block.body)}</div>
        </details>
      );
  }
}

/** The `fence` rule of a report body: a block's drawing, a broken block with its source, or null for plain code. */
export function blockFence(inner: (lines: readonly string[]) => VNode[]): DocRules["fence"] {
  return (info, body, key) => {
    const block = parseBlock(info, body);
    if (!block) return null;
    if (block.kind === "broken") return <BrokenBlock key={key} kind={block.name} error={block.error} source={[`\`\`\`${info}`, ...body, "```"].join("\n")} />;
    return <BlockView key={key} block={block} inner={inner} />;
  };
}
