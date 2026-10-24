// SPDX-License-Identifier: Apache-2.0
import Darwin
import Foundation
import LinaLauncher

// Run this executable under sandbox-exec with (deny network*). A refused
// connection is not evidence of isolation: require the sandbox's permission error.
let descriptor = socket(AF_INET, SOCK_STREAM, 0)
var networkError: Int32 = errno
var connected = false
if descriptor >= 0 {
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = UInt16(9).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    connected = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
        }
    }
    networkError = connected ? 0 : errno
    close(descriptor)
}
guard !connected, networkError == EPERM || networkError == EACCES else {
    fputs("FAIL: network was not denied by the sandbox (errno \(networkError))\n", stderr)
    exit(1)
}
let results: [[String: Any]] = ["serendipity", "사과"].map { word in
    ["word": word, "definition": DeviceDictionary.definition(for: word) as Any? ?? NSNull()]
}
let evidence: [String: Any] = [
    "source": "macOS Dictionary Services",
    "networkProbe": ["connected": connected, "errno": networkError],
    "results": results,
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
]
let data = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
