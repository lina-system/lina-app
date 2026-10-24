// SPDX-License-Identifier: Apache-2.0
import FlutterMacOS

final class StatusItemChannel {
    private let channel: FlutterMethodChannel

    init(messenger: FlutterBinaryMessenger, controller: StatusItemController) {
        channel = FlutterMethodChannel(name: "org.lina.app/status-item/v1", binaryMessenger: messenger)
        channel.setMethodCallHandler { [weak controller] call, result in
            guard call.method == "update" else { result(FlutterMethodNotImplemented); return }
            guard let snapshot = StatusItemSnapshot(arguments: call.arguments) else {
                result(FlutterError(code: "invalid-status", message: "Expected phase and nullable agentName", details: nil))
                return
            }
            controller?.update(snapshot)
            // Opt-in synthetic harness: observe the actual Dart -> AppKit boundary.
            if ProcessInfo.processInfo.arguments.contains("--status-item-smoke"), let controller {
                let evidence: [String: Any] = ["phase": snapshot.phase.rawValue,
                                               "menu": controller.menu.items.map(\.title)]
                if let data = try? JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]),
                   let text = String(data: data, encoding: .utf8) {
                    print("LINA_STATUS_ITEM " + text)
                    fflush(stdout)
                }
            }
            result(nil)
        }
    }

    func dispose() { channel.setMethodCallHandler(nil) }
}
