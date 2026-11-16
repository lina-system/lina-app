/**
 * A text with its markdown emphasis markers taken out, the words they wrap kept (lina-app#166): every `*` (bold,
 * italic, a `*` bullet), `~~` and a `__` pair around words. A lone `_` stays, so ids like `t_27363156` still read as
 * ids to the fold. Each line is trimmed, and a text that was only markers and spaces is empty. No line is joined to
 * another or cut (lina-app#226).
 */
export function plainText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\*+|~~/g, "").replace(/__(\S(?:.*?\S)?)__/g, "$1").replace(/^[_\s]+$/, "").trim())
    .filter(Boolean)
    .join("\n");
}
