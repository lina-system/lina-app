import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { RecordRow, Settings } from "../api/client";
import { foldReason } from "../model/fold";
import { runModelLine } from "../model/settings";
import { timelineBlocks, type TimelineBlock } from "../model/timeline";
import { clockAt } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { SEP, W } from "../words";

/** The model a worker run used: its record once the screen has read it, else the run card the board lists. */
export function RunModelLine({ runId, class: className = "sub" }: { runId: string; class?: string }) {
  const { model, store } = useApp();
  const run = store.get("record", runId)?.model ?? model.runs.get(runId)?.model ?? null;
  const settings: Settings = store.get("settings")?.settings ?? {};
  const line = runModelLine(run, settings, store.get("settingsModels")?.models ?? []);
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

function Row({ row, owner, timed = true }: { row: RecordRow; owner: string; timed?: boolean }) {
  const { now } = useApp();
  if (row.kind === "tools")
    return (
      <li class="timeline-row is-dim" data-kind="tools">
        {W.toolSteps(row.count)}
      </li>
    );
  if (row.kind === "comment") {
    // The owner's comment stays, folded when its text would show raw text (접힌 댓글), as in the comments box.
    const ok = clean(row.text);
    return (
      <li class={ok ? "timeline-row is-comment" : "timeline-row is-comment is-dim"} data-kind="comment">
        <span class="timeline-text">{ok ? row.text : W.folded}</span>
        <span class="sub">{[owner, timed ? clockAt(row.at, now) : ""].filter(Boolean).join(SEP)}</span>
      </li>
    );
  }
  return (
    <li class="timeline-row is-said" data-kind="said">
      {row.text}
      {row.count > 1 ? <span class="timeline-count">{` ${W.repeated(row.count)}`}</span> : null}
    </li>
  );
}

/** A round's head: 라운드 n, its own start and end (the end alone when its start is not on record), its outcome. */
function head(block: TimelineBlock, now: number): string {
  if (block.type === "comment") return [W.comments, clockAt(block.at, now)].join(SEP);
  const start = block.start === null ? "" : clockAt(block.start, now);
  const end = block.end === null ? "" : clockAt(block.end, now);
  const span = start && end ? `${start}–${end}` : start || end;
  return [W.round(block.n), span, W.outcome[block.outcome]].filter(Boolean).join(SEP);
}

/**
 * One block, open by default; its open state is the reader's and survives every refetch of the record. A round's
 * head is the link to its worker run's page when there is one to open.
 */
function Block({ block, owner, link }: { block: TimelineBlock; owner: string; link: string | null }) {
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
      {block.type === "round" ? <RunModelLine runId={block.runId} class="timeline-model" /> : null}
      {block.type === "round" && block.startUnknown ? <p class="timeline-row is-dim" data-testid="timeline-no-start">{W.noStart}</p> : null}
      {rows.length ? (
        <ul class="timeline-rows">
          {rows.map((row, index) => (
            <Row key={`${row.at}:${index}`} row={row} owner={owner} timed={block.type === "round"} />
          ))}
        </ul>
      ) : null}
      {result ? (
        <p class="timeline-result" data-testid="timeline-result">
          <span class="timeline-label">{W.result}</span>
          {result}
        </p>
      ) : null}
    </details>
  );
}

/**
 * The run's own timeline (lina#201): its rounds and the comments made between them, newest first, below a detail's
 * boxes. `link` names the page a round's head opens (a card's worker run), or null. `fallback` is what stands when
 * the record is not shown: under the one error line when its read failed, or alone while there is no record.
 */
export function Timeline({ runs, live, link = () => null, fallback = null }: { runs: readonly string[]; live: (runId: string) => boolean; link?: (runId: string, n: number) => string | null; fallback?: ComponentChildren }) {
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
        <Block key={block.key} block={block} owner={owner} link={block.type === "round" ? link(block.runId, block.n) : null} />
      ))}
    </Box>
  );
}
