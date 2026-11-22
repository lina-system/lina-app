import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { REPORT_WORD } from "../words";

/**
 * Bar, line and share charts drawn as SVG in the app's colours (lina-app#83). lina-app#66 plans one chart component
 * for agent-built views; until it lands this is the one the report viewer draws, and the one #66 can grow from.
 *
 * Up to four series. A share chart of one series is a donut; of several, one bar per label split by series (stacked).
 * One row of values is no chart at all: each value stands as a number with its name (a stat row).
 */
export type ChartKind = "bar" | "line" | "donut" | "stacked";

export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
}

export interface ChartData {
  readonly kind: ChartKind;
  readonly title: string | null;
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
}

export const MAX_SERIES = 4;

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

/** The width the chart is drawn at: its box's, so its words keep the reading size at every width. */
function useWidth(): [{ current: HTMLDivElement | null }, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A number the way the chart's labels read it: grouped, at most two decimals. */
export function chartNumber(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/** The top of the value axis: the largest value rounded up to 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((each) => each * power >= value) ?? 10;
  return step * power;
}

function describe(data: ChartData): string {
  const kind = { bar: "막대", line: "선", donut: "비율", stacked: "비율 막대" }[data.kind];
  const values = data.labels.map((label, index) => `${label} ${data.series.map((series) => chartNumber(series.values[index] ?? 0)).join("/")}`);
  return [data.title, `${kind} ${REPORT_WORD.chart}`, values.join(", ")].filter(Boolean).join(": ");
}

export function Chart({ data }: { data: ChartData }) {
  if (data.labels.length === 1) return <StatRow data={data} />;
  return (
    <figure class="chart" data-kind={data.kind}>
      {data.title ? <figcaption class="chart-title">{data.title}</figcaption> : null}
      {data.kind === "donut" ? <Donut data={data} /> : <Axes data={data} />}
      <Legend data={data} />
    </figure>
  );
}

function StatRow({ data }: { data: ChartData }) {
  return (
    <figure class="chart chart-stats" data-kind="stat">
      {data.title ? <figcaption class="chart-title">{data.title}</figcaption> : null}
      <dl class="chart-stat-row">
        {data.series.map((series) => (
          <div key={series.name} class="chart-stat">
            <dt>{data.series.length > 1 ? series.name : (data.labels[0] ?? series.name)}</dt>
            <dd>{chartNumber(series.values[0] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

function Legend({ data }: { data: ChartData }) {
  const donut = data.kind === "donut";
  const names = donut ? data.labels : data.series.map((series) => series.name);
  if (!donut && names.length < 2) return null;
  const sum = donut ? data.series[0].values.reduce((total, value) => total + Math.max(0, value), 0) : 0;
  return (
    <ul class="chart-legend">
      {names.map((name, index) => (
        <li key={index}>
          <span class={`chart-swatch chart-s${index % (donut ? 6 : MAX_SERIES)}`} aria-hidden="true" />
          {name}
          {donut && sum > 0 ? <span class="chart-share"> {Math.round(((data.series[0].values[index] ?? 0) / sum) * 100)}%</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Axes({ data }: { data: ChartData }) {
  const [ref, width] = useWidth();
  const stacked = data.kind === "stacked";
  const totals = data.labels.map((_, index) => data.series.reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0));
  const values = data.series.flatMap((series) => series.values);
  const top = niceMax(stacked ? Math.max(...totals) : Math.max(0, ...values));
  const bottom = stacked ? 0 : Math.min(0, ...values);
  const span = top - bottom || 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (value: number) => PAD.top + plotH - ((value - bottom) / span) * plotH;
  const slot = plotW / data.labels.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => bottom + share * span);
  // A label every few slots when they would collide on a narrow box.
  const every = Math.max(1, Math.ceil(data.labels.length / Math.max(1, Math.floor(plotW / 56))));
  return (
    <div class="chart-box" ref={ref}>
      <svg class="chart-svg" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={describe(data)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line class="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text class="chart-tick" x={PAD.left - 6} y={y(tick) + 4} text-anchor="end">
              {chartNumber(tick)}
            </text>
          </g>
        ))}
        {data.labels.map((label, index) =>
          index % every ? null : (
            <text key={index} class="chart-tick" x={PAD.left + slot * index + slot / 2} y={HEIGHT - 8} text-anchor="middle">
              {label.length > 10 ? `${label.slice(0, 9)}…` : label}
            </text>
          ),
        )}
        {data.kind === "line" ? <Lines data={data} slot={slot} y={y} /> : stacked ? <Stacks data={data} slot={slot} y={y} /> : <Bars data={data} slot={slot} y={y} />}
      </svg>
    </div>
  );
}

type Place = { data: ChartData; slot: number; y: (value: number) => number };

function Bars({ data, slot, y }: Place) {
  const group = slot * 0.72;
  const bar = group / data.series.length;
  return (
    <>
      {data.series.map((series, s) =>
        series.values.map((value, index) => {
          const x = PAD.left + slot * index + (slot - group) / 2 + bar * s;
          const from = y(Math.max(0, value));
          return <rect key={`${s}-${index}`} class={`chart-mark chart-s${s}`} x={x + 1} y={from} width={Math.max(1, bar - 2)} height={Math.max(1, Math.abs(y(value) - y(0)))} rx={2} />;
        }),
      )}
    </>
  );
}

function Stacks({ data, slot, y }: Place) {
  const width = slot * 0.6;
  return (
    <>
      {data.labels.map((_, index) => {
        let base = 0;
        return data.series.map((series, s) => {
          const value = Math.max(0, series.values[index] ?? 0);
          const rect = <rect key={`${s}-${index}`} class={`chart-mark chart-s${s}`} x={PAD.left + slot * index + (slot - width) / 2} y={y(base + value)} width={width} height={Math.max(0, y(base) - y(base + value))} />;
          base += value;
          return rect;
        });
      })}
    </>
  );
}

function Lines({ data, slot, y }: Place) {
  const x = (index: number) => PAD.left + slot * index + slot / 2;
  return (
    <>
      {data.series.map((series, s) => (
        <g key={s} class={`chart-s${s}`}>
          <polyline class="chart-line" points={series.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
          {series.values.map((value, index) => (
            <circle key={index} class="chart-dot" cx={x(index)} cy={y(value)} r={3} />
          ))}
        </g>
      ))}
    </>
  );
}

function Donut({ data }: { data: ChartData }) {
  const values = data.series[0].values.map((value) => Math.max(0, value));
  const sum = values.reduce((total, value) => total + value, 0) || 1;
  const radius = 70;
  const length = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div class="chart-box is-donut">
      <svg class="chart-svg" width={200} height={200} viewBox="0 0 200 200" role="img" aria-label={describe(data)}>
        <g transform="rotate(-90 100 100)">
          {values.map((value, index) => {
            const part = (value / sum) * length;
            const arc = <circle key={index} class={`chart-arc chart-s${index % 6}`} cx={100} cy={100} r={radius} stroke-dasharray={`${part} ${length - part}`} stroke-dashoffset={-offset} />;
            offset += part;
            return arc;
          })}
        </g>
        <text class="chart-total" x={100} y={96} text-anchor="middle">
          {REPORT_WORD.total}
        </text>
        <text class="chart-total-value" x={100} y={118} text-anchor="middle">
          {chartNumber(values.reduce((total, value) => total + value, 0))}
        </text>
      </svg>
    </div>
  );
}
