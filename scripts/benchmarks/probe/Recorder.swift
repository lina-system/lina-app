// SPDX-License-Identifier: Apache-2.0
import AppKit
import ApplicationServices
import Carbon
import CryptoKit
import Darwin
import ScreenCaptureKit
import Vision

func desktopLocked() -> Bool {
  guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
  return session["CGSSessionScreenIsLocked"] as? Bool ?? false
}

func checkDesktop() throws {
  try requireUnlockedSession(locked: desktopLocked(),
                             frontBundle: NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
}

func spotlightOwnsCommandSpace() -> Bool {
  guard let keys = CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString,
                    "com.apple.symbolichotkeys" as CFString) as? [String: Any],
        let item = keys["64"] as? [String: Any], item["enabled"] as? Bool == true,
        let value = item["value"] as? [String: Any], let parameters = value["parameters"] as? [Int],
        parameters.count == 3 else { return false }
  return parameters[1] == 49 && parameters[2] == 1_048_576
}

private let probeEventTag: Int64 = 0x4C494E4150524F42

func hostClock() -> HostClock {
  var info = mach_timebase_info_data_t()
  mach_timebase_info(&info)
  return HostClock(numerator: info.numer, denominator: info.denom)
}

func commandOutput(_ executable: String, _ arguments: [String]) throws -> String {
  let task = Process(), pipe = Pipe()
  task.executableURL = URL(fileURLWithPath: executable); task.arguments = arguments
  task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
  try task.run()
  let data = pipe.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  guard task.terminationStatus == 0 else { throw ProbeError.message("command failed: \(executable)") }
  return String(decoding: data, as: UTF8.self)
}

func hidIdleSeconds() throws -> Double {
  let output = try commandOutput("/usr/sbin/ioreg", ["-r", "-c", "IOHIDSystem"])
  let regex = try NSRegularExpression(pattern: "\"HIDIdleTime\" = ([0-9]+)")
  let matches = regex.matches(in: output, range: NSRange(output.startIndex..., in: output))
  let values = matches.compactMap { match -> Double? in
    guard let range = Range(match.range(at: 1), in: output) else { return nil }
    return Double(output[range]).map { $0 / 1_000_000_000 }
  }
  guard let idle = values.min() else { throw ProbeError.message("HIDIdleTime unavailable") }
  return idle
}

func inputSourceID() -> String {
  let source = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
  guard let property = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { return "unknown" }
  return Unmanaged<CFString>.fromOpaque(property).takeUnretainedValue() as String
}

func saveJSON<T: Encodable>(_ value: T, _ url: URL) throws {
  try JSONEncoder.probe.encode(value).write(to: url, options: .atomic)
}

func privateAttempt(_ label: String) throws -> URL {
  let root = supportDirectory().appendingPathComponent("captures", isDirectory: true)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                         attributes: [.posixPermissions: 0o700])
  let id = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
    + "-\(label)-" + UUID().uuidString.lowercased()
  let dir = root.appendingPathComponent(id, isDirectory: true)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false,
                                         attributes: [.posixPermissions: 0o700])
  return dir
}

// Listen-only: user activity is never intercepted or suppressed. A physical
// event permanently cancels the block, including cleanup key posting.
final class InputWatch {
  private let lock = NSLock()
  private var reason: String?
  private var tap: CFMachPort?
  private var runLoop: CFRunLoop?
  var fault: String? { lock.lock(); defer { lock.unlock() }; return reason }
  func cancel(_ value: String) { lock.lock(); reason = reason ?? value; lock.unlock() }
  func start() throws {
    let ready = DispatchSemaphore(value: 0)
    Thread.detachNewThread { [self] in
      let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDown,
        .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
        .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
      let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
      tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
        options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, context in
          let watch = Unmanaged<InputWatch>.fromOpaque(context!).takeUnretainedValue()
          if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            watch.cancel("input_monitor_disabled")
          } else if event.getIntegerValueField(.eventSourceUserData) != probeEventTag {
            watch.cancel("real_input")
          }
          return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
      guard let tap else { cancel("input_monitor_unavailable"); ready.signal(); return }
      runLoop = CFRunLoopGetCurrent()
      let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
      CFRunLoopAddSource(runLoop, source, .commonModes)
      CGEvent.tapEnable(tap: tap, enable: true)
      ready.signal(); CFRunLoopRun()
      CFMachPortInvalidate(tap)
    }
    ready.wait()
    if let fault { throw ProbeError.message(fault) }
  }
  func stop() { if let runLoop { CFRunLoopStop(runLoop) } }
  func check() throws { if let fault { throw ProbeError.message(fault) } }
}

func postKey(_ code: UInt16, down: Bool, flags: CGEventFlags = [], pid: pid_t? = nil) throws -> PostedKey {
  guard let source = CGEventSource(stateID: .hidSystemState),
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
  else { throw ProbeError.message("cannot create key event") }
  event.flags = flags
  event.setIntegerValueField(.eventSourceUserData, value: probeEventTag)
  // These two raw timestamps bracket only the actual posting call.
  let before = mach_absolute_time()
  if let pid { event.postToPid(pid) } else { event.post(tap: .cghidEventTap) }
  let after = mach_absolute_time()
  return PostedKey(code: code, down: down, flags: flags.rawValue, before: before, after: after)
}

func launcherBundle(_ launcher: String) -> String {
  launcher == "spotlight" ? "com.apple.Spotlight" : "com.raycast.macos"
}

func focusedField(_ pid: pid_t) -> [String: String]? {
  let system = AXUIElementCreateSystemWide()
  AXUIElementSetMessagingTimeout(system, 0.1)
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value) == .success,
        let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  let element = unsafeBitCast(value, to: AXUIElement.self)
  var focusedPID: pid_t = 0
  guard AXUIElementGetPid(element, &focusedPID) == .success, focusedPID == pid else { return nil }
  func attribute(_ name: String) -> String {
    var result: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(element, name as CFString, &result)
    return result as? String ?? ""
  }
  let role = attribute(kAXRoleAttribute)
  guard [kAXTextFieldRole, kAXTextAreaRole, "AXSearchField", "AXComboBox"].contains(role) else { return nil }
  var position: CFTypeRef?, size: CFTypeRef?
  var point = CGPoint.zero, dimensions = CGSize.zero
  guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
        let position, let size, CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID(),
        AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
        AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions) else { return nil }
  return ["role": role, "value": attribute(kAXValueAttribute),
          "x": String(Double(point.x)), "y": String(Double(point.y)), "width": String(Double(dimensions.width)), "height": String(Double(dimensions.height))]
}

func hasLauncherWindow(_ pid: pid_t) -> Bool {
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  return windows.contains { window in
    guard (window[kCGWindowOwnerPID as String] as? Int32) == pid,
          let bounds = window[kCGWindowBounds as String] as? [String: Double] else { return false }
    return (bounds["Width"] ?? 0) > 200 && (bounds["Height"] ?? 0) > 40
  }
}

func sampleRSS(_ launcher: String, requested: UInt64) throws -> RSSSample {
  struct Candidate { let pid: pid_t; let parent: pid_t; let path: String }
  func discover() throws -> [Candidate] {
    try commandOutput("/bin/ps", ["-axo", "pid=,ppid=,comm="]).split(separator: "\n").compactMap { line in
      let parts = line.split(maxSplits: 2, whereSeparator: { $0 == " " || $0 == "\t" })
      guard parts.count == 3, let pid = Int32(parts[0]), let parent = Int32(parts[1]) else { return nil }
      // ps comm can be a renamed process title (e.g. "Raycast Backend").
      var pathBuffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
      let length = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
      let path = length > 0 ? String(cString: pathBuffer) : String(parts[2])
      return Candidate(pid: pid, parent: parent, path: path)
    }
  }
  let started = mach_absolute_time()
  let bundle = NSWorkspace.shared.urlForApplication(withBundleIdentifier: launcherBundle(launcher))?.path
  guard let bundle else { throw ProbeError.message("launcher bundle unavailable for RSS attribution") }
  let processes = try discover()
  let mainPIDs = NSRunningApplication.runningApplications(withBundleIdentifier: launcherBundle(launcher))
    .map(\.processIdentifier)
  // Match executable ownership, not only ppid; this includes reparented helpers.
  // Then include descendants of that set for externally hosted Node helpers.
  let pids = attributedPIDs(processes.map {
    ProcessIdentity(pid: $0.pid, parentPid: $0.parent, executable: $0.path)
  }, bundlePath: bundle, mainPIDs: Set(mainPIDs))
  func sample(_ p: Candidate, role: String) -> ProcessSample {
    var info = proc_taskinfo()
    let tick = mach_absolute_time()
    let size = Int32(MemoryLayout<proc_taskinfo>.size)
    let read = proc_pidinfo(p.pid, PROC_PIDTASKINFO, 0, &info, size)
    return ProcessSample(pid: p.pid, parentPid: p.parent, role: role, executable: p.path,
      residentBytes: read == size && info.pti_resident_size > 0 ? info.pti_resident_size : nil,
      sampledTicks: tick)
  }
  let attributed = processes.filter { pids.contains($0.pid) }.map {
    sample($0, role: mainPIDs.contains($0.pid) ? "main" : "helper")
  }
  let sharedNames = ["mds", "mds_stores", "mdworker", "mdworker_shared", "corespotlightd"]
  let shared = processes.filter { sharedNames.contains(URL(fileURLWithPath: $0.path).lastPathComponent) }
    .map { sample($0, role: "shared_indexing_not_attributed") }
  let after = try discover()
  let newOwned = after.filter { $0.path.hasPrefix(bundle + "/") || pids.contains($0.parent) }
  // Shared WebKit/Node hosts with no attributable ancestor are ambiguous.
  // Retain them, and refuse a supposedly complete Raycast total.
  let ambiguous = launcher == "raycast" ? processes.filter {
    !pids.contains($0.pid) && (["node", "com.apple.WebKit.WebContent"].contains(URL(fileURLWithPath: $0.path).lastPathComponent))
  }.map { sample($0, role: "unattributed_possible_helper") } : []
  let complete = ambiguous.isEmpty && !mainPIDs.isEmpty && mainPIDs.allSatisfy { pid in attributed.contains { $0.pid == pid } }
    && !attributed.isEmpty && attributed.allSatisfy { $0.residentBytes != nil }
    && newOwned.allSatisfy { pids.contains($0.pid) }
    && pids.allSatisfy { pid in after.contains { $0.pid == pid } }
  return RSSSample(requestedTicks: requested, startedTicks: started, finishedTicks: mach_absolute_time(),
    complete: complete, processes: attributed, sharedServices: shared, unattributedHelpers: ambiguous)
}

final class FrameWriter: NSObject, SCStreamOutput, SCStreamDelegate {
  let directory: URL
  let queue = DispatchQueue(label: "dev.lina.probe.frames")
  private let writer = DispatchQueue(label: "dev.lina.probe.disk")
  private let slots = DispatchSemaphore(value: 4)
  private let lock = NSLock()
  private var recorded: [RecordedFrame] = []
  private var errors: [String] = []
  private var lastComplete: Int?
  init(_ directory: URL) { self.directory = directory }
  var frames: [RecordedFrame] { lock.lock(); defer { lock.unlock() }; return recorded }
  var faults: [String] { lock.lock(); defer { lock.unlock() }; return errors }
  func fault(_ value: String) { lock.lock(); errors.append(value); lock.unlock() }
  func stream(_ stream: SCStream, didStopWithError error: Error) { fault("stream_error: \(error)") }
  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen else { return }
    let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
      as? [[SCStreamFrameInfo: Any]]
    let info = attachments?.first ?? [:]
    let status = (info[.status] as? NSNumber)?.intValue ?? -1
    lock.lock(); let index = recorded.count; lock.unlock()
    var frame = RecordedFrame(index: index, displayTicks: (info[.displayTime] as? NSNumber)?.uint64Value,
                              status: status)
    frame.receivedTicks = mach_absolute_time()
    frame.contentScale = (info[.contentScale] as? NSNumber)?.doubleValue
    frame.scaleFactor = (info[.scaleFactor] as? NSNumber)?.doubleValue
    let rect: CGRect?
    if let dictionary = info[.contentRect] as? NSDictionary {
      rect = CGRect(dictionaryRepresentation: dictionary)
    } else { rect = info[.contentRect] as? CGRect }
    if let rect { frame.contentRect = [rect.minX, rect.minY, rect.width, rect.height] }
    if status == SCFrameStatus.complete.rawValue &&
       (frame.displayTicks == nil || frame.contentRect == nil || frame.contentScale == nil || frame.scaleFactor == nil) {
      fault("missing_frame_metadata")
    }
    if status == SCFrameStatus.idle.rawValue { frame.persistedFrom = lastComplete }
    if status == SCFrameStatus.complete.rawValue, let pixels = CMSampleBufferGetImageBuffer(buffer) {
      if slots.wait(timeout: .now()) == .success {
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        frame.width = CVPixelBufferGetWidth(pixels); frame.height = CVPixelBufferGetHeight(pixels)
        frame.bytesPerRow = CVPixelBufferGetBytesPerRow(pixels)
        if let base = CVPixelBufferGetBaseAddress(pixels) {
          let data = Data(bytes: base, count: frame.bytesPerRow * frame.height)
          let relative = String(format: "frames/%06d.bgra", index)
          frame.file = relative; lastComplete = index
          writer.async { [self] in
            defer { slots.signal() }
            do { try data.write(to: directory.appendingPathComponent(relative)) }
            catch { fault("writer_error: \(error)") }
          }
        } else { slots.signal(); fault("missing_pixel_buffer") }
        CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
      } else { fault("queue_overflow") }
    }
    lock.lock(); recorded.append(frame); lock.unlock()
  }
  func flush() { queue.sync {}; writer.sync {} }
}

func imageFromFrame(_ frame: RecordedFrame, directory: URL) throws -> CGImage {
  guard let file = frame.file else { throw ProbeError.message("frame has no pixels") }
  let data = try Data(contentsOf: directory.appendingPathComponent(file), options: .mappedIfSafe)
  guard data.count == frame.bytesPerRow * frame.height,
        let provider = CGDataProvider(data: data as CFData),
        let image = CGImage(width: frame.width, height: frame.height, bitsPerComponent: 8,
          bitsPerPixel: 32, bytesPerRow: frame.bytesPerRow, space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
            .union(.byteOrder32Little), provider: provider, decode: nil, shouldInterpolate: false,
          intent: .defaultIntent) else { throw ProbeError.message("invalid raw frame") }
  return image
}
func cgRect(_ values: [Double]) -> CGRect {
  CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
}
func recognize(_ image: CGImage, rect: [Double]) throws -> (String, Double) {
  guard let crop = image.cropping(to: cgRect(rect)) else { throw ProbeError.message("OCR region outside capture") }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate; request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-US", "ko-KR"]
  try VNImageRequestHandler(cgImage: crop).perform([request])
  let candidates = (request.results ?? []).compactMap { $0.topCandidates(1).first }
  return (candidates.map(\.string).joined(separator: " "), Double(candidates.map(\.confidence).min() ?? 0))
}
func writePNG(_ image: CGImage, _ url: URL) throws {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)
  else { throw ProbeError.message("cannot create PNG") }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { throw ProbeError.message("cannot finish PNG") }
}

func annotateFrames(_ frames: [RecordedFrame], directory: URL, config: PilotConfig) throws -> [RecordedFrame] {
  var result = frames
  guard let baseline = frames.first(where: { $0.file != nil }), let baselinePath = baseline.file else { return frames }
  let base = try Data(contentsOf: directory.appendingPathComponent(baselinePath))
  let roi = cgRect(config.panelRect).integral
  for i in result.indices {
    try autoreleasepool {
    if let file = result[i].file {
      let raw = try Data(contentsOf: directory.appendingPathComponent(file), options: .mappedIfSafe)
      guard roi.maxX <= Double(result[i].width), roi.maxY <= Double(result[i].height),
            raw.count == base.count else { throw ProbeError.message("invalid panel ROI or changing capture dimensions") }
      var changed = 0, count = 0
      // Mask all pixels outside the frozen panel ROI; ignore cursor (not captured).
      raw.withUnsafeBytes { (current: UnsafeRawBufferPointer) in
        base.withUnsafeBytes { (previous: UnsafeRawBufferPointer) in
          for y in Int(roi.minY)..<Int(roi.maxY) {
            for x in Int(roi.minX)..<Int(roi.maxX) {
              let offset = y * result[i].bytesPerRow + x * 4
              let delta = (0..<3).map { abs(Int(current[offset + $0]) - Int(previous[offset + $0])) }.max()!
              if delta >= config.pixelDelta { changed += 1 }
              count += 1
            }
          }
        }
      }
      let fraction = Double(changed) / Double(count)
      result[i].changedFraction = fraction
      result[i].panelChanged = fraction >= config.changedFraction
      let image = try imageFromFrame(result[i], directory: directory)
      let field = try recognize(image, rect: config.fieldRect)
      let row = try recognize(image, rect: config.resultRect)
      result[i].fieldText = field.0; result[i].resultText = row.0; result[i].resultConfidence = row.1
    } else if let previous = result[i].persistedFrom, previous < i {
      result[i].panelChanged = result[previous].panelChanged
      result[i].changedFraction = result[previous].changedFraction
      result[i].fieldText = result[previous].fieldText
      result[i].resultText = result[previous].resultText
      result[i].resultConfidence = result[previous].resultConfidence
    }
    }
  }
  // Private inspection crops: baseline and every changed/result boundary can be
  // reproduced from the hashed raw files. These are never published automatically.
  let candidates = Set([baseline.index, result.last(where: { $0.file != nil })?.index ?? baseline.index,
                        result.first(where: { $0.panelChanged == true && $0.file != nil })?.index ?? baseline.index])
  for index in candidates {
    let image = try imageFromFrame(result[index], directory: directory)
    try writePNG(image, directory.appendingPathComponent("inspect-\(index).png"))
  }
  return result
}

func sessionManifest(_ directory: URL) throws {
  let display = CGMainDisplayID()
  let mode = CGDisplayCopyDisplayMode(display)
  let versions = ["spotlight", "raycast"].reduce(into: [String: String]()) { versions, name in
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: launcherBundle(name)),
       let bundle = Bundle(url: url) {
      versions[name] = "\(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "unknown") (\(bundle.object(forInfoDictionaryKey: "CFBundleVersion") ?? "unknown"))"
    } else { versions[name] = "not installed" }
  }
  let sources = TISCreateInputSourceList(nil, false).takeRetainedValue() as NSArray
  let sourceIDs = sources.compactMap { source -> String? in
    let source = source as! TISInputSource
    guard let ptr = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { return nil }
    return Unmanaged<CFString>.fromOpaque(ptr).takeUnretainedValue() as String
  }
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  var processInventory: [String: Any] = [:]
  for launcher in ["spotlight", "raycast"] {
    do {
      let sample = try sampleRSS(launcher, requested: mach_absolute_time())
      processInventory[launcher] = try JSONSerialization.jsonObject(with: JSONEncoder.probe.encode(sample))
    } catch { processInventory[launcher] = ["unavailable": String(describing: error)] }
  }
  let manifest: [String: Any] = [
    "desktop_locked": desktopLocked(),
    "spotlight_owns_command_space": spotlightOwnsCommandSpace(),
    "classification": "personal-login-pilot", "created_at": ISO8601DateFormatter().string(from: Date()),
    "macos": try commandOutput("/usr/bin/sw_vers", []),
    "hardware": try commandOutput("/usr/sbin/sysctl", ["-n", "hw.model", "hw.memsize", "machdep.cpu.brand_string"]),
    "power": try commandOutput("/usr/bin/pmset", ["-g", "custom"]),
    "load": try commandOutput("/usr/bin/uptime", []),
    "display": ["id": display, "bounds": NSStringFromRect(CGDisplayBounds(display)),
                "pixel_width": mode?.pixelWidth ?? 0, "pixel_height": mode?.pixelHeight ?? 0,
                "point_width": mode?.width ?? 0, "point_height": mode?.height ?? 0,
                "refresh_hz": mode?.refreshRate ?? 0],
    "launcher_versions": versions, "active_input_source": inputSourceID(), "input_sources": sourceIDs,
    "neutral_front_app": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown",
    "reduce_motion": NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
    "symbolic_hotkeys": (try? commandOutput("/usr/bin/defaults", ["read", "com.apple.symbolichotkeys", "AppleSymbolicHotKeys"])) ?? "unavailable",
    "clock": ["numerator": hostClock().numerator, "denominator": hostClock().denominator, "unit": "mach_absolute_time"],
    "windows": windows.map { window in
      window.filter { [kCGWindowOwnerPID as String, kCGWindowOwnerName as String, kCGWindowBounds as String,
                       kCGWindowLayer as String, kCGWindowNumber as String].contains($0.key) }
    },
    "setup_process_inventory_not_trial_memory": processInventory,
    "process_attribution": "bundle executable paths plus descendants, rediscovered per sample; shared indexing services separate",
    "owner_remaining": ["synthetic account", "alternating complete schedule", "fresh-login cold runs", "240 fps physical-key video"]
  ]
  try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    .write(to: directory.appendingPathComponent("manifest.json"))
  try FileManager.default.copyItem(at: supportDirectory().appendingPathComponent("build.json"),
                                  to: directory.appendingPathComponent("build.json"))
  try saveJSON(currentStatus("manifest"), directory.appendingPathComponent("status.json"))
}

func screenshot(_ directory: URL) async throws {
  try checkDesktop()
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
    throw ProbeError.message("main display unavailable")
  }
  let filter = SCContentFilter(display: display, excludingWindows: [])
  let config = SCStreamConfiguration()
  config.width = CGDisplayPixelsWide(display.displayID); config.height = CGDisplayPixelsHigh(display.displayID)
  config.showsCursor = false
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  try writePNG(image, directory.appendingPathComponent("private-screen.png"))
}

func preparePilot(_ launcher: String) async throws {
  guard launcher == "spotlight" else {
    throw ProbeError.message("prepare supports current Spotlight cmd-space only; configure Raycast through supported settings UI")
  }
  let dir = try privateAttempt("prepare-\(launcher)")
  print("Private setup evidence: \(dir.path)")
  try sessionManifest(dir)
  let watch = InputWatch()
  do {
    try watch.start()
    defer { watch.stop() }
    try checkDesktop()
    guard spotlightOwnsCommandSpace() else { throw ProbeError.message("Spotlight does not own cmd-space") }
    let idle = try hidIdleSeconds()
    guard idle >= 300 else { throw ProbeError.message("HIDIdleTime < 300 seconds; no key posted") }
    let neutral = NSWorkspace.shared.frontmostApplication
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: launcherBundle(launcher)).first,
          !hasLauncherWindow(app.processIdentifier) else { throw ProbeError.message("launcher missing or already open") }
    defer {
      if watch.fault == nil, !desktopLocked(), hasLauncherWindow(app.processIdentifier),
         focusedField(app.processIdentifier) != nil {
        _ = try? postKey(53, down: true, pid: app.processIdentifier)
        _ = try? postKey(53, down: false, pid: app.processIdentifier)
        neutral?.activate(options: [])
      }
    }
    try watch.check()
    try checkDesktop()
    _ = try postKey(49, down: true, flags: .maskCommand)
    _ = try postKey(49, down: false)
    try await Task.sleep(nanoseconds: 800_000_000)
    try watch.check()
    try await screenshot(dir)
    let field = focusedField(app.processIdentifier) ?? [:]
    try saveJSON(field, dir.appendingPathComponent("focused-field.json"))
    try watch.check()
    try saveJSON(["idle_seconds": String(idle), "shortcut": "cmd-space; unchanged ownership",
                  "focused_field": field["role"] ?? "unavailable"], dir.appendingPathComponent("setup.json"))
  } catch {
    try saveJSON(["fault": String(describing: error)], dir.appendingPathComponent("failure.json"))
    throw error
  }
}

func runPilot(_ configURL: URL) async throws {
  let configData = try Data(contentsOf: configURL)
  let config = try JSONDecoder.probe.decode(PilotConfig.self, from: configData)
  try config.validate()
  let dir = try privateAttempt("\(config.launcher)-\(config.layout)-\(config.gapMs)ms")
  print("Private trial evidence: \(dir.path)")
  try configData.write(to: dir.appendingPathComponent("config.json"))
  try sessionManifest(dir)
  var trial = TrialRecord(id: dir.lastPathComponent, launcher: config.launcher, layout: config.layout,
                          gapMS: config.gapMs, clock: hostClock())
  trial.expectedResult = config.expectedResult
  trial.expectedField = config.layout == "abc" ? "safari" : "사파리"
  let watch = InputWatch(), writer = FrameWriter(dir)
  var stream: SCStream?
  var neutral: NSRunningApplication?
  var target: NSRunningApplication?
  do {
    try watch.start()
    try checkDesktop()
    guard spotlightOwnsCommandSpace() == (config.launcher == "spotlight") else {
      throw ProbeError.message("system_shortcut_ownership_mismatch")
    }
    let idle = try hidIdleSeconds()
    trial.setup["hid_idle_seconds"] = String(idle)
    guard idle >= 300 else { throw ProbeError.message("HIDIdleTime < 300 seconds; no keys posted") }
    guard inputSourceID() == config.inputSourceId else { throw ProbeError.message("input_source_mismatch") }
    neutral = NSWorkspace.shared.frontmostApplication
    guard neutral?.bundleIdentifier == config.neutralBundleId else { throw ProbeError.message("neutral_front_app_mismatch") }
    target = NSRunningApplication.runningApplications(withBundleIdentifier: launcherBundle(config.launcher)).first
    guard let target, !hasLauncherWindow(target.processIdentifier) else { throw ProbeError.message("launcher missing or already open") }
    trial.setup["neutral_bundle_id"] = config.neutralBundleId
    trial.setup["input_source_id"] = inputSourceID()
    trial.setup["shortcut"] = "cmd-space"
    trial.setup["shortcut_ownership"] = config.shortcutOwnership
    trial.setup["letter_delivery"] = "postToPid; focused launcher search field checked before each letter; no readiness polling"
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
      throw ProbeError.message("main display unavailable")
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let sc = SCStreamConfiguration()
    let scale = Double(CGDisplayPixelsWide(display.displayID)) / Double(display.width)
    sc.sourceRect = cgRect(config.sourceRect)
    guard CGRect(origin: .zero, size: CGSize(width: display.width, height: display.height)).contains(sc.sourceRect)
    else { throw ProbeError.message("source rectangle outside main display") }
    sc.width = Int(config.sourceRect[2] * scale); sc.height = Int(config.sourceRect[3] * scale)
    guard [config.panelRect, config.fieldRect, config.resultRect].allSatisfy({
      CGRect(x: 0, y: 0, width: sc.width, height: sc.height).contains(cgRect($0))
    }) else { throw ProbeError.message("ROI outside capture pixels") }
    guard sc.width * sc.height <= 4_000_000 else { throw ProbeError.message("capture pixel budget exceeded") }
    let free = try FileManager.default.attributesOfFileSystem(forPath: dir.path)[.systemFreeSize] as? NSNumber
    let estimatedBytes = Double(sc.width * sc.height * 4) * config.refreshHz * 6
    guard let free, free.doubleValue > estimatedBytes * 1.5 else {
      throw ProbeError.message("insufficient disk space for bounded raw capture")
    }
    sc.minimumFrameInterval = .zero; sc.queueDepth = 6
    sc.showsCursor = false; sc.pixelFormat = kCVPixelFormatType_32BGRA
    trial.capture = CaptureSettings(refreshHz: config.refreshHz, sourceRect: config.sourceRect,
                                     pixelWidth: sc.width, pixelHeight: sc.height)
    try FileManager.default.createDirectory(at: dir.appendingPathComponent("frames"), withIntermediateDirectories: false)
    let capture = SCStream(filter: filter, configuration: sc, delegate: writer)
    try capture.addStreamOutput(writer, type: .screen, sampleHandlerQueue: writer.queue)
    stream = capture
    try await capture.startCapture()
    // Closed-panel baseline only; never wait for panel readiness after shortcut.
    try await Task.sleep(nanoseconds: 250_000_000)
    try watch.check()
    try checkDesktop()
    guard writer.frames.contains(where: { $0.file != nil }) else { throw ProbeError.message("no_closed_panel_baseline") }
    trial.keys.append(try postKey(49, down: true, flags: .maskCommand))
    trial.keys.append(try postKey(49, down: false))
    let letters: [UInt16] = config.layout == "abc" ? [1, 0, 3, 0, 15, 34] : [17, 40, 9, 40, 3, 37]
    var lastDown: UInt64?
    for code in letters {
      if let previous = lastDown, config.gapMs > 0 {
        let elapsed = trial.clock.nanoseconds(mach_absolute_time() - previous)
        let requested = UInt64(config.gapMs) * 1_000_000
        if elapsed < requested { try await Task.sleep(nanoseconds: requested - elapsed) }
      }
      try watch.check()
      try checkDesktop()
      guard hasLauncherWindow(target.processIdentifier), let field = focusedField(target.processIdentifier),
            inputSourceID() == config.inputSourceId else { throw ProbeError.message("focus_or_input_source_mismatch") }
      let displayOrigin = CGDisplayBounds(display.displayID).origin
      let expectedField = CGRect(x: config.sourceRect[0] + displayOrigin.x + config.fieldRect[0] / scale,
                                 y: config.sourceRect[1] + displayOrigin.y + config.fieldRect[1] / scale,
                                 width: config.fieldRect[2] / scale, height: config.fieldRect[3] / scale)
      guard let x = Double(field["x"] ?? ""), let y = Double(field["y"] ?? ""),
            let width = Double(field["width"] ?? ""), let height = Double(field["height"] ?? ""),
            expectedField.insetBy(dx: -4, dy: -4).contains(CGRect(x: x, y: y, width: width, height: height))
      else { throw ProbeError.message("focused_field_outside_frozen_query_region") }
      if lastDown == nil {
        trial.setup["initial_field"] = field["value"] ?? ""
        guard field["value"] == "" else { throw ProbeError.message("query_not_blank") }
      }
      let down = try postKey(code, down: true, pid: target.processIdentifier)
      trial.keys.append(down); lastDown = down.before
      trial.keys.append(try postKey(code, down: false, pid: target.processIdentifier))
    }
    guard let lastDown else { throw ProbeError.message("no_letter_keys") }
    let second = UInt64(1_000_000_000) * UInt64(trial.clock.denominator) / UInt64(trial.clock.numerator)
    trial.deadlineTicks = lastDown + 5 * second
    let sampleAt = lastDown + second
    while mach_absolute_time() < sampleAt {
      try watch.check(); try await Task.sleep(nanoseconds: 5_000_000)
    }
    do { trial.rss = try sampleRSS(config.launcher, requested: sampleAt) }
    catch { trial.setup["rss_error"] = String(describing: error) }
    while mach_absolute_time() < trial.deadlineTicks! {
      try watch.check(); try await Task.sleep(nanoseconds: 5_000_000)
    }
    trial.endTicks = mach_absolute_time()
    trial.setup["final_ax_field"] = focusedField(target.processIdentifier)?["value"] ?? "unavailable"
  } catch { trial.faults.append(String(describing: error)) }
  if let stream {
    do { try await stream.stopCapture() } catch { trial.faults.append("stop_capture: \(error)") }
  }
  writer.flush()
  if let fault = watch.fault { trial.faults.append(fault) }
  // Do not interfere with the person's foreground after any physical input.
  if watch.fault == nil, !desktopLocked(), let target, hasLauncherWindow(target.processIdentifier),
     focusedField(target.processIdentifier) != nil {
    do {
      try watch.check()
      _ = try postKey(0, down: true, flags: .maskCommand, pid: target.processIdentifier)
      _ = try postKey(0, down: false, pid: target.processIdentifier)
      try watch.check()
      _ = try postKey(51, down: true, pid: target.processIdentifier)
      _ = try postKey(51, down: false, pid: target.processIdentifier)
      try watch.check()
      _ = try postKey(53, down: true, pid: target.processIdentifier)
      _ = try postKey(53, down: false, pid: target.processIdentifier)
      neutral?.activate(options: [])
      trial.setup["cleanup"] = "select-all/delete/escape targeted to launcher; neutral reactivated"
    } catch { trial.faults.append("cleanup: \(error)") }
  }
  if let fault = watch.fault { trial.faults.append(fault) }
  watch.stop()
  trial.frames = writer.frames; trial.faults += writer.faults
  trial.faults = Array(Set(trial.faults)).sorted()
  trial.setup["capture_completed_ticks"] = String(mach_absolute_time())
  trial.setup["setup_and_cooldown"] = "250 ms closed baseline; 5 s observation after last key; cleanup after stream stop"
  let intervals = zip(trial.frames, trial.frames.dropFirst()).compactMap { first, second -> Double? in
    guard let a = first.displayTicks, let b = second.displayTicks, b > a else { return nil }
    return trial.clock.milliseconds(from: a, to: b)
  }
  trial.cadence = ["delivered_frames": String(trial.frames.count),
                   "min_interval_ms": intervals.min().map { String($0) } ?? "unknown",
                   "max_interval_ms": intervals.max().map { String($0) } ?? "unknown",
                   "gap_count_over_1_5_refresh_intervals": String(intervals.filter { $0 > 1500 / config.refreshHz }.count),
                   "dropped_frames": "not exposed by ScreenCaptureKit; gaps and queue overflow retained separately"]
  let down = trial.keys.filter(\.down)
  if down.count > 1 {
    trial.hotkeyToFirstKeyMs = trial.clock.milliseconds(from: down[0].before, to: down[1].before)
    trial.actualKeyGapsMs = zip(down.dropFirst(), down.dropFirst(2)).map {
      trial.clock.milliseconds(from: $0.before, to: $1.before)
    }
  }
  // Durable raw record first: OCR failure or interruption must not erase a trial.
  try saveJSON(trial, dir.appendingPathComponent("trial.json"))
  for i in trial.frames.indices {
    if let file = trial.frames[i].file {
      do {
        let data = try Data(contentsOf: dir.appendingPathComponent(file), options: .mappedIfSafe)
        trial.frames[i].sha256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      } catch { trial.faults.append("hash_error: \(error)") }
    }
  }
  try saveJSON(trial, dir.appendingPathComponent("trial.json"))
  do {
    trial.frames = try annotateFrames(trial.frames, directory: dir, config: config)
    trial.recognition = ["engine": "Vision accurate", "languages": "en-US,ko-KR",
                         "language_correction": "false", "timing": "after stream stopped; from stored pixels"]
  } catch { trial.faults.append("recognition: \(error)") }
  try saveJSON(trial, dir.appendingPathComponent("trial.json"))
  print("Frames: \(trial.frames.count); key events: \(trial.keys.count); RSS complete: \(trial.rss?.complete ?? false); faults: \(trial.faults)")
  if !trial.faults.isEmpty { throw ProbeError.message("failed attempt retained at \(dir.path)") }
}
