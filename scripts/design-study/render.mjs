// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, Image, convertSVGTextToPath } from '@napi-rs/canvas';
import { evidence, markSvg, icons, escapeXml as esc } from './study.mjs';

const root = new URL('../../', import.meta.url);
const source = 'docs/research/90-accent/';
const captures = 'docs/captures/90/';
const study = JSON.parse(readFileSync(new URL(`${source}study.json`, root)));
const checking = process.argv.includes('--check');
const outputs = [];
const fontFiles = ['Regular', 'Bold'].map((weight) => fileURLToPath(new URL(`${source}fonts/Pretendard-${weight}.otf`, root)));
GlobalFonts.removeAll();
for (const font of fontFiles) {
  if (!GlobalFonts.registerFromPath(font, 'Pretendard')) throw new Error(`Cannot load bundled font: ${font}`);
}
const t = (x, y, text, size = 16, color = '#17191F', weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(text)}</text>`;
const line = (x1, y1, x2, y2, color) => `<path d="M${x1} ${y1}H${x2}" transform="translate(0 ${y2 - y1})" stroke="${color}"/>`;
// Cubic transitions flatten toward each side; no circular border-radius corners.
function box(x, y, w, h, r, fill, stroke = 'none', sw = 1) {
  return `<path d="M${x + r} ${y}H${x + w - r}C${x + w} ${y} ${x + w} ${y} ${x + w} ${y + r}V${y + h - r}C${x + w} ${y + h} ${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}C${x} ${y + h} ${x} ${y + h} ${x} ${y + h - r}V${y + r}C${x} ${y} ${x} ${y} ${x + r} ${y}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
const mark = (x, y, size, accent, ink, expression = 'neutral', initial) =>
  `<g transform="translate(${x} ${y})">${markSvg({ size, accent, ink, expression, initial })}</g>`;
const icon = (x, y, name, color, size = 24) => `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</g>`;
const doc = (w, h, body, title) => `<!-- SPDX-License-Identifier: Apache-2.0 -->\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${esc(title)}</title><g font-family="Pretendard">${body}</g></svg>\n`;

function output(path, content) {
  const url = new URL(path, root);
  outputs.push(path);
  if (checking) {
    let existing;
    try { existing = readFileSync(url); } catch { throw new Error(`Missing generated artifact: ${path}`); }
    if (!existing.equals(Buffer.from(content))) throw new Error(`Generated artifact drift: ${path}; run npm run render`);
  } else {
    mkdirSync(new URL('.', url), { recursive: true });
    writeFileSync(url, content);
  }
}
function capture(name, svg) {
  output(`${source}renders/${name}.svg`, svg);
  const [, width, height] = svg.match(/width="(\d+)" height="(\d+)"/);
  const canvas = createCanvas(Number(width), Number(height));
  const image = new Image();
  image.src = convertSVGTextToPath(svg);
  canvas.getContext('2d').drawImage(image, 0, 0);
  output(`${captures}${name}.png`, canvas.toBuffer('image/png'));
}

function screen(candidate, mode) {
  const p = study.modes[mode], a = candidate[mode];
  const b = (x, y, w, h, r = 16, fill = p.surface) => box(x, y, w, h, r, fill, p.border, mode === 'high-contrast' ? 2 : 1);
  // HC uses white accent labels: cobalt/card is AA but below the 7:1 text aim.
  const text = (x, y, s, size = 16, weight = 400, color = p.text) => t(x, y, s, size, mode === 'high-contrast' && color === a ? p.text : color, weight);
  let s = box(0, 0, 1440, 1000, 0, p.canvas);
  s += text(32, 40, candidate.name, 21, 700) + text(240, 40, candidate.recommendation, 15, 400, p.secondary);
  s += text(1120, 40, `${mode} / proposal`, 15, 400, p.secondary);
  s += b(24, 64, 1392, 880, 24);
  s += box(25, 65, 215, 878, 24, p.canvas);
  s += text(56, 122, 'lina', 32, 700) + text(112, 122, '.', 32, 700, a);
  const nav = [['대화', 'identity'], ['나를 기다림', 'waiting'], ['내 작업', 'working'], ['기억', 'memory']];
  nav.forEach(([name, glyph], i) => {
    const y = 188 + i * 58;
    if (!i) s += box(42, y - 27, 180, 44, 12, p.surface) + box(42, y - 16, 3, 22, 1, a);
    s += icon(59, y - 18, glyph, !i ? a : p.secondary, 20) + text(94, y, name, 17, !i ? 700 : 400);
    if (i === 1) s += text(193, y, '1', 15, 700, a);
  });
  s += text(58, 510, '에이전트', 13, 700, p.secondary);
  s += mark(56, 535, 28, a, p.onAccent) + text(98, 556, '리나', 16, 700);
  s += mark(56, 583, 28, p.secondary, p.canvas, 'neutral', '하') + text(98, 604, '하루', 16);
  s += text(58, 904, '설정', 16, 400, p.secondary);
  s += mark(276, 95, 40, a, p.onAccent, 'warm') + text(330, 116, '리나', 20, 700);
  s += text(330, 141, '오늘도, 한 가지씩.', 14, 400, p.secondary);
  s += line(264, 164, 982, 164, p.border);
  s += text(282, 224, '오늘은 무엇을 할까요?', 32, 700);
  s += text(282, 258, '해야 할 일과 나눈 이야기를 한곳에서.', 17, 400, p.secondary);
  s += b(457, 299, 489, 88, 20, p.canvas);
  s += text(481, 333, '주말 산책 계획을 정리해 줘.', 17);
  s += text(481, 359, '조용한 길을 걷고 싶어.', 17);
  s += mark(282, 427, 28, a, p.onAccent, 'neutral') + text(322, 448, '리나', 16, 700);
  s += text(322, 487, '천천히 걸을 수 있는 두 가지 코스를 찾았어요.', 17);
  s += text(322, 514, '이동 시간과 쉴 곳을 함께 정리했어요.', 17);
  s += b(322, 544, 624, 146);
  s += icon(346, 569, 'memory', p.secondary, 24) + text(382, 590, '주말 산책 계획', 20, 700);
  s += text(346, 623, '두 가지 코스 · 이동 시간 · 쉬어 갈 곳', 16, 400, p.secondary);
  s += text(346, 662, '미리보기 열기 →', 16, 700, a);
  s += text(282, 744, '오늘', 14, 400, p.secondary);
  s += mark(282, 767, 24, a, p.onAccent, 'none') + text(319, 785, '리나 · 산책 계획을 정리했어요.', 15);
  s += b(282, 829, 664, 75, 20);
  s += text(306, 874, '리나에게 이야기하기', 17, 400, p.secondary);
  s += box(878, 845, 48, 44, 13, a) + text(895, 874, '↑', 24, 700, p.onAccent);
  s += box(1006, 65, 409, 878, 24, p.canvas);
  s += text(1038, 122, '한눈에', 26, 700);
  s += icon(1038, 166, 'waiting', a, 20) + text(1070, 183, '나를 기다림', 18, 700, a);
  s += b(1038, 204, 346, 222);
  s += text(1062, 241, '산책 코스를 골라 주세요', 20, 700);
  s += text(1062, 276, '강변길과 숲길 중 어디로 갈까요?', 16, 400, p.secondary);
  s += mark(1062, 296, 24, a, p.onAccent, 'none') + text(1098, 314, '리나', 15);
  s += box(1062, 346, 136, 48, 13, a) + text(1101, 376, '살펴보기', 16, 700, p.onAccent);
  s += text(1038, 478, '진행 중', 18, 700);
  s += b(1038, 500, 346, 143);
  s += mark(1062, 524, 24, a, p.onAccent, 'neutral') + text(1098, 543, '리나 · 산책 계획', 17, 700);
  s += icon(1062, 564, 'working', a, 16) + text(1090, 579, '걷기 좋은 길을 정리하는 중', 15);
  s += text(1062, 617, '자세히 보기 →', 14, 400, p.secondary);
  s += b(1038, 665, 346, 142);
  s += mark(1062, 689, 24, p.secondary, p.canvas, 'neutral', '하') + text(1098, 708, '하루 · 읽을거리', 17, 700);
  s += text(1062, 747, '이번 주의 글을 모으는 중', 15);
  s += text(1062, 782, '자세히 보기 →', 14, 400, p.secondary);
  s += text(32, 978, 'Design study · synthetic content · restrained accent / one shared form / familiar controls', 14, 400, p.secondary);
  return doc(1440, 1000, s, `${candidate.name} in ${mode}: conversation, work, waiting and agent marks`);
}

for (const c of study.candidates) for (const mode of Object.keys(study.modes)) capture(`${c.id}-${mode}`, screen(c, mode));

const sizes = [...new Set(Object.values(study.placements))].sort((a, b) => a - b);
const expressions = ['neutral', 'warm', 'curious', 'reserved', 'none'];
let sheet = box(0, 0, 1200, 930, 0, '#F5F6F8');
sheet += t(40, 55, 'One form. A small range of expression.', 30, '#17191F', 700);
sheet += t(40, 89, 'Proposed actual sizes · default neutral · expression-free marks for consequential content', 17, '#595F6B');
sizes.forEach((size, i) => { sheet += t(310 + i * 158, 146, `${size} px`, 17, '#595F6B', 700); });
expressions.forEach((expression, row) => {
  const y = 184 + row * 85;
  sheet += t(42, y + 28, expression === 'none' ? 'No face / protected contexts' : expression, 17);
  sizes.forEach((size, col) => {
    sheet += mark(318 + col * 158, y, size, '#2F4BDB', '#FFFFFF', expression);
    output(`${source}marks/lina-${expression}-${size}.svg`, `<!-- SPDX-License-Identifier: Apache-2.0 -->\n${markSvg({ size, expression })}\n`);
  });
});
sheet += t(40, 663, 'Description-made agents · fixed circle + initial + name', 23, '#17191F', 700);
sizes.forEach((size, col) => {
  sheet += mark(318 + col * 158, 702, size, '#2F4BDB', '#FFFFFF', 'neutral', '하');
  sheet += mark(318 + col * 158, 768, size, '#595F6B', '#FFFFFF', 'neutral', 'N');
  for (const initial of ['하', 'N']) output(`${source}marks/description-${initial === 'N' ? 'latin' : 'korean'}-${size}.svg`, `<!-- SPDX-License-Identifier: Apache-2.0 -->\n${markSvg({ size, initial })}\n`);
});
sheet += t(42, 729, '하루 · accent', 17) + t(42, 795, 'Noa · slate', 17);
sheet += t(40, 870, '16 active work · 24 card / LIFE · 28 message · 32 notification · 40 header / agent list', 17, '#595F6B');
sheet += t(40, 903, 'Preset silhouettes stay distinct. Workers use square tool tiles. Sub-agents have no avatar.', 16, '#595F6B');
capture('forms-and-expressions', doc(1200, 930, sheet, 'LINA expressions and description-made identity marks at every proposed size'));

let iconSheet = box(0, 0, 1200, 490, 0, '#F5F6F8');
iconSheet += t(40, 58, 'Custom LINA vocabulary', 30, '#17191F', 700);
iconSheet += t(40, 94, 'Lucide-compatible proposal · 24 × 24 grid · 2 unit stroke · round joins and caps', 17, '#595F6B');
Object.entries(icons).forEach(([name, body], i) => {
  const x = 55 + i * 230;
  iconSheet += box(x, 136, 184, 180, 18, '#FFFFFF', '#D9DDE4');
  for (let n = 0; n <= 6; n++) {
    iconSheet += `<path d="M${x + 32 + n * 20} 160v120M${x + 32} ${160 + n * 20}h120" stroke="#E9EBEF"/>`;
  }
  iconSheet += icon(x + 32, 160, name, '#2F4BDB', 120) + t(x, 352, name, 20, '#17191F', 700);
  const glyphs = ['[m] Memory', '[~] Working', '[?] Waiting', '[?] Unknown', '[L] Lina'];
  iconSheet += t(x, 387, glyphs[i], 17, '#595F6B');
  output(`${source}icons/${name}.svg`, doc(24, 24, `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`, `LINA ${name}`));
});
iconSheet += t(40, 454, 'Always pair state glyphs with words. Memory is a bookmark, never an anthropomorphic brain.', 17, '#595F6B');
capture('custom-icons', doc(1200, 490, iconSheet, 'Original custom icons and TUI text equivalents'));

let baseline = box(0, 0, 1560, 800, 0, '#F5F6F8');
baseline += t(40, 56, 'The baseline is calm, useful, and familiar.', 32, '#17191F', 700);
baseline += t(40, 91, 'Original style studies from public references — not screenshots of running Apple or Things apps.', 18, '#595F6B');
['Things 3 style', 'Apple Reminders style', 'LINA · proposed cobalt'].forEach((title, i) => {
  const x = 40 + i * 510;
  baseline += t(x, 147, title, 22, '#17191F', 700);
  baseline += box(x, 172, 480, 458, 20, '#FFFFFF', '#D9DDE4');
  baseline += box(x + 1, 173, 118, 456, 20, '#EDEFF3');
  baseline += t(x + 18, 214, i === 2 ? 'lina.' : 'My lists', 18, i === 2 ? '#2F4BDB' : '#17191F', 700);
  ['Today', 'Upcoming', 'Anytime'].forEach((label, n) => baseline += t(x + 18, 268 + n * 40, label, 13, n === 0 ? '#2F4BDB' : '#595F6B', n === 0 ? 700 : 400));
  baseline += t(x + 146, 241, i === 2 ? '나를 기다림' : 'Today', 28, i === 1 ? '#1264C6' : '#17191F', 700);
  baseline += t(x + 146, 278, i === 2 ? '한 가지를 골라 주세요.' : 'A little space for what matters.', 14, '#595F6B');
  ['Choose a walking route', 'Read a saved article', 'Plan the weekend'].forEach((label, n) => {
    const y = 336 + n * 72;
    baseline += i === 2 ? mark(x + 146, y - 19, 24, '#2F4BDB', '#FFFFFF', 'none') : `<circle cx="${x + 156}" cy="${y - 7}" r="9" fill="none" stroke="#737B89" stroke-width="1.5"/>`;
    baseline += t(x + 182, y, label, 14);
    baseline += line(x + 146, y + 23, x + 454, y + 23, '#E3E6EB');
  });
  baseline += box(x + 337, 550, 112, 42, 13, i === 1 ? '#1264C6' : '#2F4BDB');
  baseline += t(x + 360, 578, i === 2 ? '살펴보기' : 'Add task', 15, '#FFFFFF', 700);
  const notes = [
    ['Borrow: spacing, hierarchy, quiet separators.', 'Keep LINA’s face and conversation focus.'],
    ['Borrow: direct labels, standard list behavior.', 'Use Pretendard and one cross-platform set.'],
    ['Distinctive: owner marks + waiting questions.', 'Accent stays on small, actionable elements.'],
  ][i];
  baseline += t(x, 674, notes[0], 15, '#595F6B') + t(x, 702, notes[1], 15, '#595F6B');
});
baseline += t(40, 765, 'References: culturedcode.com/things/ · support.apple.com/guide/reminders/welcome/mac · no native fidelity or performance claim', 15, '#595F6B');
capture('baseline-comparison', doc(1560, 800, baseline, 'Things 3 and Apple Reminders style baselines beside the LINA proposal'));

let motion = box(0, 0, 1400, 570, 0, '#F5F6F8');
motion += t(40, 57, 'Two quiet transitions. No idle motion.', 30, '#17191F', 700);
const frames = [
  ['1 / Work lands', '0 ms · working', '220 ms · settled', 'Reduced motion · static result'],
  ['2 / Open a question', '0 ms · compact card', '180 ms · inline detail', 'Reduced motion · instant expansion'],
];
frames.forEach(([name, ...labels], row) => {
  const y = 120 + row * 225;
  motion += t(40, y, name, 21, '#17191F', 700);
  labels.forEach((label, col) => {
    const x = 40 + col * 455;
    motion += box(x, y + 25, 420, 114, 18, '#FFFFFF', '#D9DDE4');
    motion += mark(x + 20, y + 43, 24, '#2F4BDB', '#FFFFFF', 'none');
    motion += t(x + 58, y + 63, row ? '산책 코스를 골라 주세요' : col ? '산책 계획이 준비됐어요' : '산책 계획을 정리하는 중', 17, '#17191F', 700);
    motion += t(x + 20, y + 105, row && col ? '강변길    /    숲길    ·    나중에' : '리나 · 산책 계획', 15, '#595F6B');
    motion += t(x, y + 173, label, 16, '#595F6B');
  });
});
capture('signature-interactions', doc(1400, 570, motion, 'Work landing and inline question opening with reduced-motion alternatives'));

const rows = evidence(study);
output(`${source}contrast.json`, `${JSON.stringify(rows, null, 2)}\n`);
const table = ['<!-- Generated by scripts/design-study/render.mjs; proposal values, not tokens. -->',
  '| Option | Mode | Accent | On accent | vs canvas | vs card | Text on accent | Primary text min | Secondary text min |',
  '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map((r) => `| ${r.candidate} | ${r.mode} | ${r.accent} | ${r.onAccent} | ${r.surfaces.canvas.toFixed(3)} | ${r.surfaces.surface.toFixed(3)} | ${r.textOnAccent.toFixed(3)} | ${r.primaryText.toFixed(3)} | ${r.secondaryText.toFixed(3)} |`), ''];
output(`${source}contrast.md`, table.join('\n'));
output(`${source}manifest.json`, `${JSON.stringify({ renderer: '@napi-rs/canvas@0.1.100', fonts: 'Pretendard 1.3.9 Regular/Bold', outputs }, null, 2)}\n`);
console.log(`${checking ? 'Verified' : 'Rendered'} ${outputs.length} artifacts (SVG, PNG and contrast evidence).`);
