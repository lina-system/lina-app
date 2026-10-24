// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, expressionFor, markSvg, evidence } from './study.mjs';

const study = JSON.parse(readFileSync(new URL('../../docs/research/90-accent/study.json', import.meta.url)));

test('WCAG reference pairs and sRGB linearization', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#123456', '#123456'), 1);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.478089) < 0.00001);
  assert.ok(contrast('#777777', '#ffffff') < 4.5, 'do not round a failure into a pass');
});

test('every accent clears every actual adjacent surface and on-accent text', () => {
  assert.equal(study.candidates.length, 3);
  assert.deepEqual(Object.keys(study.modes), ['light', 'dark', 'high-contrast']);
  const rows = evidence(study);
  assert.equal(rows.length, 9);
  for (const row of rows) {
    for (const ratio of Object.values(row.surfaces)) assert.ok(ratio >= 3, JSON.stringify(row));
    assert.ok(row.textOnAccent >= (row.mode === 'high-contrast' ? 7 : 4.5), JSON.stringify(row));
    if (row.mode !== 'high-contrast') {
      for (const ratio of Object.values(row.surfaces)) assert.ok(ratio >= 4.5, 'accent labels are normal text');
    }
    assert.ok(row.primaryText >= (row.mode === 'high-contrast' ? 7 : 4.5));
    assert.ok(row.secondaryText >= (row.mode === 'high-contrast' ? 7 : 4.5));
  }
});

test('slate identity initials stay readable in each theme', () => {
  for (const [mode, p] of Object.entries(study.modes)) {
    assert.ok(contrast(p.canvas, p.secondary) >= (mode === 'high-contrast' ? 7 : 4.5));
    for (const surface of [p.canvas, p.surface]) assert.ok(contrast(p.secondary, surface) >= 3);
  }
});

test('expression suppression wins over emotional expression and farewell', () => {
  for (const context of ['approval', 'evidence', 'result', 'failure', 'unknown']) {
    assert.equal(expressionFor('warm', context, true), 'none');
    assert.equal(expressionFor('warm', context, false), 'none');
    assert.doesNotMatch(markSvg({ expression: expressionFor('warm', context, true) }), /data-face/);
  }
  assert.equal(expressionFor('curious', 'conversation', false), 'neutral');
  assert.equal(expressionFor('curious', 'sensitive', true), 'neutral');
  assert.equal(expressionFor('curious', 'farewell', true), 'warm');
});

test('one silhouette survives every expression, and all placements have explicit sizes', () => {
  assert.deepEqual(Object.keys(study.placements).sort(), [
    'active-work', 'agent-list', 'card', 'conversation-header', 'life-author', 'message', 'notification',
  ]);
  const silhouettes = new Set();
  for (const size of new Set(Object.values(study.placements))) {
    assert.ok(size >= 16);
    for (const expression of ['neutral', 'warm', 'curious', 'reserved', 'none']) {
      const svg = markSvg({ size, expression });
      assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
      silhouettes.add(svg.match(/data-silhouette="lina" d="([^"]+)"/)[1]);
    }
  }
  assert.equal(silhouettes.size, 1);
});
