// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Secondary text is 12-15 px, so it needs 4.5:1 against every surface it sits on, light and dark.
const css = readFileSync("src/design/tokens.css", "utf8");
const [light, dark] = css.split("@media (prefers-color-scheme: dark)");

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`no --${name}`);
  return match[1].trim();
}

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)).concat(1) as Rgba;
  const rgba = value.match(/^rgba\(([^)]+)\)$/);
  if (!rgba) throw new Error(`cannot read colour ${value}`);
  return rgba[1].split(",").map(Number) as Rgba;
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3];
  return [0, 1, 2].map((index) => top[index] * alpha + bottom[index] * (1 - alpha)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(text: Rgba, surface: Rgba): number {
  const a = luminance(over(text, surface));
  const b = luminance(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.each([
  ["light", light, "#ffffff"],
  ["dark", dark, "#000000"],
])("secondary text reaches 4.5:1 on every surface (%s)", (_scheme, block, page) => {
  const pageColour = parse(page);
  for (const surfaceName of ["bg", "bg-2", "sidebar", "bar"]) {
    const surface = over(parse(token(block, surfaceName)), pageColour);
    expect(contrast(parse(token(block, "label-2")), surface), surfaceName).toBeGreaterThanOrEqual(4.5);
  }
});

// lina-app#143: on a dark phone the selected tab was the page's own grey on a grey track. The selected segment needs
// 3:1 against the track its neighbours show, on the phone's page and in the wide toolbar, and its word stays legible.
test("the selected top tab stands out from its neighbours in dark (3:1)", () => {
  // The phone's tabs sit on its page (bg-2); the wide ones on the toolbar (bar over the window's bg).
  for (const layers of [["bg-2"], ["bg", "bar"]]) {
    const surfaceName = layers.join(" + ");
    const surface = layers.reduce((under, name) => over(parse(token(dark, name)), under), parse("#000000"));
    const track = over(parse(token(dark, "tab-track")), surface);
    const selected = over(parse(token(dark, "tab-current")), track);
    expect(contrast(selected, track), surfaceName).toBeGreaterThanOrEqual(3);
    expect(contrast(parse(token(dark, "label")), selected), surfaceName).toBeGreaterThanOrEqual(4.5);
  }
});

// lina-app#174: a link inside a detail (답할 곳 · <agent> 대화) is drawn in accent. In dark it needs the secondary text's
// 4.5:1 against what a detail sits on: the page at 390 (bg) and the panel at 1280 (bg-2).
test("a detail's link in accent reaches 4.5:1 in dark", () => {
  for (const surfaceName of ["bg", "bg-2"]) {
    const surface = over(parse(token(dark, surfaceName)), parse("#000000"));
    expect(contrast(parse(token(dark, "accent")), surface), surfaceName).toBeGreaterThanOrEqual(4.5);
  }
});

// lina-app#200 item 5: an agent's mark is its first letter in white on its colour, 11-14 px, so the letter needs 4.5:1
// in light and dark (white on the green one measured 2.0:1 in dark). The colours must not read as the states either
// (lina-app#190): far from the accent (selection, done), red (stopped), orange (warning) and the machines' green dot.
const MARK_LETTER: Rgba = [255, 255, 255, 1];
const OK_DOT = "#34c759";

/** What the scheme computes: its own value, else the one :root sets for both. */
function schemeToken(block: string, name: string): string {
  return block === dark && dark.includes(`--${name}:`) ? token(dark, name) : token(light, name);
}

/** CIE76 distance in Lab, enough to tell a hue apart from a state colour. */
function lab([r, g, b]: Rgba): [number, number, number] {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047);
  const y = f(lr * 0.2126 + lg * 0.7152 + lb * 0.0722);
  const z = f((lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function distance(a: Rgba, b: Rgba): number {
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * The OKLCH hue in degrees. A dim colour can be far in Lab and still the same hue as a state: the slate mark measured
 * 62 CIE76 units from the accent at 1 degree of hue and read as the selection blue, the brown 9 degrees from orange
 * (lina-app#190).
 */
function hue([r, g, b]: Rgba): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

function hueGap(a: Rgba, b: Rgba): number {
  const gap = Math.abs(hue(a) - hue(b));
  return Math.min(gap, 360 - gap);
}

// lina-app#213: the bell's count is a white number on red at 11-13 px; on the red the state words use it measured
// 3.41:1 in dark. Every white word on a red fill (the count, the stopped pills) needs 4.5:1, light and dark, and the
// fill stays the alert red: the state red's own hue, within 5 degrees.
const whiteOnRed = [...readFileSync("src/app.css", "utf8").matchAll(/\{([^{}]*)\}/g)]
  .map((rule) => rule[1])
  .filter((body) => /(^|\s)color:\s*#ffffff;/.test(body))
  .map((body) => body.match(/background:\s*var\(--(red[\w-]*)\)/)?.[1])
  .filter((name): name is string => Boolean(name));

test.each([
  ["light", light],
  ["dark", dark],
])("every white word on a red fill reaches 4.5:1, and the fill reads as the red (%s)", (_scheme, block) => {
  expect(whiteOnRed.length).toBeGreaterThanOrEqual(5);
  for (const name of whiteOnRed) {
    const fill = parse(schemeToken(block, name));
    expect(contrast(MARK_LETTER, fill), `--${name}`).toBeGreaterThanOrEqual(4.5);
    expect(hueGap(fill, parse(schemeToken(block, "red"))), `--${name} hue`).toBeLessThanOrEqual(5);
  }
});

test.each([
  ["light", light],
  ["dark", dark],
])("every agent mark's white letter reaches 4.5:1 on its colour, and no colour reads as a state (%s)", (_scheme, block) => {
  const states = [schemeToken(block, "accent"), schemeToken(block, "red"), schemeToken(block, "orange"), OK_DOT].map(parse);
  for (let index = 0; index < 6; index++) {
    const colour = parse(schemeToken(block, `agent-${index}`));
    expect(contrast(MARK_LETTER, colour), `agent-${index}`).toBeGreaterThanOrEqual(4.5);
    for (const state of states) {
      expect(distance(colour, state), `agent-${index} against ${state}`).toBeGreaterThanOrEqual(30);
      expect(hueGap(colour, state), `agent-${index} hue against ${state}`).toBeGreaterThanOrEqual(30);
    }
  }
});
