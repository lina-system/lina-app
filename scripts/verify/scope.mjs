// SPDX-License-Identifier: Apache-2.0
export const components = [
  { name: 'foundation_tools', path: 'packages/foundation_tools' },
  { name: 'lina_design', path: 'packages/lina_design' },
  { name: 'lina_app', path: 'packages/lina_app' },
];
const rootFiles = new Set([
  '.flutter-version', '.node-version', '.gitignore', 'README.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'DESIGN.md',
]);
export function classify(paths, registry = components) {
  const selected = new Set();
  for (const path of paths) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path: ${path}`);
    const component = registry.find(c => path.startsWith(`${c.path}/`));
    if (component) { selected.add(component.name); continue; }
    if (rootFiles.has(path) || /^docs\/(policy|research)\/[^/]+\.md$/.test(path) ||
        /^docs\/captures\/[^/]+\/[^/]+\.png$/.test(path) ||
        /^\.github\/(workflows|ISSUE_TEMPLATE)\/[^/]+\.ya?ml$/.test(path) ||
        path === '.github/PULL_REQUEST_TEMPLATE.md' ||
        /^scripts\/(verify\/)?[^/]+\.(mjs|json)$/.test(path) ||
        /^design\/tokens\/.+\.json$/.test(path) || path === 'release/manifest.json') continue;
    throw new Error(`unmapped path: ${path}; register its component and checks in scripts/verify/scope.mjs`);
  }
  return [...selected].sort();
}
