// swift-tools-version: 5.9
// SPDX-License-Identifier: Apache-2.0
import PackageDescription

let package = Package(
    name: "LinaLauncher",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "DictionaryOfflineCheck", targets: ["DictionaryOfflineCheck"])],
    targets: [
        .executableTarget(name: "DictionaryOfflineCheck", dependencies: ["LinaLauncher"], path: "DictionaryOfflineCheck"),
        .target(name: "LinaLauncher", path: "Runner/Launcher", resources: [.process("Resources")]),
        .testTarget(name: "LinaLauncherTests", dependencies: ["LinaLauncher"], path: "LauncherTests"),
        .target(name: "LinaStatusItem", path: "Runner/StatusItem", exclude: ["StatusItemChannel.swift"]),
        .testTarget(name: "LinaStatusItemTests", dependencies: ["LinaStatusItem"], path: "StatusItemTests"),
    ]
)
