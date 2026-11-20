import AppKit
import CoreGraphics
import ProtoKit

/// Logs sleep, wake and the idle seconds once a minute.
final class SystemWatcher {
    private var timer: Timer?

    init(log: ProtoLog) {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in log.log(.computerSleep) }
        center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in log.log(.computerWake) }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            let idle = min(CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown),
                           CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved))
            log.log(.computerIdle(seconds: idle))
        }
    }
}
