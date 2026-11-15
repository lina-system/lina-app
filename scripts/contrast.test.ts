// @vitest-environment node
import { expect, test } from "vitest";
import { failingPairs, measure, parseColour, pixels } from "../.agents/skills/verify-lina-app/scripts/contrast.mjs";

// What the page reads for one text node: the canvas, then each element from the root to the text's own, and its colour.
function node(colour: string, layers: [string, number][], options: { where?: string; fontSize?: number; fontWeight?: number; unsure?: boolean } = {}) {
  return {
    where: options.where ?? "span",
    canvas: "rgb(0, 0, 0)",
    layers: layers.map(([background, opacity]) => ({ background, opacity })),
    colour,
    fontSize: options.fontSize ?? 13,
    fontWeight: options.fontWeight ?? 400,
    unsure: options.unsure ?? false,
  };
}

const CLEAR = "rgba(0, 0, 0, 0)";

test("reads the colours Chromium computes", () => {
  expect(parseColour("rgb(255, 69, 58)")).toEqual([255, 69, 58, 1]);
  expect(parseColour("rgba(235, 235, 245, 0.6)")).toEqual([235, 235, 245, 0.6]);
  expect(parseColour("color(srgb 1 0.5 0 / 0.5)")).toEqual([255, 127.5, 0, 0.5]);
  expect(() => parseColour("oklch(0.6 0.2 30)")).toThrow();
});

// lina-app#213: the bell's count in dark, white on the state red, measured 3.41:1 on the hub.
test("white on the dark red reads 3.41:1 and fails for 13 px text", () => {
  const badge = node("rgb(255, 255, 255)", [["rgb(28, 28, 30)", 1], ["rgb(255, 69, 58)", 1]], { where: "span.badge" });
  expect(measure(badge)).toMatchObject({ ratio: 3.41, needs: 4.5, text: "#ffffff", surface: "#ff453a" });
  expect(failingPairs([badge]).map((pair) => pair.where)).toEqual(["span.badge"]);
});

test("a translucent text colour and translucent layers blend over what is under them", () => {
  // Secondary grey in dark over the dark page: 60% of rgb(235, 235, 245) over rgb(28, 28, 30).
  const { text, surface } = pixels(node("rgba(235, 235, 245, 0.6)", [["rgb(28, 28, 30)", 1], [CLEAR, 1]]));
  expect(surface.slice(0, 3)).toEqual([28, 28, 30]);
  expect(text.slice(0, 3).map(Math.round)).toEqual([152, 152, 159]);
});

test("an element's opacity fades its text and its own background into the backdrop", () => {
  // White text on black, the group at 50% over white: grey text on white.
  const { text, surface } = pixels(node("rgb(255, 255, 255)", [["rgb(255, 255, 255)", 1], ["rgb(0, 0, 0)", 0.5]]));
  expect(surface.slice(0, 3).map(Math.round)).toEqual([128, 128, 128]);
  expect(text.slice(0, 3)).toEqual([255, 255, 255]);
});

test("large text needs 3:1, 24 px or 18.66 px bold", () => {
  const grey = (fontSize: number, fontWeight: number) => node("rgb(128, 128, 128)", [["rgb(255, 255, 255)", 1]], { fontSize, fontWeight });
  expect(measure(grey(24, 400)).needs).toBe(3);
  expect(measure(grey(19, 700)).needs).toBe(3);
  expect(measure(grey(19, 600)).needs).toBe(4.5);
  expect(failingPairs([grey(24, 400)])).toEqual([]);
  expect(failingPairs([grey(15, 400)])).toHaveLength(1);
});

test("lists every failing pair once, lowest first, and leaves out text drawn over an image", () => {
  const white = "rgb(255, 255, 255)";
  const nodes = [
    node("rgb(255, 149, 0)", [[white, 1]], { where: "span.due" }),
    node(white, [[white, 1], ["rgb(0, 122, 255)", 1]], { where: "a.current" }),
    node(white, [[white, 1], ["rgb(0, 122, 255)", 1]], { where: "a.current" }),
    node("rgb(0, 0, 0)", [[white, 1]], { where: "span.title" }),
    node(white, [[white, 1]], { where: "span.on-picture", unsure: true }),
  ];
  expect(failingPairs(nodes).map((pair) => [pair.where, pair.ratio])).toEqual([
    ["span.due", 2.2],
    ["a.current", 4.02],
  ]);
});
