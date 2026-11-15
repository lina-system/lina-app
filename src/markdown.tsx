import type { ComponentChildren, VNode } from "preact";

/**
 * The markdown an agent's reply in 대화 draws (lina-app#187). It builds Preact elements and never inserts HTML: what a
 * reply writes as HTML stays text. `src/markdown.test.tsx` holds every rule.
 *
 * Drawn: **bold** and __bold__, *italic* and _italic_ (an underscore inside a word is not a mark), `inline code`,
 * fenced code blocks (``` or ~~~), bullet lists (- * +), numbered lists (1. or 1)), > blockquotes, # headings (as
 * bold text), --- rules, tables (a header row, a |---| row, then body rows; :--- and ---: align a column), and
 * [text](address) links to http, https and mailto, opened in a new tab with rel="noopener noreferrer".
 *
 * Not drawn, shown as written: raw HTML, images, bare addresses, links to any other scheme, strikethrough,
 * underline-style headings, footnotes and task boxes. A nested list item is drawn as an item of the same list.
 *
 * A mark with no end yet is text, so a reply that streams in shows `**굵` and a code fence with no closing line as
 * written until the closing mark arrives.
 */
export function Markdown({ text }: { text: string }) {
  return <div class="md">{blocks(text.replace(/\r\n?/g, "\n").split("\n"))}</div>;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function startsBlock(lines: readonly string[], at: number): boolean {
  const line = lines[at];
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line) || BULLET.test(line) || NUMBER.test(line) || isTableStart(lines, at);
}

function isTableStart(lines: readonly string[], at: number): boolean {
  const next = lines[at + 1];
  return lines[at].includes("|") && next !== undefined && next.includes("|") && TABLE_RULE.test(next) && next.includes("-");
}

function blocks(lines: readonly string[]): VNode[] {
  const out: VNode[] = [];
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
      out.push(
        <pre key={key} class="md-code">
          <code>{lines.slice(at + 1, end).join("\n")}</code>
        </pre>,
      );
      at = end + 1;
      continue;
    }
    const heading = HEADING.exec(line);
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
      out.push(<blockquote key={key}>{blocks(inner)}</blockquote>);
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
      const children = items.map((item, index) => <li key={index}>{breaks(item.map(inline))}</li>);
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
    out.push(<p key={key}>{breaks(paragraph.map(inline))}</p>);
  }
  return out;
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
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+(?:\([^)\s]*\)[^)\s]*)*)\)/;

/** One line's inline marks. A mark with no closing mark is text. */
function inline(text: string): ComponentChildren[] {
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
