// swift-tools-version: 5.9
// SPDX-License-Identifier: Apache-2.0
import PackageDescription

let package = Package(
    name: "LinaLauncher",
    platforms: [.macOS(.v12)],
    targets: [
        .target(name: "LinaLauncher", path: "Runner/Launcher"),
        .testTarget(name: "LinaLauncherTests", dependencies: ["LinaLauncher"], path: "LauncherTests"),
        .target(name: "LinaStatusItem", path: "Runner/StatusItem", exclude: ["StatusItemChannel.swift"]),
        .testTarget(name: "LinaStatusItemTests", dependencies: ["LinaStatusItem"], path: "StatusItemTests"),
    ]
)
