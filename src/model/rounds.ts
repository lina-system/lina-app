/**
 * The one round boundary every view reads. A round spans its own start to its own end: a moment belongs to it when
 * it is at or after the start (no start on record: no lower bound) and at or before the end (no end yet: open).
 * The card's 실행 summary (workerRounds) and the run timeline both decide with this.
 */
export interface Span {
  readonly start: number | null;
  readonly end: number | null;
}

export function holds(span: Span, at: number): boolean {
  return (span.start === null || at >= span.start) && (span.end === null || at <= span.end);
}
