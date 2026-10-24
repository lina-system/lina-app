// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const path = 'packages/lina_app/macos/Runner/Launcher/Resources/emoji.json';
test('bundled bilingual catalog includes exact heart, symbols and valid skin variants', () => {
  const { entries } = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(entries.length > 2000);
  assert.equal(new Set(entries.map(e => e.glyph)).size, entries.length);
  const heart = entries.find(e => e.glyph === '❤️');
  assert.equal(heart.en, 'red heart');
  assert.ok(heart.keywords.includes('하트'));
  assert.ok(heart.keywords.includes('heart'));
  assert.ok(entries.some(e => e.glyph === '©️' && e.en.includes('copyright') && e.ko.includes('저작권')));
  assert.deepEqual(entries.find(e => e.glyph === '👍').tones, ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']);
  assert.deepEqual(entries.find(e => e.glyph === '👩‍💻').tones, ['👩🏻‍💻', '👩🏼‍💻', '👩🏽‍💻', '👩🏾‍💻', '👩🏿‍💻']);
  assert.deepEqual(heart.tones, []);
  for (const entry of entries) {
    assert.ok(entry.en && entry.ko && entry.keywords.length);
    assert.ok(entry.tones.length === 0 || entry.tones.length === 5);
  }
});

test('offline catalog verification rejects changed source and generated output', async () => {
  const { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'lina-emoji-'));
  try {
    cpSync('data/emoji', join(root, 'data/emoji'), { recursive: true });
    mkdirSync(join(root, 'packages/lina_app/macos/Runner/Launcher/Resources'), { recursive: true });
    cpSync(path, join(root, path));
    const check = () => spawnSync(process.execPath, [resolve('scripts/verify/emoji.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
    writeFileSync(join(root, 'data/emoji/annotations-ko.json'), '{}');
    let result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unicode source drift/);
    cpSync('data/emoji/annotations-ko.json', join(root, 'data/emoji/annotations-ko.json'));
    writeFileSync(join(root, path), '{}');
    result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Emoji catalog drift/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
