/**
 * A text with its markdown emphasis markers taken out, the words they wrap kept (lina-app#166): every `*` (bold,
 * italic, a `*` bullet), `~~` and a `__` pair around words. A lone `_` stays, so ids like `t_27363156` still read as
 * ids to the fold. Each line is trimmed, a text that was only markers and spaces is empty, and a list's lead-in line
 * reads with its first item (withLeadIns).
 */
export function plainText(text: string): string {
  return withLeadIns(
    text
      .split("\n")
      .map((line) => line.replace(/\*+|~~/g, "").replace(/__(\S(?:.*?\S)?)__/g, "$1").replace(/^[_\s]+$/, "").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

/** A line that leads a list in: it ends in `:` (never the `http:` of an address). */
const LEAD_IN = /(?<!\bhttps?):\s*$/;
/** A list item's mark: a dash or a dot, or a number (`1.`, `1)`, `(1)`). */
const ITEM_MARK = /^\s*(?:[-•·]|\(?\d{1,2}[.)])\s+/;

/**
 * The text with each list lead-in line (`확인할 결과:`) read with its first item, the item's mark dropped: `확인할 결과:
 * 빌드 통과.` (lina-app#218). The items after it stay lines of their own. A lead-in with no item after it is no
 * sentence: it goes, and the sentences of its line before it stay. No line it leaves ends in `:`.
 */
export function withLeadIns(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    while (LEAD_IN.test(line)) {
      const next = lines.findIndex((each, at) => at > index && each.trim());
      if (next < 0) {
        line = line.replace(/(?:^|(?<=[.!?。])\s+)[^.!?。]*$/, "");
        break;
      }
      line = `${line.trimEnd()} ${lines[next].replace(ITEM_MARK, "").trim()}`;
      index = next;
    }
    if (line.trim()) out.push(line);
  }
  return out.join("\n");
}
