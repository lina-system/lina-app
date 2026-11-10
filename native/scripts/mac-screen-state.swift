// SPDX-License-Identifier: AGPL-3.0-only
// Prints the console screen state and exits 0 only when it is unlocked:
//   locked (exit 1), unlocked (exit 0), unknown (exit 2: no session dictionary).
// The Mac's python3 has no Quartz, so this reads CGSessionCopyCurrentDictionary.
import CoreGraphics
import Foundation

guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else {
    print("unknown")
    exit(2)
}
let locked = (session["CGSSessionScreenIsLocked"] as? Bool) ?? false
let onConsole = (session[kCGSessionOnConsoleKey as String] as? Bool) ?? false
if locked {
    print("locked")
    exit(1)
}
print(onConsole ? "unlocked" : "unknown")
exit(onConsole ? 0 : 2)
