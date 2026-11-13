import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { RecordRow, Settings } from "../api/client";
import { foldReason } from "../model/fold";
import { runModelLine } from "../model/settings";
import { timelineBlocks, type TimelineBlock } from "../model/timeline";
import { clockAt } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { SEP, W } from "../words";

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

/** A line the screen may show as it is: no raw English, paths, commands or ids. */
function clean(text: string | null): text is string {
  return Boolean(text) && !foldReason(text ?? "");
}

/** One event of a history: `time · one sentence` on one line (lina-app#123, #128). */
function timed(at: number, text: string, now: number): string {
  return [clockAt(at, now), text].join(SEP);
}

function Row({ row, owner }: { row: RecordRow; owner: string }) {
  const { now } = useApp();
  if (row.kind === "tools")
    return (
      <li class="timeline-row is-dim" data-kind="tools">
        {timed(row.at, W.toolSteps(row.count), now)}
      </li>
    );
  if (row.kind === "comment") {
    // The owner's comment stays, folded when its text would show raw text (접힌 댓글), as in the comments box.
    const text = clean(row.text) ? row.text : null;
    return (
      <li class={text ? "timeline-row is-comment" : "timeline-row is-comment is-dim"} data-kind="comment">
        <span class="timeline-text">{timed(row.at, text ?? W.folded, now)}</span>
        {owner ? <span class="sub">{` ${owner}`}</span> : null}
      </li>
    );
  }
  return (
    <li class="timeline-row is-said" data-kind="said">
      {timed(row.at, row.text ?? "", now)}
      {row.count > 1 ? <span class="timeline-count">{` ${W.repeated(row.count)}`}</span> : null}
    </li>
  );
}

/**
 * A round's head: its own start and end (the end alone when its start is not on record) and its outcome, with no round
 * number (lina-app#61: rounds are not for the owner to count). Comments between rounds head their block with 댓글.
 */
function head(block: TimelineBlock, now: number): string {
  if (block.type === "comment") return W.comments;
  const start = block.start === null ? "" : clockAt(block.start, now);
  const end = block.end === null ? "" : clockAt(block.end, now);
  const span = start && end ? `${start}–${end}` : start || end;
  return [span, W.outcome[block.outcome]].filter(Boolean).join(SEP);
}

/**
 * One block, open by default; its open state is the reader's and survives every refetch of the record. A round's
 * head is the link to its worker run's page when there is one to open. `modelRun` is that same worker run, and
 * the round names its model.
 */
function Block({ block, owner, link, modelRun }: { block: TimelineBlock; owner: string; link: string | null; modelRun: string | null }) {
  const { now } = useApp();
  const [open, setOpen] = useState(true);
  // A sentence or a result line that would show raw text is left out; the round still shows its head.
  const rows = block.rows.filter((row) => row.kind !== "said" || clean(row.text));
  const result = block.type === "round" && clean(block.result) ? block.result : null;
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
          {rows.map((row, index) => (
            <Row key={`${row.at}:${index}`} row={row} owner={owner} />
          ))}
        </ul>
      ) : null}
      {result ? (
        <p class="timeline-result" data-testid="timeline-result">
          {timed(block.type === "round" ? (block.end ?? block.at) : block.at, result, now)}
        </p>
      ) : null}
    </details>
  );
}

/** One past event of a run the record does not hold: when, and one sentence. */
export interface PastEvent {
  readonly at: number;
  readonly text: string;
}

/** A history with no record behind it (a finished run the core keeps no record for): one line per event, oldest first. */
export function PastEvents({ events }: { events: readonly PastEvent[] }) {
  const { now } = useApp();
  if (!events.length) return null;
  return (
    <Box title={W.record} testid="timeline">
      <ul class="timeline-rows">
        {events.map((event) => (
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
 * boxes. `link` names the page a round's head opens (a card's worker run), or null. `modelRun` names the worker
 * run a round was, whose model the round shows. It defaults to null, so a run's own page draws no model line on
 * its rounds: that page names the model once, under its head. A card passes the worker run each round was.
 * `fallback` is what stands when the record is not shown: under the one error line when its read failed, or
 * alone while there is no record.
 */
export function Timeline({ runs, live, link = () => null, modelRun = () => null, fallback = null }: { runs: readonly string[]; live: (runId: string) => boolean; link?: (runId: string, n: number) => string | null; modelRun?: (runId: string, n: number) => string | null; fallback?: ComponentChildren }) {
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
  const blocks = timelineBlocks(records, live, now);
  if (!blocks.length) return <>{fallback}</>;
  const owner = agentName(model, store.get("items")?.owner?.id);
  return (
    <Box title={W.record} testid="timeline">
      {blocks.map((block) => (
        <Block key={block.key} block={block} owner={owner} link={block.type === "round" ? link(block.runId, block.n) : null} modelRun={block.type === "round" ? modelRun(block.runId, block.n) : null} />
      ))}
    </Box>
  );
}
