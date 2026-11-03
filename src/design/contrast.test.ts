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
