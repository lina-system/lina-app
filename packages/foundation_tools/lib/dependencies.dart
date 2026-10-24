// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';
import 'dart:io';

import 'package:yaml/yaml.dart';

final _exact = RegExp(
  r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$',
);
const _permissive = {
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-4-Clause',
  'ISC',
};
Never _fail(String message) => throw FormatException(message);
Map _map(Object? value, String label) {
  if (value is! Map) _fail('$label must be a mapping');
  return value;
}

Map _yaml(String path) {
  try {
    return _map(loadYaml(File(path).readAsStringSync()), path);
  } catch (error) {
    _fail('$path: $error');
  }
}

Map _json(String path) {
  try {
    return _map(jsonDecode(File(path).readAsStringSync()), path);
  } catch (error) {
    _fail('$path: $error');
  }
}

String _directory(String path) {
  try {
    return Directory(path).resolveSymbolicLinksSync();
  } catch (_) {
    _fail('package directory does not exist: $path');
  }
}

bool _isExact(Object? value) => value is String && _exact.hasMatch(value);

/// Checks every dependency, including dev dependencies and transitive lock entries.
/// Runtime notice coverage follows pub's resolved non-dev dependency graph.
void validateRepository(String root, List<String> packages) {
  final base = _directory(root);
  final manifests = <String, Map>{};
  final directories = <String, String>{};
  for (final package in packages) {
    final directory = _directory('$base/$package');
    if (!directory.startsWith('$base${Platform.pathSeparator}'))
      _fail('package escapes repository: $package');
    final manifest = _yaml('$directory/pubspec.yaml');
    final name = manifest['name'];
    if (name is! String ||
        name != package.split('/').last ||
        manifests.containsKey(name))
      _fail('invalid or duplicate package name: $package');
    manifests[name] = manifest;
    directories[name] = directory;
  }
  final licenses = _json('$base/scripts/verify/licenses.json');
  final reviewedPackages = _map(licenses['packages'], 'reviewed packages');
  final reviewedFonts = _map(licenses['fonts'], 'reviewed fonts');
  final notices = File('$base/THIRD-PARTY-NOTICES.md').readAsStringSync();
  void notice(Object? entry, String name, String version, {bool font = false}) {
    final review = _map(entry, 'license review for $name');
    final license = review['license'];
    if (!_permissive.contains(license) && !(font && license == 'OFL-1.1'))
      _fail('unapproved license for $name: $license');
    if (!_isExact(review['version']) || review['version'] != version)
      _fail('license review version mismatch for $name');
    final heading = review['notice'];
    if (heading is! String ||
        heading.isEmpty ||
        !RegExp(
          '^## ${RegExp.escape(heading)}\\r?\\n(?!#)\\s*\\S',
          multiLine: true,
        ).hasMatch(notices))
      _fail('missing notice section for $name');
  }

  for (final name in manifests.keys) {
    final directory = directories[name]!;
    final manifest = manifests[name]!;
    if (manifest.containsKey('dependency_overrides') ||
        File('$directory/pubspec_overrides.yaml').existsSync())
      _fail('dependency overrides are forbidden: $name');
    final lock = _map(
      _yaml('$directory/pubspec.lock')['packages'],
      '$name lock packages',
    );
    String pathTarget(String dependency, Object? spec) {
      if (spec is! String || spec.isEmpty || spec.startsWith('/'))
        _fail('invalid path dependency: $dependency');
      final target = _directory('$directory/$spec');
      if (directories[dependency] != target)
        _fail('path dependency must name a registered package: $dependency');
      return target;
    }

    for (final entry in lock.entries) {
      final dependency = entry.key as String;
      final value = _map(entry.value, '$dependency lock');
      if (!_isExact(value['version']))
        _fail('non-exact lock version: $dependency');
      switch (value['source']) {
        case 'hosted':
          final description = _map(
            value['description'],
            '$dependency description',
          );
          if (description['name'] != dependency ||
              description['url'] != 'https://pub.dev' ||
              !RegExp(r'^[a-f0-9]{64}$').hasMatch('${description['sha256']}'))
            _fail('untrusted source or missing SHA-256: $dependency');
        case 'sdk':
          if (value['description'] != 'flutter' || value['version'] != '0.0.0')
            _fail('unsupported SDK source: $dependency');
        case 'path':
          final description = _map(
            value['description'],
            '$dependency description',
          );
          if (description['relative'] != true)
            _fail('absolute lock path: $dependency');
          pathTarget(dependency, description['path']);
          if (value['version'] != manifests[dependency]!['version'])
            _fail('local package version mismatch: $dependency');
        default:
          _fail('unsupported dependency source: $dependency');
      }
    }
    for (final section in ['dependencies', 'dev_dependencies']) {
      final dependencies = _map(manifest[section] ?? {}, '$name $section');
      for (final entry in dependencies.entries) {
        final dependency = entry.key as String;
        final value = entry.value;
        final locked = _map(lock[dependency], '$dependency lock entry');
        if (value is String) {
          if (!_isExact(value) ||
              locked['source'] != 'hosted' ||
              locked['version'] != value)
            _fail(
              'dependency must have an exact matching hosted version: $dependency',
            );
        } else {
          final spec = _map(value, '$dependency specification');
          if (spec.length == 1 && spec['sdk'] == 'flutter') {
            if (locked['source'] != 'sdk')
              _fail('SDK lock mismatch: $dependency');
          } else if (spec.length == 1 && spec.containsKey('path')) {
            final target = pathTarget(dependency, spec['path']);
            if (locked['source'] != 'path' ||
                pathTarget(
                      dependency,
                      _map(locked['description'], dependency)['path'],
                    ) !=
                    target)
              _fail('path lock mismatch: $dependency');
          } else {
            _fail(
              'use an exact pub.dev version, Flutter SDK or registered path: $dependency',
            );
          }
        }
      }
    }
    // Tooling runs only on developer/CI hosts, never inside an app artifact.
    if (name != 'foundation_tools') {
      final graph = _json('$directory/.dart_tool/package_graph.json');
      final graphPackages = graph['packages'];
      if (graphPackages is! List)
        _fail('missing resolved package graph: $name');
      final byName = <String, Map>{};
      for (final entry in graphPackages) {
        final item = _map(entry, 'package graph entry');
        byName[item['name'] as String] = item;
      }
      final seen = <String>{};
      void visit(String dependency) {
        if (!seen.add(dependency)) return;
        final item = _map(byName[dependency], 'package graph for $dependency');
        if (!manifests.containsKey(dependency)) {
          final locked = _map(lock[dependency], 'runtime lock for $dependency');
          final version = locked['source'] == 'sdk'
              ? File('$base/.flutter-version').readAsStringSync().trim()
              : locked['version'] as String;
          notice(reviewedPackages[dependency], dependency, version);
        }
        final children = item['dependencies'];
        if (children is! List)
          _fail('missing runtime dependencies: $dependency');
        for (final child in children) {
          if (child is! String)
            _fail('invalid runtime dependency: $dependency');
          visit(child);
        }
      }

      visit(name);
    }
    final flutter = _map(manifest['flutter'] ?? {}, '$name flutter');
    final fonts = flutter['fonts'] ?? [];
    if (fonts is! List) _fail('fonts must be a list: $name');
    for (final family in fonts) {
      final variants = _map(family, 'font family')['fonts'];
      if (variants is! List) _fail('font variants must be a list');
      for (final variant in variants) {
        final asset = _map(variant, 'font variant')['asset'];
        if (asset is! String ||
            asset.startsWith('/') ||
            asset.split('/').contains('..'))
          _fail('unsafe font asset: $asset');
        final file = File('$directory/$asset');
        if (!file.existsSync() ||
            !file.resolveSymbolicLinksSync().startsWith(
              '$directory${Platform.pathSeparator}',
            ))
          _fail('missing or external font asset: $asset');
        final path =
            '${packages.firstWhere((p) => p.split('/').last == name)}/$asset';
        final entry = _map(reviewedFonts[path], 'font review: $path');
        notice(entry, path, '${entry['version']}', font: true);
      }
    }
  }
}
