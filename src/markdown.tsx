import type { ComponentChildren, VNode } from "preact";
import { W } from "./words";

/**
 * The markdown an agent's reply in 대화 draws (lina-app#187). It builds Preact elements and never inserts HTML: what a
 * reply writes as HTML stays text. `src/markdown.test.tsx` holds every rule.
 *
 * Drawn: **bold** and __bold__, *italic* and _italic_ (an underscore inside a word is not a mark), `inline code`,
 * fenced code blocks (``` or ~~~), bullet lists (- * +), numbered lists (1. or 1)), task list items (`[ ]` and `[x]`
 * after a list mark, as a read-only check named for its state), > blockquotes, # headings (as bold text), --- rules,
 * tables (a header row, a |---| row, then body rows; :--- and ---: align a column), and [text](address) links to
 * http, https and mailto, opened in a new tab with rel="noopener noreferrer".
 *
 * Not drawn, shown as written: raw HTML, images, bare addresses, links to any other scheme, strikethrough,
 * underline-style headings and footnotes. A nested list item is drawn as an item of the same list.
 *
 * A mark with no end yet is text, so a reply that streams in shows `**굵` and a code fence with no closing line as
 * written until the closing mark arrives.
 *
 * A report (lina-app#114) reads the same markdown with `doc` rules: headings at their levels, images, report blocks in
 * fences, and tables whose number columns align right and whose rows can fold into cards (src/report/body.tsx).
 */
export function Markdown({ text }: { text: string }) {
  return <div class="md">{blocks(lines(text))}</div>;
}

/** What a document draws beyond a reply's markdown (a report's body, src/report/body.tsx). */
export interface DocRules {
  /** A fenced block's drawing by its info string (a report block), or null to draw it as code. */
  fence(info: string, body: readonly string[], key: number): VNode | null;
  /** One image `![alt](src "caption")`, alone or among others in its paragraph. */
  image(image: DocImage, key: number): VNode;
  /** A paragraph of two or more images and nothing else, drawn side by side. */
  gallery(images: readonly VNode[], key: number): VNode;
}

export interface DocImage {
  readonly alt: string;
  readonly src: string;
  readonly title: string | null;
}

/** A document's blocks under `doc` rules; a block's own markdown (a fold's) is drawn by the same call. */
export function docBlocks(text: string | readonly string[], doc: DocRules): VNode[] {
  return blocks(typeof text === "string" ? lines(text) : text, doc);
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
/** `![alt](src)` or `![alt](src "caption")`; the alt may be empty. */
const IMAGE = /^!\[([^\]\n]*)\]\(([^()\s]+)(?:\s+"([^"\n]*)")?\)/;
const IMAGES_ONLY = /^(?:\s*!\[[^\]\n]*\]\([^()\s]+(?:\s+"[^"\n]*")?\)\s*)+$/;
/** A cell that reads as a number: digits with grouping commas, a sign, a decimal part, and a short unit or %. */
const NUMBER_CELL = /^[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|[A-Za-z]{1,3}|원|건|개|명|시간|분|초|배)?$/;

function startsBlock(lines: readonly string[], at: number): boolean {
  const line = lines[at];
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line) || BULLET.test(line) || NUMBER.test(line) || isTableStart(lines, at);
}

function isTableStart(lines: readonly string[], at: number): boolean {
  const next = lines[at + 1];
  return lines[at].includes("|") && next !== undefined && next.includes("|") && TABLE_RULE.test(next) && next.includes("-");
}

function blocks(lines: readonly string[], doc?: DocRules): VNode[] {
  const out: VNode[] = [];
  const inline = (text: string) => inlineOf(text, doc);
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    const key = out.length;
    if (!line.trim()) {
      at += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const end = lines.findIndex((each, index) => index > at && new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(each));
      if (end < 0) {
        // No closing line yet: the rest is text as written until it comes.
        out.push(<p key={key}>{breaks(lines.slice(at).map((each) => [each]))}</p>);
        break;
      }
      const drawn = doc?.fence(fence[2].trim(), lines.slice(at + 1, end), key);
      if (drawn) {
        out.push(drawn);
        at = end + 1;
        continue;
      }
      out.push(
        <pre key={key} class="md-code">
          <code>{lines.slice(at + 1, end).join("\n")}</code>
        </pre>,
      );
      at = end + 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading && doc) {
      // The report's own title is the page's h1: its body's # is h2, ## h3, and anything deeper h4.
      const level = Math.min(4, (/#+/.exec(line)?.[0].length ?? 1) + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      out.push(<Tag key={key}>{inline(heading[1])}</Tag>);
      at += 1;
      continue;
    }
    if (heading) {
      out.push(
        <p key={key} class="md-heading">
          <strong>{inline(heading[1])}</strong>
        </p>,
      );
      at += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(<hr key={key} />);
      at += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      for (let match = QUOTE.exec(lines[at] ?? ""); match; match = QUOTE.exec(lines[at] ?? "")) {
        inner.push(match[1]);
        at += 1;
      }
      out.push(<blockquote key={key}>{blocks(inner, doc)}</blockquote>);
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const numbered = NUMBER.exec(line);
      const items: string[][] = [];
      while (at < lines.length) {
        const item = numbered ? NUMBER.exec(lines[at]) : BULLET.exec(lines[at]);
        const nested = BULLET.exec(lines[at]) ?? NUMBER.exec(lines[at]);
        if (item) items.push([numbered ? item[2] : item[1]]);
        else if (nested && /^\s/.test(lines[at])) items.push([nested.at(-1) ?? ""]);
        else if (lines[at].trim() && /^\s/.test(lines[at]) && items.length) items.at(-1)?.push(lines[at].trim());
        else break;
        at += 1;
      }
      const children = items.map((item, index) => {
        const task = TASK.exec(item[0]);
        if (!task) return <li key={index}>{breaks(item.map(inline))}</li>;
        const done = task[1] !== " ";
        return (
          <li key={index} class="md-task">
            <input type="checkbox" class="md-check" checked={done} disabled aria-label={done ? W.done : W.notDone} />
            {breaks([task[2], ...item.slice(1)].map(inline))}
          </li>
        );
      });
      out.push(
        numbered ? (
          <ol key={key} start={Number(numbered[1])}>
            {children}
          </ol>
        ) : (
          <ul key={key}>{children}</ul>
        ),
      );
      continue;
    }
    if (isTableStart(lines, at)) {
      const head = cells(line);
      const align = cells(lines[at + 1]).map((cell) => (cell.endsWith(":") ? (cell.startsWith(":") ? "center" : "right") : cell.startsWith(":") ? "left" : undefined));
      const rows: string[][] = [];
      at += 2;
      while (at < lines.length && lines[at].includes("|") && lines[at].trim()) rows.push(cells(lines[at++]));
      if (doc) {
        // The cells are drawn here, not later inside the table's component: a pass reading the body for its images
        // meets those in cells too, in document order (lina-app#274).
        out.push(<DocTable key={key} head={head} rows={rows} align={align} cells={rows.map((row) => head.map((_, column) => inline(row[column] ?? "")))} heads={head.map(inline)} />);
        continue;
      }
      out.push(
        <div key={key} class="md-table">
          <table>
            <thead>
              <tr>
                {head.map((cell, index) => (
                  <th key={index} style={align[index] ? { textAlign: align[index] } : undefined}>
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {head.map((_, column) => (
                    <td key={column} style={align[column] ? { textAlign: align[column] } : undefined}>
                      {inline(row[column] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const paragraph = [line];
    at += 1;
    while (at < lines.length && lines[at].trim() && !startsBlock(lines, at)) paragraph.push(lines[at++]);
    const joined = paragraph.join(" ");
    if (doc && IMAGES_ONLY.test(joined)) {
      // A paragraph of images alone: one is a wide figure, several stand side by side.
      const images = [...joined.matchAll(new RegExp(IMAGE.source.slice(1), "g"))].map((match, index) => doc.image({ alt: match[1], src: match[2], title: match[3] ?? null }, index));
      out.push(images.length === 1 ? <div key={key} class="report-figure-one">{images[0]}</div> : doc.gallery(images, key));
      continue;
    }
    out.push(<p key={key}>{breaks(paragraph.map(inline))}</p>);
  }
  return out;
}

/** The first table in some lines (a header row, its |---| row, then body rows), as cell text; null when there is none. */
export function tableOf(lines: readonly string[]): { readonly head: string[]; readonly rows: string[][] } | null {
  const at = lines.findIndex((_, index) => isTableStart(lines, index));
  if (at < 0) return null;
  const rows: string[][] = [];
  for (let row = at + 2; row < lines.length && lines[row].includes("|") && lines[row].trim(); row += 1) rows.push(cells(lines[row]));
  return { head: cells(lines[at]), rows };
}

/** A cell's number (grouping commas, a unit or % after it), or null when the cell does not read as one. */
export function cellNumber(cell: string): number | null {
  const text = cell.replace(/[*_`]/g, "").trim();
  if (!NUMBER_CELL.test(text)) return null;
  return Number(text.replace(/−/, "-").replace(/,/g, "").replace(/[^\d.+-]+$/u, "").trim());
}

/** A column every one of whose filled body cells reads as a number aligns right (lina-app#114). */
function numberColumns(head: readonly string[], rows: readonly string[][]): boolean[] {
  return head.map((_, column) => {
    const filled = rows.map((row) => (row[column] ?? "").trim()).filter(Boolean);
    return filled.length > 0 && filled.every((cell) => NUMBER_CELL.test(cell.replace(/[*_`]/g, "")));
  });
}

/**
 * A report's table: its header row stays while its rows scroll, a number column aligns right, and every cell carries
 * its column's name, which a narrow reader shows before it when each row folds into a card (app.css).
 */
function DocTable({ head, rows, align, heads, cells }: { head: readonly string[]; rows: readonly string[][]; align: readonly (string | undefined)[]; heads: readonly ComponentChildren[]; cells: readonly (readonly ComponentChildren[])[] }) {
  const numbers = numberColumns(head, rows);
  const style = (column: number) => (align[column] ? { textAlign: align[column] } : undefined);
  return (
    <div class="md-table report-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {head.map((_, index) => (
              <th key={index} scope="col" class={numbers[index] ? "is-number" : undefined} style={style(index)}>
                {heads[index]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((_, index) => (
            <tr key={index}>
              {head.map((name, column) => (
                <td key={column} class={numbers[column] ? "is-number" : undefined} style={style(column)} data-label={plainLine(name)}>
                  {cells[index][column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function breaks(lines: readonly ComponentChildren[]): ComponentChildren[] {
  return lines.flatMap((line, index) => (index ? [<br key={`br${index}`} />, line] : [line]));
}

/** A table row's cells: split at each `|` that is not escaped and not inside inline code, the outer pipes dropped. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let ticks = 0;
  for (let at = 0; at < row.length; at += 1) {
    const char = row[at];
    if (char === "\\" && row[at + 1] === "|") {
      cell += "|";
      at += 1;
    } else if (char === "`") {
      ticks = ticks ? 0 : 1;
      cell += char;
    } else if (char === "|" && !ticks) {
      out.push(cell);
      cell = "";
    } else cell += char;
  }
  out.push(cell);
  const trimmed = out.map((each) => each.trim());
  if (/^\s*\|/.test(row)) trimmed.shift();
  if (/\|\s*$/.test(row)) trimmed.pop();
  return trimmed;
}

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** An address a link may open: http, https or mailto, and nothing else. */
function safeHref(address: string): string | null {
  try {
    return LINK_SCHEMES.has(new URL(address).protocol) ? address : null;
  } catch {
    return null;
  }
}

const WORD = /[\p{L}\p{N}]/u;

/** `[text](address)`; an address may hold one level of parentheses. */
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)\)/;

/** One line's inline marks. A mark with no closing mark is text. */
function inlineOf(text: string, doc?: DocRules): ComponentChildren[] {
  const inline = (inner: string) => inlineOf(inner, doc);
  const out: ComponentChildren[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\" && at + 1 < text.length && /[\\`*_[\]()#>|~!-]/.test(text[at + 1])) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(text.slice(at))?.[0] ?? "`";
      const end = text.indexOf(run, at + run.length);
      if (end > at) {
        flush();
        const code = text.slice(at + run.length, end);
        out.push(<code key={out.length}>{code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code}</code>);
        at = end + run.length;
        continue;
      }
      plain += run;
      at += run.length;
      continue;
    }
    const docImage = doc && char === "!" && text[at + 1] === "[" ? IMAGE.exec(text.slice(at)) : null;
    if (doc && docImage) {
      flush();
      out.push(doc.image({ alt: docImage[1], src: docImage[2], title: docImage[3] ?? null }, out.length));
      at += docImage[0].length;
      continue;
    }
    const image = char === "!" && text[at + 1] === "[" ? LINK.exec(text.slice(at + 1)) : null;
    if (image) {
      plain += `!${image[0]}`;
      at += image[0].length + 1;
      continue;
    }
    if (char === "[") {
      const link = LINK.exec(text.slice(at));
      const href = link ? safeHref(link[2]) : null;
      if (link && href) {
        flush();
        out.push(
          <a key={out.length} href={href} target="_blank" rel="noopener noreferrer">
            {inline(link[1])}
          </a>,
        );
        at += link[0].length;
        continue;
      }
      if (link) {
        plain += link[0];
        at += link[0].length;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const double = text[at + 1] === char;
      const mark = double ? char + char : char;
      const end = closing(text, at, mark);
      if (end > 0) {
        flush();
        const inner = inline(text.slice(at + mark.length, end));
        out.push(double ? <strong key={out.length}>{inner}</strong> : <em key={out.length}>{inner}</em>);
        at = end + mark.length;
        continue;
      }
      plain += mark;
      at += mark.length;
      continue;
    }
    plain += char;
    at += 1;
  }
  flush();
  return out;
}

/**
 * Where an emphasis opened at `at` closes, or -1. It opens before a non-space and closes after one; an underscore
 * neither opens after nor closes before a letter or digit, so snake_case stays text.
 */
function closing(text: string, at: number, mark: string): number {
  const after = text[at + mark.length];
  if (!after || /\s/.test(after)) return -1;
  if (mark[0] === "_" && at > 0 && WORD.test(text[at - 1])) return -1;
  for (let end = text.indexOf(mark, at + mark.length); end > 0; end = text.indexOf(mark, end + 1)) {
    if (end === at + mark.length) continue;
    if (/\s/.test(text[end - 1])) continue;
    if (mark.length === 1 && text[end + 1] === mark) {
      end += 1;
      continue;
    }
    if (mark[0] === "_" && WORD.test(text[end + mark.length] ?? "")) continue;
    if (text[end - 1] === "\\") continue;
    return end;
  }
  return -1;
}

/**
 * One line of a reply as plain words, for an agent row's preview (lina-app#187): its first line with words, without
 * a heading's, quote's or list item's mark (a task item's box too), emphasis and code marks, or a link's address. A code fence and a rule are
 * not words; a table row reads its cells.
 */
export function plainLine(text: string): string {
  const line = text.split("\n").find((each) => each.trim() && !FENCE.test(each) && !RULE.test(each) && !TABLE_RULE.test(each)) ?? "";
  return line
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s*(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)/, "")
    .replace(/!?\[([^\]\n]+)\]\([^()\s]+(?:\([^()\s]*\)[^()\s]*)*\)/g, "$1")
    .replace(/(`+)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}
