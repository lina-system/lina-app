# App dependencies

This is the app-repository counterpart of Core's Go-module and npm-package
policy. All Dart packages, Flutter SDK use, generator tools and bundled fonts
follow it from their first commit. LINA code is Apache-2.0; no paid,
source-restricted or noncommercial UI kit is permitted.

## Toolchain and configuration

`.flutter-version` pins **3.47.8 stable**. The local gate, CI and native release
entry point check that exact version and stable channel, and
`release/manifest.json` records it. Never silently change the pin to fix a build.
Dart comes with Flutter; `environment.sdk` is a compatibility constraint, not a
second SDK installation. Node tooling uses `.node-version` and built-in modules.
The policy parser uses `yaml: 3.1.3` in `packages/foundation_tools/pubspec.yaml`.
Its committed lockfile pins 25 packages: 22 hosted and 3 Flutter SDK packages.
All of these are development tooling, not app in-process dependencies.

## Exact versions and sources

- Every `dependencies` and `dev_dependencies` hosted entry is a scalar exact
  version, such as `yaml: 3.1.3`. No caret, range, `any`, null, Git source or
  custom registry. Hosted-map syntax is deliberately not supported.
- Flutter SDK dependencies use `sdk: flutter`; the SDK pin owns their versions.
- A path dependency must name another registered package and resolve to its
  directory inside this repository, including after symlink resolution. Its
  lockfile version must match the target manifest. External paths are rejected.
- `dependency_overrides` and `pubspec_overrides.yaml` are forbidden, including
  ignored local override files. Make the dependency update explicit instead.
- Every hosted transitive lock entry has an exact version, `https://pub.dev`
  source, matching package name and a 64-character SHA-256 content hash.
  Pub's enforced install verifies the hash against downloaded content.

## Lockfile and builds

Every active package commits `pubspec.yaml` and `pubspec.lock`, including local
libraries and tooling. Only Pub changes a lockfile, in the same change as its
manifest or deliberate transitive update. Verification always uses
`flutter pub get --enforce-lockfile`, then analyzes/tests/builds with `--no-pub`.
A lockfile difference fails even if Pub exits successfully. Never replace the
check with plain `pub get`, `pub upgrade` or a missing-lockfile fallback in CI.
Downloads use the public Pub registry. Verification needs no private registry,
Core instance, model account or signing key. Keep release publication separate.

## Adding or updating a dependency

Use the same small, deliberate sequence as Core's Go and npm updates:

1. Prefer SDK functionality and Node built-ins. Explain the needed package and
   exact version; read its changelog, source, breaking changes and license.
2. Edit the relevant manifest to an exact version. For an intentional update,
   run `flutter pub get` in that package; use `flutter pub upgrade <name>` only
   when deliberately refreshing a locked transitive dependency. Never hand-edit
   the lockfile. Review added/removed versions and transitive package count.
3. Review the complete non-dev import closure in Pub's generated
   `.dart_tool/package_graph.json`. For app/design dependencies, record exact
   versions and SPDX licenses in `scripts/verify/licenses.json` and include
   copyright, license text, upstream URL/revision and required Apache NOTICE
   content in `THIRD-PARTY-NOTICES.md`. SDK runtime entries use the Flutter pin
   as their reviewed version. Local packages remain Apache-2.0.
4. For every `flutter.fonts` asset, record its repository path, exact upstream
   version, license and notice heading in the same inventory. Include the actual
   OFL text and copyright with a bundled Pretendard font in #5. A font path must
   exist and stay inside its package. Review font assets loaded by custom code
   or a generic asset directory as well; the automated inventory check covers
   the explicit `flutter.fonts` declarations, not arbitrary runtime loaders.
5. Stage manifest, lockfile and notices together. Run the full foundation gate,
   including owning tests/codegen. State the reason, versions and results in
   the PR. SDK changes update the pin and release manifest together and rerun
   the platform checks that rely on that SDK; an unrun platform is unverified.

## License enforcement and limits

The Dart validator follows the resolved runtime dependency graph for app/design
packages, including transitives. Missing graph/lock entries, missing reviews,
version mismatch, unapproved licenses or absent notice sections fail. Allowed
code licenses are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, BSD-4-Clause and ISC.
OFL-1.1 is additionally allowed **for fonts only**. Copyleft runtime code must
not enter the app process. The tooling package is never bundled with the app.

The validator checks declared review metadata and notice presence. Human review
must establish actual upstream license terms, completeness of notice text,
font provenance and release-bundle coverage. This is not a vulnerability scanner
or proof that a newly added native plugin has been legally audited. A plugin's
native dependencies must join the same review before its first release.
The active app/design runtime closure contains Flutter, sky_engine and five
hosted SDK dependencies; every version and notice is inventoried. Pretendard
1.3.9 and JetBrains Mono v2.304 are bundled under OFL-1.1. Lucide v0.468.0
paths carry ISC and Feather MIT notices. Theme verification checks the reviewed
asset digests. Native builders retain the license registry and package the resolved engine
notice file, recording its SHA-256 in artifact evidence.

Generator versions and entry-script hashes are pinned as described in the
[foundation policy](foundation.md#generated-sources-and-lint). Theme/lint and Dart schema generation are active; see
[the generator decision](host-protocol.md). Core owns its canonical schema and TUI palette.
