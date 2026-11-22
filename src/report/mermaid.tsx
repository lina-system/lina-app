import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { REPORT_WORD } from "../words";
import { BrokenBlock } from "./broken";

/**
 * A Mermaid diagram in a report (lina-app#83), in the app's colours light and dark. The library loads only when a
 * report holds a diagram. It runs at securityLevel `strict`: labels are text, no click handlers or scripts, and the
 * SVG it returns is sanitized by its DOMPurify pass; a diagram's own `%%{init}%%` cannot lift that level (Mermaid keeps
 * securityLevel among its secure keys). A wide diagram is zoomed with three buttons and dragged sideways in its box.
 */
type Mermaid = (typeof import("mermaid"))["default"];

let library: Promise<Mermaid> | null = null;

function mermaid(): Promise<Mermaid> {
  library ??= import("mermaid").then((module) => module.default);
  return library;
}

/** A token's colour as the browser resolves it (`rgb(…)`), which Mermaid's colour parser reads. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${name}, ${fallback})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color || fallback;
  probe.remove();
  return color;
}

function dark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Mermaid's base theme painted with the app's tokens (tokens.css). */
export function themeVariables(): Record<string, string | boolean> {
  const label = token("--label", "#000");
  const bg = token("--bg", "#fff");
  const fill = token("--bg-2", "#f2f2f7");
  const line = token("--label-2", "#666");
  const accent = token("--accent", "#007aff");
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "sans-serif";
  return {
    darkMode: dark(),
    background: bg,
    fontFamily: font,
    fontSize: "14px",
    primaryColor: fill,
    primaryTextColor: label,
    primaryBorderColor: accent,
    secondaryColor: bg,
    secondaryTextColor: label,
    secondaryBorderColor: line,
    tertiaryColor: bg,
    tertiaryTextColor: label,
    tertiaryBorderColor: line,
    lineColor: line,
    textColor: label,
    mainBkg: fill,
    nodeBorder: accent,
    clusterBkg: bg,
    clusterBorder: line,
    edgeLabelBackground: bg,
    noteBkgColor: fill,
    noteTextColor: label,
    noteBorderColor: line,
    actorBkg: fill,
    actorBorder: accent,
    actorTextColor: label,
    signalColor: label,
    signalTextColor: label,
  };
}

let drawn = 0;

type Drawing = { readonly svg: string; readonly width: number } | { readonly error: string } | null;

/** The first line of what Mermaid said, short enough for one line under the source. */
export function oneLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n").find((each) => each.trim()) ?? text;
  return line.trim().slice(0, 160);
}

export function MermaidBlock({ source }: { source: string }) {
  const [drawing, setDrawing] = useState<Drawing>(null);
  const [scheme, setScheme] = useState(dark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setScheme(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let live = true;
    const id = `report-mermaid-${(drawn += 1)}`;
    void (async () => {
      try {
        const lib = await mermaid();
        lib.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: themeVariables(), flowchart: { htmlLabels: false } });
        const { svg } = await lib.render(id, source);
        const width = Number(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1] ?? 0);
        if (live) setDrawing({ svg, width });
      } catch (error) {
        // A failed render can leave its error drawing in the page.
        document.getElementById(`d${id}`)?.remove();
        if (live) setDrawing({ error: oneLine(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [source, scheme]);
  if (drawing && "error" in drawing) return <BrokenBlock kind={REPORT_WORD.diagram} error={drawing.error} source={source} />;
  return (
    <figure class="report-diagram" aria-busy={drawing ? undefined : "true"}>
      {drawing ? <Zoomable svg={drawing.svg} width={drawing.width} /> : <p class="report-diagram-wait">{REPORT_WORD.drawing}</p>}
    </figure>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
/** The space around the diagram inside its box (`.report-diagram-svg` padding, both sides): the fit leaves room for it. */
const DIAGRAM_PADDING = 24;
/** Below this a diagram's words are too small to read: a wider one starts here and drags sideways instead. */
const FIRST_ZOOM_MIN = 0.75;

/**
 * The diagram at its own width, or the box's when that is narrower (never below FIRST_ZOOM_MIN), zoomed by steps; a
 * mouse drags it like a finger.
 */
function Zoomable({ svg, width }: { svg: string; width: number }) {
  const box = useRef<HTMLDivElement>(null);
  // The room the box has now (lina-app#274): it changes when the inspector is resized, and is none inside a closed fold
  // until the fold opens.
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setRoom(Math.max(0, element.clientWidth - DIAGRAM_PADDING));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = width > 0 && room > 0 ? Math.min(1, room / width) : 1;
  // A zoom the owner chose stays; 맞춤 (`fit`) follows the box. The first zoom is set once the box has room.
  const [zoom, setZoom] = useState<number | "fit" | null>(null);
  useLayoutEffect(() => {
    if (room > 0) setZoom((current) => current ?? Math.max(fit, Math.min(1, FIRST_ZOOM_MIN)));
  }, [room > 0]);
  const scale = zoom === "fit" ? fit : (zoom ?? fit);
  // The steps are the fixed ones and the fit, in order; minus stops at the smallest, plus at the largest.
  const steps = [...new Set([...ZOOMS, fit])].sort((a, b) => a - b);
  const lower = [...steps].reverse().find((each) => each < scale - 0.005);
  const higher = steps.find((each) => each > scale + 0.005);
  const step = (way: 1 | -1) => {
    const next = way > 0 ? higher : lower;
    if (next !== undefined) setZoom(next);
  };
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !box.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: box.current.scrollLeft, top: box.current.scrollTop };
    box.current.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag.current || !box.current) return;
    box.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    box.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const end = () => {
    drag.current = null;
  };
  return (
    <>
      <div class="report-diagram-tools">
        <button type="button" class="text-button" onClick={() => step(-1)} aria-label={REPORT_WORD.zoomOut} disabled={lower === undefined}>
          −
        </button>
        <button type="button" class="text-button" onClick={() => setZoom("fit")}>
          {REPORT_WORD.zoomFit}
        </button>
        <button type="button" class="text-button" onClick={() => step(1)} aria-label={REPORT_WORD.zoomIn} disabled={higher === undefined}>
          +
        </button>
        <span class="report-diagram-zoom" data-testid="diagram-zoom">
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div class="report-diagram-box" ref={box} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
        <div class="report-diagram-svg" style={width ? { width: `${Math.round(width * scale)}px` } : undefined} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </>
  );
}
