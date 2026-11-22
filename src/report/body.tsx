import type { VNode } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ReportImage } from "../data/source";
import { docBlocks, type DocImage, type DocRules } from "../markdown";
import { REPORT_WORD } from "../words";
import { blockFence } from "./blocks";

/**
 * Where a report's image lives, by its place among the report's own images (lina#263's image route), or null when its
 * address is anything else: another site, another report, a data or file address. Only `images/<n>` and
 * `/reports/<this report>/images/<n>` are the report's own (lina-app#114); the rest are never fetched.
 */
export function ownImage(reportId: string, src: string): number | null {
  const own = /^(?:\.\/)?images\/(\d{1,4})$/.exec(src) ?? new RegExp(`^/reports/${reportId}/images/(\\d{1,4})$`).exec(src);
  return own ? Number(own[1]) : null;
}

interface Shown {
  readonly url: string;
  readonly caption: string;
}

/** A position's image: still loading, drawn from an address, or refused. */
type Loaded = string | "failed";

/**
 * Loads the report's own images at these places through the page's source (with its credentials), again whenever the
 * report's revision moves: a new version, or a change event that replaced only its image files (lina-app#114). An image
 * on screen stays until its new answer comes, then its old address is released; an answer to a read that a newer one
 * replaced is released and never drawn; a place the body no longer holds, and every place when the body goes, is
 * released at once.
 */
function useImages(reportId: string, revision: string, positions: readonly number[], load: (position: number, signal: AbortSignal) => Promise<ReportImage>): ReadonlyMap<number, Loaded> {
  const [loaded, setLoaded] = useState<ReadonlyMap<number, Loaded>>(new Map());
  const drawn = useRef(new Map<number, () => void>());
  const key = `${reportId}:${revision}:${positions.join(",")}`;
  useEffect(() => {
    const abort = new AbortController();
    for (const [position, release] of drawn.current)
      if (!positions.includes(position)) {
        release();
        drawn.current.delete(position);
      }
    setLoaded((before) => new Map([...before].filter(([position]) => positions.includes(position))));
    for (const position of positions)
      void load(position, abort.signal).then((image) => {
        if (abort.signal.aborted) {
          if (image.ok) image.release();
          return;
        }
        drawn.current.get(position)?.();
        if (image.ok) drawn.current.set(position, () => image.release());
        else drawn.current.delete(position);
        setLoaded((before) => new Map(before).set(position, image.ok ? image.url : "failed"));
      });
    return () => abort.abort();
  }, [key]);
  useEffect(
    () => () => {
      for (const release of drawn.current.values()) release();
      drawn.current.clear();
    },
    [],
  );
  return loaded;
}

/**
 * A report's body (lina-app#114, #83): the reply markdown with headings, report blocks, tables and the report's own
 * images. An image is drawn wide with its caption under it (its title, else its alt), several in one paragraph side by
 * side; a tap opens it large, with the document's other images one step away.
 */
export function ReportBody({ reportId, body, revision = "", loadImage }: { reportId: string; body: string; revision?: string; loadImage: (position: number, signal: AbortSignal) => Promise<ReportImage> }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown: Shown[] = [];
  // The report's own image places, in document order, read by the same rules before the body is drawn.
  const positions: number[] = [];
  const collect: DocRules = {
    fence: blockFence((lines) => docBlocks(lines, collect)),
    image: (image, key) => {
      const position = ownImage(reportId, image.src);
      if (position !== null && !positions.includes(position)) positions.push(position);
      return <span key={key} />;
    },
    gallery: (images, key) => <span key={key}>{images}</span>,
  };
  docBlocks(body, collect);
  const images = useImages(reportId, revision, positions, loadImage);
  const rules: DocRules = {
    fence: blockFence((lines) => docBlocks(lines, rules)),
    image: (image, key) => imageNode(image, key),
    gallery: (images, key) => (
      <div key={key} class="report-gallery" data-count={images.length}>
        {images}
      </div>
    ),
  };
  function imageNode(image: DocImage, key: number): VNode {
    const caption = image.title ?? image.alt;
    const position = ownImage(reportId, image.src);
    if (position === null)
      return (
        <span key={key} class="report-image-outside" data-testid="report-image-outside">
          {caption ? `[${REPORT_WORD.image}: ${caption}] ` : ""}
          {REPORT_WORD.imageOutside}
        </span>
      );
    const url = images.get(position);
    if (url === "failed")
      return (
        <span key={key} class="report-image-outside" data-testid="report-image-failed">
          {caption ? `[${REPORT_WORD.image}: ${caption}] ` : ""}
          {REPORT_WORD.imageFailed}
        </span>
      );
    if (url === undefined)
      return (
        <span key={key} class="report-figure">
          <span class="report-image is-loading" role="img" aria-label={caption || REPORT_WORD.image} aria-busy="true" data-testid="report-image-loading" />
          {caption ? <span class="report-caption">{caption}</span> : null}
        </span>
      );
    const index = shown.push({ url, caption }) - 1;
    return (
      <span key={key} class="report-figure">
        <button type="button" class="report-image" onClick={() => setOpen(index)} aria-label={REPORT_WORD.imageOpen(caption || REPORT_WORD.image)}>
          <img src={url} alt={image.alt} decoding="async" />
        </button>
        {caption ? <span class="report-caption">{caption}</span> : null}
      </span>
    );
  }
  const blocks = docBlocks(body, rules);
  return (
    <>
      <div class="md report-body">{blocks}</div>
      {open !== null && shown[open] ? <Lightbox images={shown} at={open} onMove={setOpen} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * One image large over the report, its caption and place, the previous and next of the document, and a way out. It is
 * drawn in the page's body, not in the report: the viewer is a size container (`container-type`), which makes it the
 * box a fixed layer is placed in, and the phone's bar stands over the sheet; from the body it covers the whole window.
 */
function Lightbox({ images, at, onMove, onClose }: { images: readonly Shown[]; at: number; onMove: (index: number) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const image = images[at];
  const prev = at > 0 ? at - 1 : null;
  const next = at < images.length - 1 ? at + 1 : null;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && prev !== null) onMove(prev);
      else if (event.key === "ArrowRight" && next !== null) onMove(next);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, prev, next]);
  return createPortal(
    <div class="report-lightbox" role="dialog" aria-modal="true" aria-label={image.caption || REPORT_WORD.image} data-testid="report-lightbox" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div class="report-lightbox-bar">
        <span class="report-lightbox-count" data-testid="report-lightbox-count">
          {REPORT_WORD.imageCount(at + 1, images.length)}
        </span>
        <button type="button" class="text-button" ref={close} onClick={onClose}>
          {REPORT_WORD.close}
        </button>
      </div>
      <img class="report-lightbox-image" src={image.url} alt={image.caption} />
      {image.caption ? <p class="report-lightbox-caption">{image.caption}</p> : null}
      <div class="report-lightbox-steps">
        <button type="button" class="text-button" disabled={prev === null} onClick={() => prev !== null && onMove(prev)}>
          {REPORT_WORD.imagePrev}
        </button>
        <button type="button" class="text-button" disabled={next === null} onClick={() => next !== null && onMove(next)}>
          {REPORT_WORD.imageNext}
        </button>
      </div>
    </div>,
    document.body,
  );
}
