// SPDX-License-Identifier: Apache-2.0
import 'dart:ffi';
import 'dart:io';

String get nativePlatform {
  final os = Platform.isMacOS ? 'darwin' : Platform.operatingSystem;
  final abi = Abi.current().toString().split('_').last;
  final arch = switch (abi) {
    'x64' => 'amd64',
    'ia32' => '386',
    _ => abi,
  };
  return '$os/$arch';
}
