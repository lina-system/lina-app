import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { reportKey, type ReportSummary } from "../api/client";
import { href, navigate, parse } from "../router";
import { ago, dateClock } from "../time";
import { ReportIcon } from "../ui/icons";
import { agentName, Box, useApp } from "../ui/parts";
import { REPORT_WORD, SEP, W } from "../words";
import { ReportBody } from "./body";
import { reportOfPage, type ReportReference } from "./reference";

/**
 * Opens a report in the viewer (lina-app#50): beside the conversation on a wide window, in a sheet on a phone, in the
 * detail pane elsewhere. Opening one pushes one history entry; one opened while a report is open replaces it.
 */
export function openReport(id: string): void {
  const open = parse(window.location.hash).name === "report";
  navigate({ name: "report", id }, { replace: open });
}

/**
 * A click on a report's page address in a message (`…/reports/<id>/page`) opens the viewer instead; a modified or
 * middle click, and any other address (the old dashboard's `/r/…` among them), stays the browser's.
 */
export function reportLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  // A click can reach the bubble with the link's text node as its target (an accessibility press, some engines): the
  // link is then that node's parent.
  const target = event.target as Node | null;
  const element = target instanceof Element ? target : (target?.parentElement ?? null);
  const anchor = element?.closest("a[href]");
  const id = anchor ? reportOfPage(anchor.getAttribute("href") ?? "") : null;
  if (!id) return;
  event.preventDefault();
  openReport(id);
}

/** Reads a report a chat card draws without making it the open screen's; a card given its summary reads nothing. */
function useReport(id: string, known?: ReportSummary): ReportSummary | undefined {
  const { store } = useApp();
  useEffect(() => {
    if (!known) store.ensure([["report", id]]);
  }, [id, Boolean(known)]);
  return store.get("report", id) ?? known;
}

/**
 * One report as a card (lina-app#50), styled like a work card's row: its icon, its title on one line and one grey line
 * with the agent and when it last changed. No body: the report opens in the viewer.
 */
export function ReportCard({ id, reference, known }: { id: string; reference?: ReportReference; known?: ReportSummary }) {
  const { model, now } = useApp();
  const report = useReport(id, known);
  const title = report?.title ?? reference?.summary ?? REPORT_WORD.report;
  const meta = report ? [agentName(model, report.agent) || report.agent, `${REPORT_WORD.updated} ${ago(Math.max(0, now - report.updatedAt))}`].join(SEP) : REPORT_WORD.report;
  return (
    <a
      class="report-card"
      href={href({ name: "report", id })}
      data-testid="report-card"
      data-report={id}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openReport(id);
      }}
    >
      <span class="report-card-icon">
        <ReportIcon />
      </span>
      <span class="report-card-lines">
        <span class="report-card-title one-line">{title}</span>
        <span class="report-card-meta one-line">{meta}</span>
      </span>
    </a>
  );
}

/**
 * The reports that belong to a work card, as the same cards the conversation shows (lina-app#50): a report is reachable
 * from its work as well as from the chat. Nothing when the card has none, or the core serves no reports.
 */
export function CardReports({ id }: { id: string }) {
  const { store } = useApp();
  const reports = store.get("reports", id)?.reports ?? [];
  if (!reports.length) return null;
  return (
    <Box title={REPORT_WORD.report} testid="card-reports">
      <div class="report-cards">
        {reports.map((report) => (
          <ReportCard key={report.id} id={report.id} known={report} />
        ))}
      </div>
    </Box>
  );
}

type TextSize = "s" | "m" | "l";
const SIZE_KEY = "lina.report.size";

function savedSize(): TextSize {
  try {
    const kept = window.localStorage.getItem(SIZE_KEY);
    return kept === "s" || kept === "l" ? kept : "m";
  } catch {
    return "m";
  }
}

/**
 * The report viewer (lina-app#114, #50): the document alone, its title, the agent that wrote it, when, and its goal,
 * then the body at a reading width in one of three text sizes. One viewer for the inspector, the sheet and the detail
 * pane. The open report follows the core's change event in place, with a small mark when a newer version came in, and
 * every earlier version is one tap away.
 */
/**
 * The viewer's Escape (lina-app#50): it closes the inspector, the pane or the sheet, as Esc closes a detail pane
 * (details.tsx FrameClose). Esc typed while a syllable is composed, already taken, while the bell's list is open, or
 * while a large image is open (it closes only itself), is not this one's.
 */
function useEscape(close: (() => void) | undefined): void {
  useEffect(() => {
    if (!close) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || document.querySelector(".popover, [data-testid=report-lightbox]")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
}

export function ReportView({ id, version, onClose, onEscape }: { id: string; version?: number; onClose?: () => void; onEscape?: () => void }) {
  const { model, store, now } = useApp();
  const key = reportKey(id, version);
  const report = store.get("report", key);
  const status = store.status("report", key);
  const [size, setSize] = useState<TextSize>(savedSize);
  const [history, setHistory] = useState(false);
  // The version on screen when the viewer opened or the owner last looked at the mark.
  const [seen, setSeen] = useState<number | null>(null);
  useEscape(onEscape ?? onClose);
  useEffect(() => {
    if (report && seen === null && version === undefined) setSeen(report.version);
  }, [report?.version]);
  const choose = (next: TextSize) => {
    setSize(next);
    try {
      window.localStorage.setItem(SIZE_KEY, next);
    } catch {
      // A private window keeps the size for this report only.
    }
  };
  const close = onClose ? (
    <button type="button" class="text-button report-close" onClick={onClose} data-testid="report-close">
      {REPORT_WORD.close}
    </button>
  ) : null;
  if (!report) {
    const line = status === "missing" ? REPORT_WORD.missing : status === "failed" ? REPORT_WORD.failed : W.loading;
    return (
      <article class="report" data-testid="report">
        <div class="report-tools">{close}</div>
        <p class="empty" data-testid="report-state">
          {line}
        </p>
      </article>
    );
  }
  const updated = version === undefined && seen !== null && report.version > seen;
  // The time of the version on screen: `updatedAt` is the report's newest change, an earlier version's is its own (`versions[].at`).
  const shownAt = report.versions.find((each) => each.version === report.shownVersion)?.at ?? report.updatedAt;
  const goal = report.goal ? (store.get("item", report.goal)?.title ?? model.items.get(report.goal)?.title ?? null) : null;
  const versions = [...report.versions].sort((a, b) => b.version - a.version);
  const show = (n: number) => navigate({ name: "report", id, ...(n === report.version ? {} : { version: n }) }, { replace: true });
  return (
    <article class="report" data-size={size} data-testid="report" data-version={report.shownVersion}>
      <div class="report-tools">
        <div class="report-sizes" role="radiogroup" aria-label={REPORT_WORD.textSize}>
          {(["s", "m", "l"] as const).map((each) => (
            <button key={each} type="button" role="radio" aria-checked={size === each} class="report-size" data-size={each} onClick={() => choose(each)} aria-label={REPORT_WORD.sizes[each]}>
              가
            </button>
          ))}
        </div>
        <button type="button" class="text-button" aria-expanded={history} onClick={() => setHistory(!history)} data-testid="report-history">
          {REPORT_WORD.versions(versions.length)}
        </button>
        {close}
      </div>
      <header class="report-head">
        <h1 class="report-title">{report.title}</h1>
        <p class="report-meta">
          <span>{agentName(model, report.agent) || report.agent}</span>
          {SEP}
          <time dateTime={new Date(shownAt * 1000).toISOString()} title={dateClock(shownAt)} data-testid="report-time">
            {`${REPORT_WORD.updated} ${ago(Math.max(0, now - shownAt))}`}
          </time>
          {SEP}
          <span>{REPORT_WORD.version(report.shownVersion)}</span>
          {updated ? (
            <button type="button" class="report-updated" data-testid="report-updated" onClick={() => setSeen(report.version)}>
              {REPORT_WORD.updatedNow}
            </button>
          ) : null}
        </p>
        {report.goal ? (
          <a class="report-goal" href={href({ name: "goal", id: report.goal })} data-testid="report-goal">
            {[REPORT_WORD.goal, goal ?? report.goal].join(SEP)}
          </a>
        ) : null}
      </header>
      {version !== undefined ? (
        <p class="report-older" data-testid="report-older">
          {REPORT_WORD.olderShown(report.shownVersion)}
          <button type="button" class="text-button" onClick={() => navigate({ name: "report", id }, { replace: true })}>
            {REPORT_WORD.newest}
          </button>
        </p>
      ) : null}
      {history ? (
        <ol class="report-versions" aria-label={REPORT_WORD.history} data-testid="report-versions">
          {versions.map((each) => (
            <li key={each.version}>
              <button type="button" class="report-version" aria-current={each.version === report.shownVersion ? "true" : undefined} onClick={() => show(each.version)}>
                <span class="report-version-n">{REPORT_WORD.version(each.version)}</span>
                <span class="report-version-at">{dateClock(each.at)}</span>
                <span class="report-version-line one-line">{each.summary}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <ReportBody key={key} reportId={id} body={report.body} revision={`${report.shownVersion}:${report.updatedAt}:${store.reportChanges(id)}`} loadImage={(position, signal) => store.source.reportImage(id, position, signal)} />
    </article>
  );
}

const WIDTH_KEY = "lina.report.width";
const MIN_WIDTH = 320;
/** The conversation keeps at least this much beside the inspector, inside its own separator line. */
const CHAT_ROOM = 360;

function savedWidth(): number {
  try {
    const kept = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(kept) && kept >= MIN_WIDTH ? kept : 460;
  } catch {
    return 460;
  }
}

/**
 * The inspector on a wide window (lina-app#50): the report beside the conversation, which stays usable. Its left edge
 * drags (or takes the arrow keys) to make it wider or narrower, and the width is kept for the next report. It `fits` only
 * while the window holds the chat's 360 px, its line and the inspector's 320 px; else the report takes the narrow
 * screen's sheet and the kept width waits for a wider window (lina-app#274).
 */
export function useInspectorWidth(panes: { current: HTMLElement | null }): { width: number; fits: boolean; handle: ComponentChildren } {
  const [width, setWidth] = useState(savedWidth);
  // The panes' room as laid out, its fraction kept (clientWidth rounds it), measured again when the window resizes. It
  // is their parent's width: the panes themselves grow past a narrowed window to hold a wide inspector.
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const box = panes.current?.parentElement;
    if (!box) return;
    const measure = () => setRoom(box.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // The widest the inspector may be (lina-app#274): the conversation keeps CHAT_ROOM inside its separator line, at the
  // width that line is drawn (0.5 px on a 2x screen, 1 px on others), rounded down so no fraction takes from it.
  const widest = () => {
    const chat = panes.current?.firstElementChild;
    if (!room || !chat) return Infinity;
    const line = getComputedStyle(chat);
    return Math.floor(room - CHAT_ROOM - (parseFloat(line.borderLeftWidth) || 0) - (parseFloat(line.borderRightWidth) || 0));
  };
  const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(Math.round(value), widest()));
  const keep = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // A private window keeps the width for this page only.
    }
  };
  const dragging = useRef(false);
  const shown = clamp(width);
  const max = widest();
  const handle = (
    <div
      class="report-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={REPORT_WORD.resize}
      aria-valuenow={shown}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      tabIndex={0}
      data-testid="report-resize"
      onPointerDown={(event) => {
        dragging.current = true;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!dragging.current || !panes.current) return;
        keep(panes.current.getBoundingClientRect().right - event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        keep(shown + (event.key === "ArrowLeft" ? 32 : -32));
      }}
    />
  );
  return { width: shown, fits: max >= MIN_WIDTH, handle };
}

/** How far down a sheet must be dragged to close: a quarter of its height (the old panel's rule, lina-app#50). */
const CLOSE_SHARE = 0.25;

/**
 * The report's sheet on a phone (lina-app#50): it opens at about half the screen, its bar drags up to the whole screen
 * or down past a quarter to close (the same close as its button, the scrim and back), and snaps back otherwise. Each
 * report the sheet opens (`report`, its id; empty while none is open) starts at half again.
 */
export function useSheetDrag(onClose: () => void, report: string): { height: "half" | "full"; offset: number; bar: Record<string, unknown> } {
  // The height belongs to the report it was set for: another report reads half from its first frame.
  const [kept, setKept] = useState<{ report: string; height: "half" | "full" }>({ report, height: "half" });
  const height = kept.report === report ? kept.height : "half";
  const setHeight = (next: "half" | "full") => setKept({ report, height: next });
  // Closed: the next opening, of this report too, starts at half (nothing is drawn while none is open).
  useEffect(() => {
    if (!report && kept.report) setKept({ report: "", height: "half" });
  }, [report]);
  const [offset, setOffset] = useState(0);
  const start = useRef<{ y: number; size: number } | null>(null);
  const bar = {
    onPointerDown: (event: PointerEvent) => {
      if ((event.target as Element).closest("button")) return;
      const sheet = (event.currentTarget as HTMLElement).parentElement;
      start.current = { y: event.clientY, size: sheet?.getBoundingClientRect().height ?? window.innerHeight };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent) => {
      if (start.current) setOffset(event.clientY - start.current.y);
    },
    onPointerUp: (event: PointerEvent) => {
      const from = start.current;
      start.current = null;
      setOffset(0);
      if (!from) return;
      const moved = event.clientY - from.y;
      if (moved > from.size * CLOSE_SHARE) onClose();
      else if (moved < -40) setHeight("full");
      else if (moved > 40 && height === "full") setHeight("half");
    },
    onPointerCancel: () => {
      start.current = null;
      setOffset(0);
    },
    onDblClick: () => setHeight(height === "full" ? "half" : "full"),
  };
  return { height, offset, bar };
}
