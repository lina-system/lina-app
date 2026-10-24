// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDictionaryEvidence } from './dictionary-evidence.mjs';

const evidence = () => ({
  source: 'macOS Dictionary Services',
  networkProbe: { connected: false, errno: 1 },
  results: [
    { word: 'serendipity', definition: 'A fortunate discovery.' },
    { word: '사과', definition: '과일의 한 종류.' },
  ],
});
test('records real definitions obtained with network denied', () => {
  assert.deepEqual(verifyDictionaryEvidence(evidence()), {
    network: 'denied', available: ['serendipity', '사과'], unavailable: [],
  });
});
test('does not claim missing device dictionaries passed word acceptance', () => {
  const value = evidence();
  value.results[1].definition = null;
  assert.deepEqual(verifyDictionaryEvidence(value), {
    network: 'denied', available: ['serendipity'], unavailable: ['사과'],
  });
});
test('rejects an untested, reachable or merely unavailable network', () => {
  for (const probe of [undefined, { connected: true, errno: 0 }, { connected: false, errno: 61 }]) {
    assert.throws(() => verifyDictionaryEvidence({ ...evidence(), networkProbe: probe }), /network/);
  }
});
test('requires both exact words, actual API provenance and nonempty definition data', () => {
  for (const change of [
    { source: 'fixture' }, { results: [] },
    { results: [evidence().results[0], evidence().results[0]] },
    { results: [{ word: 'serendipity', definition: '' }, evidence().results[1]] },
    { results: [{ word: 'serendipity' }, evidence().results[1]] },
  ]) assert.throws(() => verifyDictionaryEvidence({ ...evidence(), ...change }));
});
