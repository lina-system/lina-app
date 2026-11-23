import { REPORT_WORD } from "../words";

/** A block that does not parse or draw (lina-app#83): its source as written and one line saying why, never dropped. */
export function BrokenBlock({ kind, error, source }: { kind: string; error: string; source: string }) {
  return (
    <div class="report-block is-broken" role="group" aria-label={REPORT_WORD.blockBroken(kind)} data-testid="report-block-broken">
      <p class="report-block-error">
        {REPORT_WORD.blockBroken(kind)}: {error}
      </p>
      <pre class="md-code">
        <code>{source}</code>
      </pre>
    </div>
  );
}
