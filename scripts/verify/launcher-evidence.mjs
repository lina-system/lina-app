// SPDX-License-Identifier: Apache-2.0
export function verifyFocusEvidence(evidence, fixturePID, fixtureLog) {
  const samples = evidence?.samples;
  if (!Number.isInteger(fixturePID) || fixturePID <= 0 || !evidence?.firstFrameReady ||
      evidence.loginItem !== 'disabledInTests' || samples?.length !== 4 ||
      samples.map(s => s.phase).join(',') !== 'hidden-ready,show,type,escape' ||
      samples.some(s => s.fixturePID !== fixturePID || s.frontmostPID !== fixturePID || s.fixtureActive !== true) ||
      samples[0].visible || !samples[1].visible || !samples[2].visible ||
      !samples[1].panelKey || !samples[2].panelKey || samples[2].query !== 'abc' || samples[3].visible ||
      !fixtureLog.includes(`LINA_FIXTURE_READY ${fixturePID}`) || fixtureLog.includes('LINA_FIXTURE_DEACTIVATED')) {
    throw Error('Focus/typing/dismissal failed');
  }
  // NSApp.isActive on the key panel's process is diagnostic only. The actual
  // foreground owner must retain both its PID and active state throughout.
}
