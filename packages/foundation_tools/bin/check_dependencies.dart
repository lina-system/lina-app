// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:foundation_tools/dependencies.dart';

void main(List<String> args) {
  if (args.length < 2) {
    stderr.writeln(
      'Usage: dart run bin/check_dependencies.dart ROOT PACKAGE...',
    );
    exitCode = 1;
    return;
  }
  try {
    validateRepository(args.first, args.skip(1).toList());
    stdout.writeln(
      'Dependency policy passed for ${args.length - 1} package(s).',
    );
  } catch (error) {
    stderr.writeln(error);
    exitCode = 1;
  }
}
