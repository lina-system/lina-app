// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThemes, validateContrast, textMinimum, generate, checkGenerated } from './design.mjs';
import { lintSource } from './visual-values.mjs';
const root = new URL('../../', import.meta.url).pathname;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lina-design-'));
  for (const path of ['design', 'DESIGN.md', 'packages/lina_design/lib/generated', 'packages/lina_design/assets']) cpSync(join(root, path), join(dir, path), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('every theme extends the pinned Core tokens and covers identical roles', () => {
  const themes = loadThemes(root);
  assert.deepEqual(themes.map(t => t.name), ['light', 'dark', 'high-contrast']);
  for (const theme of themes) {
    assert.equal(theme.tokens['type.lineHeight'].$value, 1.5);
    assert.equal(theme.tokens['type.body'].$value[0], 'Pretendard');
    for (const role of ['unknown', 'success', 'warning', 'error', 'diffAdded', 'diffRemoved', 'onAccent', 'focus']) assert.ok(theme.tokens[`color.${role}`]);
    assert.deepEqual(Object.keys(theme.tokens), Object.keys(themes[0].tokens));
    assert.ok(validateContrast(theme).length > 20);
  }
});
test('Korean text only qualifies as large at 18pt or 14pt bold', () => {
  assert.equal(textMinimum(23.99, 400), 4.5);
  assert.equal(textMinimum(24, 400), 3);
  assert.equal(textMinimum(18.66, 700), 4.5);
  assert.equal(textMinimum(56 / 3, 700), 3);
  assert.equal(textMinimum(19, 600), 4.5);
});
test('contrast failures cannot hide in any theme or status pair', () => {
  for (const theme of loadThemes(root)) for (const role of ['text', 'muted', 'unknown', 'diffAdded', 'onAccent']) {
    const bad = structuredClone(theme);
    const bg = role === 'onAccent' ? 'accent' : role === 'diffAdded' ? 'diffAddedBackground' : 'surface';
    bad.tokens[`color.${role}`] = structuredClone(bad.tokens[`color.${bg}`]);
    assert.throws(() => validateContrast(bad), /contrast/);
  }
});
test('corrupt upstream snapshots and missing roles fail closed', t => {
  const dir = fixture(t);
  const file = join(dir, 'design/tokens/core/light.json');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n');
  assert.throws(() => loadThemes(dir), /digest/);
});
test('check mode rejects edited, missing and unexpected generated files', t => {
  const dir = fixture(t);
  const outputs = generate(dir);
  checkGenerated(dir, outputs);
  const path = Object.keys(outputs).find(p => p.endsWith('.dart'));
  rmSync(join(dir, path));
  assert.throws(() => checkGenerated(dir, outputs), /drift/);
  writeFileSync(join(dir, path), '// stale\n');
  assert.throws(() => checkGenerated(dir, outputs), /drift/);
  writeFileSync(join(dir, path), outputs[path]);
  writeFileSync(join(dir, 'packages/lina_design/lib/generated/unexpected.dart'), '// stale');
  assert.throws(() => checkGenerated(dir, outputs), /unexpected/);
});
test('visual lint catches colors, aliased numbers, fonts, spacing and durations', () => {
  for (const source of [
    'const ink = Color(0xff000000);', 'final x = Colors.blue;',
    'const gap = 12.0; SizedBox(width: gap);', 'EdgeInsets.all(8)',
    "TextStyle(fontFamily: 'Pretendard')", 'FontWeight.w700',
    'Duration(milliseconds: 160)', 'Duration.zero', 'BorderRadius.zero', 'Icons.check',
    "const font = 'Other'; TextStyle(fontFamily: font)", "Color(int.parse('0xff000000'))",
    'const opacity = .5;', 'Colors /* hidden */ . red',
  ]) assert.ok(lintSource(source).length, source);
  assert.deepEqual(lintSource("// Color(0xff000000)\nText('12 days, Color(42)', style: theme.body);"), []);
  assert.deepEqual(lintSource('Padding(padding: EdgeInsets.all(tokens.spaceInline))'), []);
});

test('aliases and malformed types cannot bypass contrast validation', t => {
  const dir = fixture(t);
  const file = join(dir, 'design/tokens/light.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.color.focus.$value = '{color.focus}';
  writeFileSync(file, JSON.stringify(data));
  assert.throws(() => loadThemes(dir), /cyclic/);
  data.color.focus.$value = '{color.accent}';
  data.color.focus.$type = 'number';
  writeFileSync(file, JSON.stringify(data));
  assert.throws(() => loadThemes(dir), /type mismatch/);
});
test('bundled asset corruption fails before generation', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'packages/lina_design/assets/fonts/Pretendard-Regular.otf'), 'bad');
  assert.throws(() => loadThemes(dir), /asset digest/);
});

test('selection stays distinguishable from both surrounding surfaces', () => {
  for (const theme of loadThemes(root)) {
    const bad = structuredClone(theme);
    bad.tokens['color.selection'] = structuredClone(bad.tokens['color.canvas']);
    assert.throws(() => validateContrast(bad), /selection.*contrast/);
    const pairs = validateContrast(theme);
    for (const background of ['canvas', 'surface']) assert.ok(pairs.some(p => p.foreground === 'selection' && p.background === background && p.ratio >= 3));
  }
});
