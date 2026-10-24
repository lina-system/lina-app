// SPDX-License-Identifier: Apache-2.0
import AppKit
import CoreImage
import ScreenCaptureKit

/// Captures only this process's panel using the documented no-consent API.
/// Native shortcut events start trials; WindowServer display timestamps end them.
@available(macOS 14.4, *)
public final class VisibleCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let host: PanelHost
    private let sequenceChanged: (Int) -> Void
    private var stream: SCStream?
    private var trial: VisibleLatencyTrial?
    private var inputSource = "none"
    private var samples: [[String: Any]] = []
    private var trace: [[String: Any]] = []
    private var sequence = 0
    private var armed = false
    private var finished = false
    private let targetCount = 10
    private var timebase = mach_timebase_info_data_t()
    private let imageContext = CIContext()
    private var timeout: Timer?

    public init(host: PanelHost, sequenceChanged: @escaping (Int) -> Void) {
        self.host = host
        self.sequenceChanged = sequenceChanged
        super.init()
        mach_timebase_info(&timebase)
    }

    private func emit(_ prefix: String, _ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        print(prefix + " " + line)
        fflush(stdout)
    }

    public func start() {
        // Warm-up is explicitly excluded. It registers the window with the
        // compositor and verifies capture/marker detection before accepting keys.
        sequenceChanged(0)
        host.show()
        timeout = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { [weak self] _ in
            self?.cancel("Timed out waiting for ten shortcut/visible-frame pairs")
        }
        SCShareableContent.getCurrentProcessShareableContent { [weak self] content, error in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                guard error == nil,
                      let window = content?.windows.first(where: {
                          $0.windowID == CGWindowID(self.host.panel.windowNumber) &&
                          $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier
                      }) else {
                    self.cancel("Own panel unavailable to current-process capture: \(error?.localizedDescription ?? "no matching window")")
                    return
                }
                let filter = SCContentFilter(desktopIndependentWindow: window)
                let config = SCStreamConfiguration()
                config.width = Int(window.frame.width)
                config.height = Int(window.frame.height)
                config.scalesToFit = true
                config.showsCursor = false
                config.capturesAudio = false
                config.minimumFrameInterval = .zero // native display cadence
                config.queueDepth = 3
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.colorSpaceName = CGColorSpace.sRGB
                config.ignoreShadowsSingleWindow = true
                config.includeChildWindows = false
                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                self.stream = stream
                do {
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
                    stream.startCapture { [weak self] error in
                        if let error { DispatchQueue.main.async { self?.cancel(error.localizedDescription) } }
                    }
                } catch { self.cancel(error.localizedDescription) }
            }
        }
    }

    public func shortcut(eventTime: TimeInterval, source: String) {
        emit("LINA_VISIBLE_DISPATCH", ["armed": armed, "finished": finished, "visible": host.panel.isVisible])
        guard armed, !finished, !host.panel.isVisible else { return }
        guard ["carbon-global-hotkey", "appkit-local-keyDown"].contains(source) else { return }
        inputSource = source
        do { trial = try VisibleLatencyTrial(shortcutTime: eventTime) }
        catch { cancel("Invalid Carbon event timestamp"); return }
        armed = false
        sequence += 1
        sequenceChanged(sequence)
        emit("LINA_VISIBLE_SHORTCUT", ["trial": sequence, "nativeEventTime": eventTime, "inputSource": source])
        host.show(startedAt: eventTime)
    }

    private func onScreen() -> Bool {
        guard host.panel.isVisible, host.panel.occlusionState.contains(.visible),
              let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(host.panel.windowNumber)) as? [[String: Any]],
              let own = info.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == host.panel.windowNumber })
        else { return false }
        return (own[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
    }

    private func marker(_ buffer: CVPixelBuffer) -> Bool {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return false }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        guard width >= 120, height >= 48, stride >= width * 4,
              CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA else { return false }
        // The benchmark-only Flutter marker is a 96x16 strip 24 points from
        // the lower/left edges. Capture is one pixel per window point; the
        // titled panel's actual outer height can include its titlebar.
        let colors: [(UInt8, UInt8, UInt8)] = (0..<4).map { index in
            let x = Int(Double(36 + index * 24) * Double(width) / 680)
            let y = height - 32
            let pixel = base.advanced(by: y * stride + x * 4).assumingMemoryBound(to: UInt8.self)
            return (pixel[2], pixel[1], pixel[0]) // BGRA → RGB
        }
        return VisibleFrameMarker.matches(colors, sequence: sequence)
    }

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !finished, type == .screen,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let info = attachments.first,
              let status = (info[.status] as? NSNumber)?.intValue else { return }
        let received = ProcessInfo.processInfo.systemUptime
        let displayedTicks = (info[.displayTime] as? NSNumber)?.uint64Value ?? 0
        let displayed = Double(displayedTicks) * Double(timebase.numer) / Double(timebase.denom) / 1_000_000_000
        let complete = status == SCFrameStatus.complete.rawValue || status == SCFrameStatus.started.rawValue
        let visible = onScreen()
        let buffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        let matched = buffer.map(marker) ?? false
        if sequence == 0, complete, visible, matched {
            sequence = -1 // warm-up completed; actual trials begin at 1
            hideAndArm()
            return
        }
        guard var pending = trial else { return }
        let entry: [String: Any] = ["trial": samples.count + 1, "status": status,
            "displayTimeTicks": displayedTicks, "displayTimeSeconds": displayed,
            "receivedTimeSeconds": received, "windowOnScreen": visible, "markerMatches": matched]
        trace.append(entry)
        guard let result = pending.observe(frameTime: displayed, receivedTime: received, onScreen: visible,
                                           complete: complete, markerMatches: matched), let buffer else {
            trial = pending
            return
        }
        trial = nil
        let ciImage = CIImage(cvPixelBuffer: buffer)
        guard let cgImage = imageContext.createCGImage(ciImage, from: ciImage.extent),
              let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
            cancel("Could not preserve the accepted compositor frame"); return
        }
        let sample: [String: Any] = ["trial": samples.count + 1,
            "inputSource": inputSource, "appWasActive": NSApp.isActive,
            "shortcutEventTimeSeconds": pending.shortcutTime,
            "windowServerDisplayTimeSeconds": displayed, "captureReceivedTimeSeconds": received,
            "shortcutToVisibleMs": result.frameLatencyMs, "observationUpperBoundMs": result.observationUpperBoundMs,
            "windowOnScreen": visible, "markerMatches": matched, "panelBecameKey": host.panel.isKeyWindow,
            "originalAppStayedActive": host.originalAppStayedActive == true,
            "originalAppWasExternal": host.originalAppWasExternal == true,
            "externalAppStillFrontmostAtFrame": NSWorkspace.shared.frontmostApplication?.processIdentifier != ProcessInfo.processInfo.processIdentifier,
            "framePngBase64": png.base64EncodedString()]
        samples.append(sample)
        emit("LINA_VISIBLE_SAMPLE", ["trial": samples.count, "shortcutToVisibleMs": result.frameLatencyMs])
        if samples.count == targetCount { finish() } else { hideAndArm() }
    }

    private func hideAndArm() {
        host.hide()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self, !self.finished else { return }
            if self.sequence < 0 { self.sequence = 0 }
            self.armed = true
            self.emit("LINA_VISIBLE_READY", ["nextTrial": self.samples.count + 1, "targetCount": self.targetCount])
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        timeout?.invalidate()
        host.hide()
        let result: [String: Any] = ["kind": "native-shortcut-to-windowserver-visible-frame",
            "status": "measured", "warmupExcluded": true, "samples": samples, "frameTrace": trace,
            "captureAPI": "SCShareableContent.currentProcess + own-window SCStream",
            "endpoint": "SCStreamFrameInfo.displayTime with matching Flutter pixels and on-screen window",
            "timebaseNumer": timebase.numer, "timebaseDenom": timebase.denom,
            "requestedPermissions": false, "capturedOtherApplications": false,
            "os": ProcessInfo.processInfo.operatingSystemVersionString]
        stream?.stopCapture { [weak self] _ in
            DispatchQueue.main.async {
                self?.emit("LINA_VISIBLE_METRICS", result)
                NSApp.terminate(nil)
            }
        }
    }

    public func cancel(_ reason: String) {
        guard !finished else { return }
        finished = true
        timeout?.invalidate()
        host.hide()
        emit("LINA_VISIBLE_ERROR", ["status": "unverified", "reason": reason, "completedTrials": samples.count])
        stream?.stopCapture { _ in }
        NSApp.terminate(nil)
    }
    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in self?.cancel(error.localizedDescription) }
    }
}
