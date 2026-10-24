// swift-tools-version: 5.9
// SPDX-License-Identifier: Apache-2.0
import PackageDescription

let package = Package(
    name: "MacPanelSpike",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "mac-panel-native", targets: ["NativeHarness"])],
    targets: [
        .target(name: "MacPanelPlatform", path: "macos/Runner/Platform"),
        .executableTarget(name: "NativeHarness", dependencies: ["MacPanelPlatform"], path: "native-harness"),
        .testTarget(name: "MacPanelPlatformTests", dependencies: ["MacPanelPlatform"], path: "native-tests"),
    ]
)
