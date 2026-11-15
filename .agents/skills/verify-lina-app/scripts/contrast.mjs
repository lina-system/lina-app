// Text contrast as the page draws it (lina-app#213): every visible text node's colour against what it is painted on,
// read from computed styles. The page collects the layers (readTextLayers); the ratio is worked out here, so the maths
// is tested on its own (scripts/contrast.test.ts) and the same code checks the synthetic scene and the live shape.

/** WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large text (24 px, or 18.66 px bold). */
export const NORMAL = 4.5;
export const LARGE = 3;

/** A computed colour, `rgb()`, `rgba()` or `color(srgb …)`, as [r, g, b, a] with r, g, b in 0-255. */
export function parseColour(value) {
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  const srgb = value.match(/^color\(srgb ([^)]+)\)$/);
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return [r * 255, g * 255, b * 255, a];
  }
  throw new Error(`cannot read colour ${value}`);
}

/** `top` painted over an opaque `bottom`. */
export function over(top, bottom) {
  const alpha = top[3];
  return [0, 1, 2].map((index) => top[index] * alpha + bottom[index] * (1 - alpha)).concat(1);
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of two opaque colours. */
export function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The pixel under the text and the pixel beside it. `layers` runs from the root to the text's own element, each with
 * its background and opacity; an element's opacity fades it and everything in it over what is under it.
 */
export function pixels({ canvas, layers, colour }) {
  const paint = (index, backdrop, withText) => {
    const layer = layers[index];
    let inside = over(parseColour(layer.background), backdrop);
    inside = index === layers.length - 1 ? (withText ? over(parseColour(colour), inside) : inside) : paint(index + 1, inside, withText);
    return [0, 1, 2].map((at) => backdrop[at] + (inside[at] - backdrop[at]) * layer.opacity).concat(1);
  };
  const base = parseColour(canvas);
  return { text: paint(0, base, true), surface: paint(0, base, false) };
}

/** One text node's measured pair: its ratio and the ratio it needs. */
export function measure(node) {
  const { text, surface } = pixels(node);
  const large = node.fontSize >= 24 || (node.fontSize >= 18.66 && node.fontWeight >= 700);
  const hex = (rgb) => `#${rgb.slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  return { where: node.where, size: node.fontSize, weight: node.fontWeight, text: hex(text), surface: hex(surface), ratio: Math.round(ratio(text, surface) * 100) / 100, needs: large ? LARGE : NORMAL, unsure: node.unsure };
}

/** Every distinct pair under its threshold, lowest first; a pair the page drew over an image is not judged. */
export function failingPairs(nodes) {
  const seen = new Map();
  for (const pair of nodes.map(measure)) {
    if (pair.unsure || pair.ratio >= pair.needs) continue;
    const key = `${pair.where} ${pair.text} ${pair.surface}`;
    if (!seen.has(key)) seen.set(key, pair);
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
}

/**
 * Runs in the page: the layers under every text node that shows in the viewport. Text of a disabled control is left out
 * (WCAG 1.4.3 exempts inactive components). `where` names the element by tag, classes and test ids, never by its text.
 */
export function readTextLayers() {
  const probe = document.createElement("div");
  probe.style.background = "Canvas";
  document.body.append(probe);
  const canvas = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const name = (element) => {
    const testid = element.closest("[data-testid]")?.getAttribute("data-testid");
    const classes = [...element.classList].slice(0, 3).map((value) => `.${value}`).join("");
    return `${testid ? `[${testid}] ` : ""}${element.tagName.toLowerCase()}${classes}`;
  };
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const element = node.parentElement;
    if (!element || element.closest(":disabled, [aria-disabled=true], [hidden], script, style")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== "visible") continue;
    const chain = [];
    for (let at = element; at; at = at.parentElement) chain.unshift(at);
    let unsure = false;
    const layers = chain.map((at) => {
      const own = getComputedStyle(at);
      if (own.backgroundImage !== "none") unsure = true;
      return { background: own.backgroundColor, opacity: Number(own.opacity) };
    });
    if (layers.some((layer) => layer.opacity === 0)) continue;
    nodes.push({ where: name(element), canvas, layers, colour: style.color, fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), unsure });
  }
  return nodes;
}
