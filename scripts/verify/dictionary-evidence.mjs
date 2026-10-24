// SPDX-License-Identifier: Apache-2.0
export function verifyDictionaryEvidence(value) {
  if (value?.source !== 'macOS Dictionary Services') throw Error('Missing Dictionary Services provenance');
  if (value.networkProbe?.connected !== false || ![1, 13].includes(value.networkProbe?.errno)) {
    throw Error('The network probe must fail with EPERM or EACCES under the sandbox');
  }
  const words = ['serendipity', '사과'];
  if (!Array.isArray(value.results) || value.results.length !== words.length ||
      value.results.some((result, i) => result.word !== words[i] ||
        !(result.definition === null || (typeof result.definition === 'string' && result.definition.trim())))) {
    throw Error('Expected actual definition strings or explicit missing entries for both acceptance words');
  }
  return {
    network: 'denied',
    available: value.results.filter(r => r.definition !== null).map(r => r.word),
    unavailable: value.results.filter(r => r.definition === null).map(r => r.word),
  };
}
