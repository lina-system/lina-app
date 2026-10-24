// SPDX-License-Identifier: Apache-2.0
export function contrast(a, b) {
  const luminance = (hex) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((s) => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function evidence(study) {
  return study.candidates.flatMap((candidate) => Object.entries(study.modes).map(([mode, p]) => ({
    candidate: candidate.id, mode, accent: candidate[mode], onAccent: p.onAccent,
    surfaces: Object.fromEntries(['canvas', 'surface'].map((key) => [key, contrast(candidate[mode], p[key])])),
    textOnAccent: contrast(p.onAccent, candidate[mode]),
    primaryText: Math.min(...['canvas', 'surface'].map((key) => contrast(p.text, p[key]))),
    secondaryText: Math.min(...['canvas', 'surface'].map((key) => contrast(p.secondary, p[key]))),
  })));
}

export function expressionFor(expression, context, enabled) {
  if (['approval', 'evidence', 'result', 'failure', 'unknown'].includes(context)) return 'none';
  if (!enabled || context === 'sensitive') return 'neutral';
  if (context === 'farewell') return 'warm';
  return expression;
}

export const escapeXml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

// One round, asymmetric pebble; expression never changes this outline.
const silhouette = 'M12 2C18.4 2 22 5.8 22 12C22 18.5 18.6 22 12 22C5.4 22 2 18.5 2 12C2 5.8 5.6 2 12 2Z';
export function markSvg({ size = 24, expression = 'neutral', accent = '#2F4BDB', ink = '#FFFFFF', initial } = {}) {
  let face = '';
  if (initial) {
    face = `<text x="12" y="16" fill="${ink}" font-family="Pretendard" font-size="12" font-weight="700" text-anchor="middle">${escapeXml(initial)}</text>`;
  } else if (expression !== 'none') {
    const mouth = { neutral: 'M10 15H14', warm: 'M9 14Q12 17 15 14', curious: 'M11 15Q12 14 13 15', reserved: 'M10 15H13' }[expression];
    face = `<g data-face="${expression}" fill="${ink}" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"><circle cx="8.5" cy="10.5" r="0.65"/><circle cx="15.5" cy="${expression === 'curious' ? 9.5 : 10.5}" r="0.65"/><path d="${mouth}" fill="none"/></g>`;
  }
  const form = initial
    ? `<circle data-silhouette="description" cx="12" cy="12" r="10" fill="${accent}"/>`
    : `<path data-silhouette="lina" d="${silhouette}" fill="${accent}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${form}${face}</svg>`;
}

// Original LINA drawings, aligned to Lucide's 24 unit grid and 2 unit stroke.
export const icons = {
  memory: '<path d="M5 5h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V5Zm0 12h14M9 3v7l3-2 3 2V3"/>',
  working: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3M12 17h.01"/>',
  identity: `<path d="${silhouette}"/><path d="M8 12h8M12 8v8"/>`,
};
