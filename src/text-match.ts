/**
 * A Testing Library name matcher that finds `text` in an accessible name as plain text. No RegExp is built from
 * the text, so a label holding ( ) [ ] ? . * + \\ | ^ $ { } matches only itself.
 */
export function containsText(text: string): (name: string) => boolean {
  return (name) => name.includes(text);
}
