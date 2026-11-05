import { useState } from "preact/hooks";
import type { RecordRow } from "../api/client";
import { foldReason } from "../model/fold";
import { timelineBlocks, type TimelineBlock } from "../model/timeline";
import { clockAt } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { SEP, W } from "../words";

/** A line the screen may show as it is, or the neutral word in its place (no raw English, paths, commands or ids). */
function shown(text: string | null, hidden: string): { text: string; raw: boolean } {
  return text && !foldReason(text) ? { text, raw: false } : { text: hidden, raw: true };
}

function Row({ row, owner, timed = true }: { row: RecordRow; owner: string; timed?: boolean }) {
  const { now } = useApp();
  const times = row.count > 1 ? <span class="timeline-count">{` ${W.repeated(row.count)}`}</span> : null;
  if (row.kind === "tools")
    return (
      <li class="timeline-row is-dim" data-kind="tools">
        {W.toolSteps(row.count)}
      </li>
    );
  if (row.kind === "comment") {
    const line = shown(row.text, W.folded);
    return (
      <li class={line.raw ? "timeline-row is-comment is-dim" : "timeline-row is-comment"} data-kind="comment">
        <span class="timeline-text">{line.text}</span>
        <span class="sub">{[owner, timed ? clockAt(row.at, now) : ""].filter(Boolean).join(SEP)}</span>
      </li>
    );
  }
  const line = shown(row.text, W.hiddenLine);
  return (
    <li class={line.raw ? "timeline-row is-dim" : "timeline-row is-said"} data-kind="said">
      {line.text}
      {times}
    </li>
  );
}

function head(block: TimelineBlock, now: number): string {
  if (block.type === "comment") return [W.comments, clockAt(block.at, now)].join(SEP);
  const start = block.start === null ? "" : clockAt(block.start, now);
  const end = block.end === null ? "" : clockAt(block.end, now);
  const span = start && end ? `${start}–${end}` : start || (end ? `–${end}` : "");
  return [span, W.outcome[block.outcome]].filter(Boolean).join(SEP);
}

/** One block, open by default; its open state is the reader's and survives every refetch of the record. */
function Block({ block, owner }: { block: TimelineBlock; owner: string }) {
  const { now } = useApp();
  const [open, setOpen] = useState(true);
  const result = block.type === "round" && block.result ? shown(block.result, W.hiddenLine) : null;
  return (
    <details class="timeline-block" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)} data-testid="timeline-block" data-outcome={block.type === "round" ? block.outcome : "comment"}>
      <summary class="timeline-head">{head(block, now)}</summary>
      {block.type === "round" && block.startUnknown ? <p class="timeline-row is-dim" data-testid="timeline-no-start">{W.noStart}</p> : null}
      <ul class="timeline-rows">
        {block.rows.map((row, index) => (
          <Row key={`${row.at}:${index}`} row={row} owner={owner} timed={block.type === "round"} />
        ))}
      </ul>
      {result ? (
        <p class={result.raw ? "timeline-result is-dim" : "timeline-result"} data-testid="timeline-result">
          <span class="timeline-label">{W.result}</span>
          {result.text}
        </p>
      ) : null}
    </details>
  );
}

/**
 * The run's own timeline (lina#201): its rounds and the comments made between them, newest first, below a detail's
 * boxes. A failed read shows one error line in its place; the rest of the detail keeps working.
 */
export function Timeline({ runs, live }: { runs: readonly string[]; live: (runId: string) => boolean }) {
  const { model, store, now } = useApp();
  if (runs.some((id) => store.status("record", id) === "failed"))
    return (
      <Box title={W.record} testid="timeline">
        <p class="write-error" role="alert" data-testid="timeline-error">
          {W.readFailed(W.record)}
        </p>
      </Box>
    );
  const records = runs.flatMap((id) => {
    const record = store.get("record", id);
    return record ? [{ id, record }] : [];
  });
  const blocks = timelineBlocks(records, live, now);
  if (!blocks.length) return null;
  const owner = agentName(model, store.get("items")?.owner?.id);
  return (
    <Box title={W.record} testid="timeline">
      {blocks.map((block) => (
        <Block key={block.key} block={block} owner={owner} />
      ))}
    </Box>
  );
}
