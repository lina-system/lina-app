// SPDX-License-Identifier: Apache-2.0
export const components = [
  { name: 'foundation_tools', path: 'packages/foundation_tools' },
  { name: 'lina_design', path: 'packages/lina_design' },
  { name: 'lina_protocol', path: 'packages/lina_protocol' },
  { name: 'lina_app', path: 'packages/lina_app' },
  { name: 'mac_panel', path: 'spikes/mac-panel' },
  { name: 'korean_input', path: 'spikes/korean-input' },
];
const rootFiles = new Set([
  '.flutter-version', '.node-version', '.gitattributes', '.gitignore', 'README.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'DESIGN.md',
]);
// Each tool has a dedicated CI job; do not admit arbitrary executable files.
const researchFiles = new Set([
  // #46: pinned Unicode data checked by the emoji generator in foundation.
  'data/emoji/annotations-en.json', 'data/emoji/annotations-ko.json',
  'data/emoji/annotationsDerived-en.json', 'data/emoji/annotationsDerived-ko.json',
  'data/emoji/emoji-test.txt', 'data/emoji/LICENSE.txt', 'data/emoji/upstream.json',
  'scripts/launcher-fixture.swift',
  'scripts/translation.mjs', // native-macos: installed-language seam with network denied
  'scripts/dictionary.mjs', // native-macos: offline Dictionary Services and evidence validation
  'design/tokens/core/tokens.swift',
  'scripts/benchmarks/launcher_baseline.py',
  'scripts/benchmarks/tests/test_launcher_baseline.py',
  'scripts/benchmarks/probe/main.swift',
  'scripts/benchmarks/probe/Recorder.swift',
  'scripts/benchmarks/probe/RecorderModel.swift',
  'scripts/benchmarks/probe/tests/main.swift',
  'scripts/benchmarks/probe/tests/run.sh',
  'scripts/benchmarks/probe_trials.py',
  'scripts/benchmarks/tests/test_probe_trials.py',
  'scripts/benchmarks/probe/panel-shortcut.swift',
  'scripts/benchmarks/probe/Info.plist',
  'scripts/benchmarks/probe/build.sh',
  'scripts/benchmarks/probe/sign.sh',
  'scripts/benchmarks/probe/run.sh',
  'scripts/benchmarks/probe/README.md',
  'docs/research/launcher-baseline-template.csv',
  'scripts/design-study/package.json',
  'scripts/design-study/package-lock.json',
  'scripts/design-study/render.mjs',
  'scripts/design-study/study.mjs',
  'scripts/design-study/study.test.mjs',
]);
// Conversation sources/tests are covered by lina_app and lina_protocol above.
// Theme/width and connection-error captures accompany their widget regressions.
const conversationCaptures = /^docs\/captures\/9\/(?:(?:light|dark|high-contrast)-(?:desktop|phone)|connection-(?:invalid|unavailable))\.png$/;
const designStudyAssets = /^docs\/research\/90-accent\/(?:[^/]+\.(?:md|json)|fonts\/(?:OFL\.txt|Pretendard-(?:Bold|Regular)\.otf)|(?:icons|marks|renders)\/[^/]+\.svg)$/;
export function classify(paths, registry = components) {
  const selected = new Set();
  for (const path of paths) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path: ${path}`);
    const component = registry.find(c => path.startsWith(`${c.path}/`));
    if (component) { selected.add(component.name); continue; }
    if (rootFiles.has(path) || researchFiles.has(path) || conversationCaptures.test(path) || designStudyAssets.test(path) ||
        /^docs\/(policy|research)\/[^/]+\.md$/.test(path) ||
        /^docs\/captures\/[^/]+\/[^/]+\.png$/.test(path) ||
        /^docs\/captures\/31\/[^/]+\.(?:md|json|log|mp4)$/.test(path) ||
        /^docs\/captures\/(?:40|44|45|46|49)\/[^/]+\.(?:md|json)$/.test(path) ||
        /^docs\/research\/captures\/mac-panel\/[^/]+\.(?:md|log|json|png)$/.test(path) ||
        /^docs\/research\/captures\/korean-input\/[^/]+\.(png|gif|json|txt)$/.test(path) ||
        /^\.github\/(workflows|ISSUE_TEMPLATE)\/[^/]+\.ya?ml$/.test(path) ||
        path === '.github/PULL_REQUEST_TEMPLATE.md' ||
        /^scripts\/(verify\/)?[^/]+\.(mjs|json)$/.test(path) ||
        /^protocol\/(?:upstream\.json|core\/(?:schema|fixtures)\/[^\0]+\.(?:json|md))$/.test(path) ||
        /^design\/tokens\/.+\.json$/.test(path) || path === 'release/manifest.json') continue;
    throw new Error(`unmapped path: ${path}; register its component and checks in scripts/verify/scope.mjs`);
  }
  return [...selected].sort();
}
