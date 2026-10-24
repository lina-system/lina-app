// SPDX-License-Identifier: Apache-2.0
import 'dart:io';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:foundation_tools/dependencies.dart';

void main() {
  late Directory root;
  void put(String path, String text) {
    final file = File('${root.path}/$path');
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(text);
  }

  const manifest = '''
name: lina_app
environment:
  sdk: '>=3.13.0 <4.0.0'
dependencies:
  collection: 1.19.1
''';
  const lock = '''
packages:
  collection:
    dependency: direct main
    description:
      name: collection
      sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      url: https://pub.dev
    source: hosted
    version: 1.19.1
''';
  void check() => validateRepository(root.path, ['packages/lina_app']);
  setUp(() {
    root = Directory.systemTemp.createTempSync('lina-dependencies-');
    put('packages/lina_app/pubspec.yaml', manifest);
    put('packages/lina_app/pubspec.lock', lock);
    put(
      'packages/lina_app/.dart_tool/package_graph.json',
      jsonEncode({
        'packages': [
          {
            'name': 'lina_app',
            'dependencies': ['collection'],
          },
          {'name': 'collection', 'version': '1.19.1', 'dependencies': []},
        ],
      }),
    );
    put(
      'scripts/verify/licenses.json',
      jsonEncode({
        'packages': {
          'collection': {
            'version': '1.19.1',
            'license': 'BSD-3-Clause',
            'notice': 'collection',
          },
        },
        'fonts': {},
      }),
    );
    put(
      'THIRD-PARTY-NOTICES.md',
      '## collection\nBSD license text and source.\n',
    );
  });
  tearDown(() => root.deleteSync(recursive: true));
  test(
    'accepts an exact hosted dependency with hash, license and notice',
    check,
  );
  test(
    'registered hyphenated directory uses its canonical Dart package name',
    () {
      const path = 'spikes/korean-input';
      put('$path/pubspec.yaml', 'name: korean_input\n');
      put('$path/pubspec.lock', 'packages: {}\n');
      put(
        '$path/.dart_tool/package_graph.json',
        '{"packages":[{"name":"korean_input","dependencies":[]}]}',
      );
      expect(() => validateRepository(root.path, [path]), returnsNormally);
      put('$path/pubspec.yaml', 'name: unrelated\n');
      expect(
        () => validateRepository(root.path, [path]),
        throwsFormatException,
      );
    },
  );
  test(
    'version-qualified reviews preserve separately locked runtime versions',
    () {
      final inventory = jsonDecode(
        File('${root.path}/scripts/verify/licenses.json').readAsStringSync(),
      ) as Map<String, dynamic>;
      final packages = inventory['packages'] as Map<String, dynamic>;
      packages['collection'] = {
        'version': '1.20.0',
        'license': 'BSD-3-Clause',
        'notice': 'collection',
      };
      final specific = {
        'version': '1.19.1',
        'license': 'BSD-3-Clause',
        'notice': 'collection',
      };
      packages['collection@1.19.1'] = specific;
      void save() => put('scripts/verify/licenses.json', jsonEncode(inventory));
      save();
      expect(check, returnsNormally);
      specific['version'] = '1.19.0';
      save();
      expect(check, throwsFormatException);
      specific['version'] = '1.19.1';
      specific['license'] = 'GPL-3.0-only';
      save();
      expect(check, throwsFormatException);
      packages.remove('collection@1.19.1');
      save();
      expect(check, throwsFormatException);
    },
  );
  test('rejects ranges, any, git sources, overrides and malformed YAML', () {
    for (final spec in [
      '^1.19.1',
      'any',
      '>=1.0.0',
      '{git: https://example.com/source}',
      '',
    ]) {
      put(
        'packages/lina_app/pubspec.yaml',
        manifest.replaceFirst('collection: 1.19.1', 'collection: $spec'),
      );
      expect(check, throwsFormatException, reason: spec);
    }
    put(
      'packages/lina_app/pubspec.yaml',
      '$manifest\ndependency_overrides:\n  collection: 1.19.1\n',
    );
    expect(check, throwsFormatException);
    put('packages/lina_app/pubspec.yaml', 'dependencies: [');
    expect(check, throwsFormatException);
  });
  test('checks dev dependencies as well as runtime dependencies', () {
    put(
      'packages/lina_app/pubspec.yaml',
      '${manifest}dev_dependencies:\n  test: ^1.0.0\n',
    );
    expect(check, throwsFormatException);
  });
  test('rejects unlocked versions, missing hashes and foreign registries', () {
    for (final invalid in [
      lock.replaceAll('1.19.1', '1.19.0'),
      lock.replaceAll('https://pub.dev', 'https://example.com'),
      lock.replaceAll('a' * 64, 'invalid'),
      lock.replaceAll('source: hosted', 'source: git'),
    ]) {
      put('packages/lina_app/pubspec.lock', invalid);
      expect(check, throwsFormatException);
    }
  });
  test(
    'path dependencies must resolve to a registered in-repository package',
    () {
      put(
        'packages/lina_app/pubspec.yaml',
        'name: lina_app\ndependencies:\n  lina_design:\n    path: ../lina_design\n',
      );
      put(
        'packages/lina_app/pubspec.lock',
        'packages:\n  lina_design:\n    source: path\n    version: 0.1.0\n    description:\n      path: ../lina_design\n      relative: true\n',
      );
      put(
        'packages/lina_design/pubspec.yaml',
        'name: lina_design\nversion: 0.1.0\n',
      );
      expect(check, throwsFormatException);
      put('packages/lina_design/pubspec.lock', 'packages: {}\n');
      put(
        'packages/lina_design/.dart_tool/package_graph.json',
        '{"packages":[{"name":"lina_design","dependencies":[]}]}',
      );
      put(
        'packages/lina_app/.dart_tool/package_graph.json',
        '{"packages":[{"name":"lina_app","dependencies":["lina_design"]},{"name":"lina_design","dependencies":[]}]}',
      );
      expect(
        () => validateRepository(root.path, [
          'packages/lina_app',
          'packages/lina_design',
        ]),
        returnsNormally,
      );
      put(
        'packages/lina_app/pubspec.yaml',
        'name: lina_app\ndependencies:\n  lina_design:\n    path: ../../outside\n',
      );
      expect(
        () => validateRepository(root.path, [
          'packages/lina_app',
          'packages/lina_design',
        ]),
        throwsFormatException,
      );
    },
  );
  test('rejects unknown or copyleft runtime licenses and missing notices', () {
    for (final license in ['GPL-3.0-only', 'unknown']) {
      put(
        'scripts/verify/licenses.json',
        jsonEncode({
          'packages': {
            'collection': {
              'version': '1.19.1',
              'license': license,
              'notice': 'collection',
            },
          },
          'fonts': {},
        }),
      );
      expect(check, throwsFormatException);
    }
    put('scripts/verify/licenses.json', '{"packages":{},"fonts":{}}');
    expect(check, throwsFormatException);
  });
  test(
    'missing package graph cannot silently omit transitive runtime review',
    () {
      File('${root.path}/packages/lina_app/.dart_tool/package_graph.json')
          .deleteSync();
      expect(check, throwsFormatException);
    },
  );
  test('bundled font requires reviewed OFL or permissive notice and existing file', () {
    put(
      'packages/lina_app/pubspec.yaml',
      '$manifest\nflutter:\n  fonts:\n    - family: Pretendard\n      fonts:\n        - asset: assets/Pretendard.otf\n',
    );
    expect(check, throwsFormatException);
    put('packages/lina_app/assets/Pretendard.otf', 'synthetic font');
    put(
      'scripts/verify/licenses.json',
      jsonEncode({
        'packages': {
          'collection': {
            'version': '1.19.1',
            'license': 'BSD-3-Clause',
            'notice': 'collection',
          },
        },
        'fonts': {
          'packages/lina_app/assets/Pretendard.otf': {
            'license': 'OFL-1.1',
            'notice': 'Pretendard',
            'version': '1.3.9',
          },
        },
      }),
    );
    put(
      'THIRD-PARTY-NOTICES.md',
      '## collection\nReviewed BSD text.\n## Pretendard\nReviewed OFL text.\n',
    );
    expect(check, returnsNormally);
  });
}
