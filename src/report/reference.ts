/**
 * A chat message's report reference (lina#263, work-client.yaml ReportReference): a line of its own,
 * `[[report:<id>|<page address>|<summary>]]`, the line gateway/report_reference.py writes. The app draws one report
 * card for it (lina-app#50); the report's body is never in the message.
 */
const REFERENCE = /^\[\[report:(rep_[0-9a-f]{12})\|([^|\s]+)\|(.+?)\]\][ \t]*$/;

export interface ReportReference {
  readonly id: string;
  readonly page: string;
  readonly summary: string;
}

/** A message's text and report cards in their order: runs of text between the reference lines, and each reference. */
export type MessagePart = { readonly kind: "text"; readonly text: string } | { readonly kind: "report"; readonly reference: ReportReference };

export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.join("").trim()) parts.push({ kind: "text", text: run.join("\n") });
    run = [];
  };
  for (const line of text.split("\n")) {
    const match = REFERENCE.exec(line);
    if (!match) {
      run.push(line);
      continue;
    }
    flush();
    parts.push({ kind: "report", reference: { id: match[1], page: match[2], summary: match[3] } });
  }
  flush();
  return parts;
}

/** A message as one line of words: each reference line reads as its summary (an agent row's last line, lina-app#50). */
export function referencesAsSummaries(text: string): string {
  return messageParts(text)
    .map((part) => (part.kind === "text" ? part.text : part.reference.summary))
    .join("\n");
}

/** The report a page address opens (`…/reports/<id>/page`, the address a reference carries), or null. */
export function reportOfPage(address: string): string | null {
  let path: string;
  try {
    path = new URL(address, "http://report.invalid").pathname;
  } catch {
    return null;
  }
  return /\/reports\/(rep_[0-9a-f]{12})\/page\/?$/.exec(path)?.[1] ?? null;
}
