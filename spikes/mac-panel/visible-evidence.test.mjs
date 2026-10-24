// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyVisibleEvidence } from '../../scripts/mac-panel-evidence.mjs';

const evidence = JSON.parse(readFileSync(new URL('../../docs/research/captures/mac-panel/visible-latency.json', import.meta.url)));
const frames = new URL('../../docs/research/captures/mac-panel/', import.meta.url);
test('accepted evidence has ten real shortcut/WindowServer frame pairs', () => {
  assert.equal(verifyVisibleEvidence(evidence, frames).count, 10);
});
test('ordering-only, stale, hidden, mismatched or fabricated summaries cannot pass', () => {
  for (const modify of [
    d => { d.kind = 'flutter-panel-ordering-proxy'; },
    d => { d.samples[0].windowServerDisplayTimeSeconds = d.samples[0].shortcutEventTimeSeconds - 1; },
    d => { d.samples[0].windowOnScreen = false; },
    d => { d.samples[0].markerMatches = false; },
    d => { d.samples[0].inputSource = 'direct-show'; },
    d => { d.samples[0].frameSha256 = '0'.repeat(64); },
    d => { d.summary.medianMs = 1; },
    d => { d.backgroundGlobalHotkeyLatency = 'measured'; },
  ]) {
    const changed = structuredClone(evidence);
    modify(changed);
    assert.throws(() => verifyVisibleEvidence(changed, frames));
  }
});
