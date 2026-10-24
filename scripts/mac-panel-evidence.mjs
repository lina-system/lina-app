// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function verifyVisibleEvidence(data, directory) {
  assert.equal(data.kind, 'native-shortcut-to-windowserver-visible-frame');
  assert.equal(data.status, 'measured');
  assert.equal(data.capturedOtherApplications, false);
  assert.equal(data.requestedPermissions, false);
  assert.equal(data.warmupExcluded, true);
  assert.equal(data.samples.length, 10);
  assert.ok(Number.isFinite(data.timebaseNumer) && data.timebaseNumer > 0);
  assert.ok(Number.isFinite(data.timebaseDenom) && data.timebaseDenom > 0);
  for (const [index, sample] of data.samples.entries()) {
    assert.equal(sample.trial, index + 1);
    assert.ok(['carbon-global-hotkey', 'appkit-local-keyDown'].includes(sample.inputSource));
    if (sample.inputSource === 'appkit-local-keyDown') {
      assert.equal(data.backgroundGlobalHotkeyLatency, 'unverified');
      assert.equal(sample.appWasActive, true);
    } else {
      assert.equal(data.backgroundGlobalHotkeyLatency, 'measured');
      assert.equal(sample.originalAppWasExternal, true);
      assert.equal(sample.originalAppStayedActive, true);
      assert.equal(sample.externalAppStillFrontmostAtFrame, true);
    }
    for (const flag of ['windowOnScreen', 'markerMatches', 'panelBecameKey']) assert.equal(sample[flag], true);
    for (const key of ['shortcutEventTimeSeconds', 'windowServerDisplayTimeSeconds', 'captureReceivedTimeSeconds', 'shortcutToVisibleMs', 'observationUpperBoundMs']) {
      assert.ok(Number.isFinite(sample[key]), key);
    }
    assert.ok(sample.shortcutEventTimeSeconds >= 0);
    assert.ok(sample.windowServerDisplayTimeSeconds >= sample.shortcutEventTimeSeconds);
    assert.ok(sample.captureReceivedTimeSeconds >= sample.windowServerDisplayTimeSeconds);
    assert.ok(Math.abs(sample.shortcutToVisibleMs - (sample.windowServerDisplayTimeSeconds - sample.shortcutEventTimeSeconds) * 1000) < 0.000001);
    assert.ok(Math.abs(sample.observationUpperBoundMs - (sample.captureReceivedTimeSeconds - sample.shortcutEventTimeSeconds) * 1000) < 0.000001);
    const accepted = data.frameTrace.find(frame => frame.trial === sample.trial && frame.markerMatches && frame.windowOnScreen &&
      [0, 4].includes(frame.status) && frame.displayTimeSeconds === sample.windowServerDisplayTimeSeconds);
    assert.ok(accepted, 'accepted sample must have a corresponding raw frame');
    assert.ok(Math.abs(accepted.displayTimeTicks * data.timebaseNumer / data.timebaseDenom / 1e9 - sample.windowServerDisplayTimeSeconds) < 0.000001);
    assert.ok([`visible-frame-${String(index + 1).padStart(2, '0')}.png`, `foreground-visible-frame-${String(index + 1).padStart(2, '0')}.png`].includes(sample.frame));
    const bytes = readFileSync(new URL(sample.frame, directory));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.frameSha256);
  }
  const times = data.samples.map(sample => sample.shortcutToVisibleMs).sort((a, b) => a - b);
  const result = { count: times.length, medianMs: (times[4] + times[5]) / 2, p90Ms: times[8] };
  assert.deepEqual(data.summary, result);
  for (const key of ['artifactExecutableSha256', 'artifactDartSha256']) assert.match(data[key], /^[a-f0-9]{64}$/);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = new URL('../docs/research/captures/mac-panel/', import.meta.url);
  const data = JSON.parse(readFileSync(new URL('visible-latency.json', directory)));
  console.log(JSON.stringify(verifyVisibleEvidence(data, directory)));
}
