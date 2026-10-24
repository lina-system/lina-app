// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyFocusEvidence } from './launcher-evidence.mjs';
function evidence() {
  return {
    firstFrameReady: true, loginItem: 'disabledInTests',
    samples: ['hidden-ready', 'show', 'type', 'escape'].map((phase, index) => ({
      phase, fixturePID: 123, frontmostPID: 123, fixtureActive: true,
      appActive: index === 1 || index === 2, panelKey: index === 1 || index === 2,
      visible: index === 1 || index === 2, query: index >= 2 ? 'abc' : '',
    })),
  };
}
test('a key nonactivating panel may report AppKit active while the fixture stays active', () => {
  assert.doesNotThrow(() => verifyFocusEvidence(evidence(), 123, 'LINA_FIXTURE_READY 123\n'));
});
test('a changed foreground PID, fixture deactivation, absent typing or dismissal fails', () => {
  const log = 'LINA_FIXTURE_READY 123\n';
  for (const mutate of [
    e => { e.samples[1].frontmostPID = 999; },
    e => { e.samples[2].fixtureActive = false; },
    e => { delete e.samples[2].fixtureActive; },
    e => { e.samples[2].query = ''; },
    e => { e.samples[3].visible = true; },
    e => { e.samples[1].panelKey = false; },
    e => { e.firstFrameReady = false; },
    e => { e.samples.reverse(); },
  ]) {
    const changed = evidence(); mutate(changed);
    assert.throws(() => verifyFocusEvidence(changed, 123, log), /failed/);
  }
  assert.throws(() => verifyFocusEvidence(evidence(), 123, `${log}LINA_FIXTURE_DEACTIVATED\n`), /failed/);
  assert.throws(() => verifyFocusEvidence(evidence(), 123, ''), /failed/);
});
