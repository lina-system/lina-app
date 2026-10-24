// SPDX-License-Identifier: Apache-2.0
import Foundation
import ServiceManagement

public protocol LoginItemService {
    var state: String { get }
    func setEnabled(_ enabled: Bool) throws
}
public enum LoginItemError: Error { case disabledInTests, unsupported }

public final class SystemLoginItem: LoginItemService {
    private let allowsChanges: Bool
    public init(allowsChanges: Bool) { self.allowsChanges = allowsChanges }
    public var state: String {
        guard allowsChanges else { return "disabledInTests" }
        if #available(macOS 13, *) {
            switch SMAppService.mainApp.status {
            case .enabled: return "enabled"
            case .requiresApproval: return "requiresApproval"
            case .notRegistered: return "notRegistered"
            case .notFound: return "notFound"
            @unknown default: return "unknown"
            }
        }
        return "unsupported"
    }
    public func setEnabled(_ enabled: Bool) throws {
        guard allowsChanges else { throw LoginItemError.disabledInTests }
        guard #available(macOS 13, *) else { throw LoginItemError.unsupported }
        // Only an explicit checkbox action reaches this method; never register at launch.
        if enabled { try SMAppService.mainApp.register() }
        else { try SMAppService.mainApp.unregister() }
    }
}
