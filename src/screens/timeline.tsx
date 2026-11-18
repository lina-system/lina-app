import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { PlainHistoryLine, Settings } from "../api/client";
import { plainText } from "../model/plain";
import { runModelLine } from "../model/settings";
import { cardHistory, historyLines, timelineBlocks, type CardHistoryLine, type TimelineBlock, type TimelineRow } from "../model/timeline";
import { linkClick } from "../router";
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

/** One row of a block that stands whole: a block's rows that do not, tool steps among them, are the timeline's one folded line (Timeline). */
function Row({ row, owner, count }: { row: TimelineRow; owner: string; count: number }) {
  const { now } = useApp();
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
 * that outcome in a row (lina-app#236), then its result line or the one sentence of its own it reads (timelineBlocks), never a comment's (lina-app#269).
 * A closed round with neither reads its outcome's one sentence instead (W.outcomeSaid, criterion 2). No round number
 * (lina-app#61). Comments between rounds head their block with 댓글.
 */
function head(block: TimelineBlock, now: number): string {
  if (block.type === "comment") return W.comments;
  const at = block.outcome === "going" ? (block.start ?? block.end) : (block.end ?? block.start);
  const repeated = block.count > 1 ? ` ${W.repeated(block.count)}` : "";
  const words = block.result || block.outcome === "going" ? [`${W.outcome[block.outcome]}${repeated}`, block.result] : [`${W.outcomeSaid[block.outcome]}${repeated}`];
  return [at === null ? "" : clockAt(at, now), ...words].filter(Boolean).join(SEP);
}

/**
 * One block, open by default; its open state is the reader's and survives every refetch of the record. A round's
 * head is the link to its worker run's page when there is one to open. `modelRun` is that same worker run, and
 * the round names its model.
 */
function Block({ block, owner, link, modelRun }: { block: TimelineBlock; owner: string; link: string | null; modelRun: string | null }) {
  const { now } = useApp();
  const [open, setOpen] = useState(true);
  // A said row, a comment row or a report line that does not stand whole is folded (timelineBlocks) into the timeline's one
  // folded line, never a line between two rounds; the round still shows its head.
  const rows = historyLines(block.rows.filter((row) => !folded(row)).map((row) => ({ row, at: row.at, text: row.text })));
  const title = head(block, now);
  return (
    <details class="timeline-block" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)} data-testid="timeline-block" data-outcome={block.type === "round" ? block.outcome : "comment"}>
      <summary class="timeline-head">
        {link ? (
          <a class="timeline-link" href={link} onClick={linkClick} data-testid="timeline-link">
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
            <Row key={`${line.at}:${index}`} row={line.row} owner={owner} count={line.count} />
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** A row that does not stand whole, or a tool step (timelineBlocks): no line of its own. */
const folded = (row: TimelineRow) => row.text === null;

/**
 * Every row of the timeline that does not stand whole, newest first, as one folded line after the last line (criterion
 * 2): 접힌 댓글 when they are all comments, else 접힌 기록, at the newest one's time as every line reads a time. It
 * opens to each as the record holds it, with its time (lina-app#241), so no line between two rounds is a folded one.
 */
function FoldedRows({ rows: given }: { rows: readonly TimelineRow[] }) {
  const rows = given.filter(folded).sort((a, b) => b.at - a.at);
  if (!rows.length) return null;
  return (
    <ul class="timeline-rows">
      <li class="timeline-row is-dim" data-kind="folded">
        <FoldLine label={rows.every((row) => row.kind === "comment") ? W.foldedRun(rows.length) : DETAIL_WORD.foldedRecords(rows.length)} held={rows.map((row) => ({ at: row.at, by: null, text: row.source ?? "" }))} at={rows[0].at} />
      </li>
    </ul>
  );
}

/**
 * A card's history line (G138): `time · what it did`, then the verdicts of the rounds that ended in it as small marks,
 * each the link to its round's worker run when there is one to open.
 */
function HistoryLine({ line, link }: { line: CardHistoryLine; link: (runId: string, n: number, at: number) => string | null }) {
  const { now } = useApp();
  return (
    <li class="timeline-row is-step" data-kind="step" data-testid="history-line">
      <span class="timeline-text">{timed(line.at, line.text, now)}</span>
      {line.marks.map((mark) => {
        const href = link(mark.runId, mark.n, mark.at);
        const word = `${W.outcome[mark.outcome]}${mark.count > 1 ? ` ${W.repeated(mark.count)}` : ""}`;
        return href ? (
          <a key={`${mark.outcome}:${mark.at}`} class="timeline-mark" href={href} onClick={linkClick} data-testid="history-mark" data-outcome={mark.outcome}>
            {word}
          </a>
        ) : (
          <span key={`${mark.outcome}:${mark.at}`} class="timeline-mark" data-testid="history-mark" data-outcome={mark.outcome}>
            {word}
          </span>
        );
      })}
    </li>
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
 * (a card, lina-app#174): the timeline then has no comment block, so the page has one 댓글 section, and the rounds around
 * a comment count as one line (lina-app#269). `doing` is what the card does now (cardNow), which its going round's line
 * reads (G138). `history` is a card's steps (`plain.history`, G138): given, its lines are the 기록 (CardRecord).
 */
export function Timeline({ runs, live, link = () => null, modelRun = () => null, fallback = null, boxed = false, doing = null, history }: { runs: readonly string[]; live: (runId: string) => boolean; link?: (runId: string, n: number, at: number) => string | null; modelRun?: (runId: string, n: number, at: number) => string | null; fallback?: ComponentChildren; boxed?: boolean; doing?: string | null; history?: readonly PlainHistoryLine[] }) {
  const { model, store, now } = useApp();
  if (history) return <CardRecord history={history} runs={runs} live={live} link={link} modelRun={modelRun} fallback={fallback} doing={doing} />;
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
  const blocks = timelineBlocks(records, live, now, { doing, comments: !boxed }).flatMap((block) => plainBlock(block) ?? []);
  if (!blocks.length) return <>{fallback}</>;
  const owner = agentName(model, store.get("items")?.owner?.id);
  return (
    <Box title={W.record} testid="timeline">
      {blocks.map((block) => (
        <Block key={block.key} block={block} owner={owner} link={block.type === "round" ? link(block.runId, block.n, block.at) : null} modelRun={block.type === "round" ? modelRun(block.runId, block.n, block.at) : null} />
      ))}
      <FoldedRows rows={blocks.flatMap((block) => block.rows)} />
    </Box>
  );
}

/**
 * A card's 기록 (G138, lina-app#269): one line per step of its history, newest first, `time · what it did`, each round's
 * verdict a small mark beside the line it ended in (cardHistory), and every sentence or verdict with no line of its own
 * one folded line under them. Its rounds' blocks are no line: a card the core has no history for yet keeps them or its
 * worker runs' box under one 이전 기록 fold, closed, so nothing on it reads before it opens. A failed record read is one
 * error line on top either way, and with steps its worker runs' box stands open under them.
 */
function CardRecord({ history, runs, live, link, modelRun, fallback, doing }: { history: readonly PlainHistoryLine[]; runs: readonly string[]; live: (runId: string) => boolean; link: (runId: string, n: number, at: number) => string | null; modelRun: (runId: string, n: number, at: number) => string | null; fallback: ComponentChildren; doing: string | null }) {
  const { model, store, now } = useApp();
  const records = runs.flatMap((id) => {
    const record = store.get("record", id);
    return record ? [{ id, record }] : [];
  });
  const { lines, folded: unread } = cardHistory(history, records, live, now);
  const failed = runs.some((id) => store.status("record", id) === "failed");
  const error = failed ? (
    <p class="write-error" role="alert" data-testid="timeline-error">
      {W.readFailed(W.record)}
    </p>
  ) : null;
  // A failed read keeps the steps: the error line stands over them and the worker links under them, open.
  if (lines.length)
    return (
      <Box title={W.record} testid="timeline">
        {error}
        <ul class="timeline-rows is-history">
          {lines.map((line) => (
            <HistoryLine key={`${line.at}:${line.text}`} line={line} link={link} />
          ))}
        </ul>
        <FoldedRows rows={unread} />
        {failed ? fallback : null}
      </Box>
    );
  const blocks = failed ? [] : timelineBlocks(records, live, now, { doing, comments: false }).flatMap((block) => plainBlock(block) ?? []);
  const owner = agentName(model, store.get("items")?.owner?.id);
  const earlier = blocks.length ? (
    <>
      {blocks.map((block) => (
        <Block key={block.key} block={block} owner={owner} link={block.type === "round" ? link(block.runId, block.n, block.at) : null} modelRun={block.type === "round" ? modelRun(block.runId, block.n, block.at) : null} />
      ))}
      <FoldedRows rows={[...unread, ...blocks.flatMap((block) => block.rows)]} />
    </>
  ) : fallback ? (
    <>
      {fallback}
      <FoldedRows rows={unread} />
    </>
  ) : unread.length ? (
    <FoldedRows rows={unread} />
  ) : null;
  if (!earlier && !failed) return null;
  return (
    <Box title={W.record} testid="timeline">
      {error}
      {earlier ? (
        <details class="timeline-earlier" data-testid="earlier-records">
          <summary class="timeline-earlier-head" data-testid="earlier-records-head">{DETAIL_WORD.earlier}</summary>
          {earlier}
        </details>
      ) : null}
    </Box>
  );
}
