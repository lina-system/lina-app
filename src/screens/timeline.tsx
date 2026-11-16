import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Settings } from "../api/client";
import { plainText } from "../model/plain";
import { runModelLine } from "../model/settings";
import { historyLines, timelineBlocks, type TimelineBlock, type TimelineRow } from "../model/timeline";
import { clockAt } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { DETAIL_WORD, SEP, W } from "../words";
import { FoldLine } from "./comments";

/**
 * The model a worker run used: its record once the screen has read it, else the run card the board lists. It is named
 * only by the plain name the model list gives it; an id with no name there is an alias (model-a) and the line is left
 * out (lina-app#128).
 */
export function RunModelLine({ runId, class: className = "sub" }: { runId: string; class?: string }) {
  const { model, store } = useApp();
  const run = store.get("record", runId)?.model ?? model.runs.get(runId)?.model ?? null;
  const settings: Settings = store.get("settings")?.settings ?? {};
  const models = store.get("settingsModels")?.models ?? [];
  if (!models.some((listed) => listed.id === run?.id && (!run.provider || listed.provider === run.provider) && listed.name?.trim())) return null;
  const line = runModelLine(run, settings, models);
  if (!line) return null;
  return (
    <p class={className} data-testid="run-model">
      {line}
    </p>
  );
}

/**
 * A block with the markdown markers out of its result and its rows (plainText): a row that was only markers and spaces
 * is no row, and a comment block left with none is no block (lina-app#166). A comment row is the owner's words (the
 * record's schema) and keeps them as saved (lina-app#226).
 */
function plainBlock(block: TimelineBlock): TimelineBlock | null {
  const rows = block.rows.flatMap((row) => (row.text === null ? [row] : !plainText(row.text) ? [] : row.kind === "comment" ? [row] : [{ ...row, text: plainText(row.text) }]));
  if (block.type === "comment") return rows.length ? { ...block, rows } : null;
  return { ...block, rows, result: block.result === null ? null : plainText(block.result) || null };
}

/** One event of a history: `time · one sentence` on one line (lina-app#123, #128). */
function timed(at: number, text: string, now: number): string {
  return [clockAt(at, now), text].join(SEP);
}

/**
 * One row of a block. A run of rows that do not stand whole is one folded line that opens to them as the record holds
 * them (lina-app#241): 접힌 댓글 when they are all comments, else 접힌 기록.
 */
function Row({ row, owner, folded, count }: { row: TimelineRow; owner: string; folded: readonly TimelineRow[]; count: number }) {
  const { now } = useApp();
  if (folded.length)
    return (
      <li class="timeline-row is-dim" data-kind="folded">
        <FoldLine label={folded.every((each) => each.kind === "comment") ? W.foldedRun(folded.length) : DETAIL_WORD.foldedRecords(folded.length)} held={folded.map((each) => ({ at: each.at, by: null, text: each.source ?? "" }))} at={row.at} />
      </li>
    );
  if (row.kind === "tools")
    return (
      <li class="timeline-row is-dim" data-kind="tools">
        {timed(row.at, W.toolSteps(row.count), now)}
      </li>
    );
  if (row.kind === "comment")
    // A comment row whose words stand whole is one line; its author is the tooltip.
    return (
      <li class="timeline-row is-comment" data-kind="comment" title={owner || undefined}>
        <span class="timeline-text">{timed(row.at, row.text ?? "", now)}</span>
        {count > 1 ? <span class="timeline-count">{` ${W.repeated(count)}`}</span> : null}
      </li>
    );
  return (
    <li class="timeline-row is-said" data-kind="said">
      {timed(row.at, row.text ?? "", now)}
      {Math.max(count, row.count) > 1 ? <span class="timeline-count">{` ${W.repeated(Math.max(count, row.count))}`}</span> : null}
    </li>
  );
}

/**
 * A round's head is one history line, `time · what happened` (lina-app#123, #142): a going round its start and 진행 중,
 * an ended one its end (its start when the end is not on record) and its outcome, `×n` when it stands for n rounds of
 * that outcome in a row (lina-app#236), then its result line when it stands whole (timelineBlocks). No round number
 * (lina-app#61). Comments between rounds head their block with 댓글.
 */
function head(block: TimelineBlock, now: number): string {
  if (block.type === "comment") return W.comments;
  const at = block.outcome === "going" ? (block.start ?? block.end) : (block.end ?? block.start);
  const outcome = block.count > 1 ? `${W.outcome[block.outcome]} ${W.repeated(block.count)}` : W.outcome[block.outcome];
  return [at === null ? "" : clockAt(at, now), outcome, block.result].filter(Boolean).join(SEP);
}

/**
 * One block, open by default; its open state is the reader's and survives every refetch of the record. A round's
 * head is the link to its worker run's page when there is one to open. `modelRun` is that same worker run, and
 * the round names its model.
 */
function Block({ block, owner, link, modelRun }: { block: TimelineBlock; owner: string; link: string | null; modelRun: string | null }) {
  const { now } = useApp();
  const [open, setOpen] = useState(true);
  // A said row, a comment row or a report line that does not stand whole is folded (timelineBlocks); the round still shows its head.
  const rows = historyLines(block.rows.map((row) => ({ row, at: row.at, text: row.kind === "tools" ? "" : row.text })));
  const title = head(block, now);
  return (
    <details class="timeline-block" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)} data-testid="timeline-block" data-outcome={block.type === "round" ? block.outcome : "comment"}>
      <summary class="timeline-head">
        {link ? (
          <a class="timeline-link" href={link} data-testid="timeline-link">
            {title}
          </a>
        ) : (
          title
        )}
      </summary>
      {modelRun ? <RunModelLine runId={modelRun} class="timeline-model" /> : null}
      {block.type === "round" && block.startUnknown ? <p class="timeline-row is-dim" data-testid="timeline-no-start">{W.noStart}</p> : null}
      {rows.length ? (
        <ul class="timeline-rows">
          {rows.map((line, index) => (
            <Row key={`${line.at}:${index}`} row={line.row} owner={owner} folded={line.held.map((held) => held.row)} count={line.count} />
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** One past event of a run the record does not hold: when, and one sentence. */
export interface PastEvent {
  readonly at: number;
  readonly text: string;
}

/** A history with no record behind it (a finished run the core keeps no record for): one line per event, newest first. */
export function PastEvents({ events }: { events: readonly PastEvent[] }) {
  const { now } = useApp();
  if (!events.length) return null;
  return (
    <Box title={W.record} testid="timeline">
      <ul class="timeline-rows">
        {[...events].sort((a, b) => b.at - a.at).map((event) => (
          <li key={`${event.at}:${event.text}`} class="timeline-row is-said" data-kind="said">
            {timed(event.at, event.text, now)}
          </li>
        ))}
      </ul>
    </Box>
  );
}

/**
 * The run's own timeline (lina#201): its rounds and the comments made between them, newest first, below a detail's
 * boxes. `link` names the page a round's head opens (a card's worker run), or null, from the run whose record holds
 * the round, its number in that record and the time its head reads. `modelRun` names the worker
 * run a round was, whose model the round shows. It defaults to null, so a run's own page draws no model line on
 * its rounds: that page names the model once, under its head. A card passes the worker run each round was.
 * `fallback` is what stands when the record is not shown: under the one error line when its read failed, or
 * alone while there is no record. `boxed` says the page draws the record's comments between rounds in its own 댓글 box
 * (a card, lina-app#174): the timeline then has no comment block, so the page has one 댓글 section.
 */
export function Timeline({ runs, live, link = () => null, modelRun = () => null, fallback = null, boxed = false }: { runs: readonly string[]; live: (runId: string) => boolean; link?: (runId: string, n: number, at: number) => string | null; modelRun?: (runId: string, n: number, at: number) => string | null; fallback?: ComponentChildren; boxed?: boolean }) {
  const { model, store, now } = useApp();
  if (runs.some((id) => store.status("record", id) === "failed"))
    return (
      <>
        <Box title={W.record} testid="timeline">
          <p class="write-error" role="alert" data-testid="timeline-error">
            {W.readFailed(W.record)}
          </p>
        </Box>
        {fallback}
      </>
    );
  const records = runs.flatMap((id) => {
    const record = store.get("record", id);
    return record ? [{ id, record }] : [];
  });
  const blocks = timelineBlocks(records, live, now)
    .filter((block) => !(boxed && block.type === "comment"))
    .flatMap((block) => plainBlock(block) ?? []);
  if (!blocks.length) return <>{fallback}</>;
  const owner = agentName(model, store.get("items")?.owner?.id);
  return (
    <Box title={W.record} testid="timeline">
      {blocks.map((block) => (
        <Block key={block.key} block={block} owner={owner} link={block.type === "round" ? link(block.runId, block.n, block.at) : null} modelRun={block.type === "round" ? modelRun(block.runId, block.n, block.at) : null} />
      ))}
    </Box>
  );
}
