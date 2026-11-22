import type { VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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

/**
 * A report's body (lina-app#114, #83): the reply markdown with headings, report blocks, tables and the report's own
 * images. An image is drawn wide with its caption under it (its title, else its alt), several in one paragraph side by
 * side; a tap opens it large, with the document's other images one step away.
 */
export function ReportBody({ reportId, body, imageUrl }: { reportId: string; body: string; imageUrl: (position: number) => string }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown: Shown[] = [];
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
    const index = shown.push({ url: imageUrl(position), caption }) - 1;
    return (
      <span key={key} class="report-figure">
        <button type="button" class="report-image" onClick={() => setOpen(index)} aria-label={REPORT_WORD.imageOpen(caption || REPORT_WORD.image)}>
          <img src={shown[index].url} alt={image.alt} loading="lazy" decoding="async" />
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

/** One image large over the report, its caption and place, the previous and next of the document, and a way out. */
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
  return (
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
    </div>
  );
}
