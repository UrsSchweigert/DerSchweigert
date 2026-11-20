import Foundation

public enum DeviceRole: String, Codable, Equatable {
    case computer
    case phone
}

public enum OrientationClass: String, Codable, Equatable {
    case faceUp = "face_up"
    case faceDown = "face_down"
    case neither
}

/// Everything either prototype app logs. One flat JSON object per line: the `event` key names the case and the
/// other keys carry its fields, so the analyser and the procedure can name each value by its JSON key.
public enum LogEvent: Equatable {
    case pingSent(seq: Int, senderMs: Int64)
    case pingReceived(seq: Int, senderMs: Int64, appState: String, restoredLaunch: Bool, rssi: Int?, backgroundRemainingS: Double?)
    case orientation(x: Double, y: Double, z: Double, cls: OrientationClass, readLatencyMs: Double?, error: String?)
    case connect
    case disconnect(reason: String?)
    case restore
    case launch
    case bluetoothState(state: String)
    case battery(level: Double, charging: Bool, lowPowerMode: Bool)
    case computerIdle(seconds: Double)
    case computerSleep
    case computerWake
    case checkinShown(id: String)
    case checkinAnswered(id: String)
    case checkinDismissed(id: String)
    case notificationScheduled(id: String)
    case notificationCancelled(id: String)
    case pairing(method: String, success: Bool, durationMs: Double)
    case sensorPermission(promptSeen: Bool)
    case marker(label: String)
    /// An event name this build does not know, kept so newer logs still load.
    case unknown(name: String)
}

extension LogEvent: Codable {
    enum Key: String, CodingKey {
        case event, seq
        case senderMs = "sender_ms", appState = "app_state", restoredLaunch = "restored_launch"
        case rssi, backgroundRemainingS = "background_remaining_s"
        case x, y, z, cls = "class", readLatencyMs = "read_latency_ms", error
        case reason, state, level, charging, lowPowerMode = "low_power_mode"
        case idleS = "idle_s", id, method, success, durationMs = "duration_ms"
        case promptSeen = "prompt_seen", label
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let name = try c.decode(String.self, forKey: .event)
        switch name {
        case "ping_sent":
            self = .pingSent(seq: try c.decode(Int.self, forKey: .seq), senderMs: try c.decode(Int64.self, forKey: .senderMs))
        case "ping_received":
            self = .pingReceived(
                seq: try c.decode(Int.self, forKey: .seq), senderMs: try c.decode(Int64.self, forKey: .senderMs),
                appState: try c.decode(String.self, forKey: .appState),
                restoredLaunch: try c.decode(Bool.self, forKey: .restoredLaunch),
                rssi: try c.decodeIfPresent(Int.self, forKey: .rssi),
                backgroundRemainingS: try c.decodeIfPresent(Double.self, forKey: .backgroundRemainingS))
        case "orientation":
            self = .orientation(
                x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                z: try c.decode(Double.self, forKey: .z), cls: try c.decode(OrientationClass.self, forKey: .cls),
                readLatencyMs: try c.decodeIfPresent(Double.self, forKey: .readLatencyMs),
                error: try c.decodeIfPresent(String.self, forKey: .error))
        case "connect": self = .connect
        case "disconnect": self = .disconnect(reason: try c.decodeIfPresent(String.self, forKey: .reason))
        case "restore": self = .restore
        case "launch": self = .launch
        case "bluetooth_state": self = .bluetoothState(state: try c.decode(String.self, forKey: .state))
        case "battery":
            self = .battery(
                level: try c.decode(Double.self, forKey: .level), charging: try c.decode(Bool.self, forKey: .charging),
                lowPowerMode: try c.decode(Bool.self, forKey: .lowPowerMode))
        case "computer_idle": self = .computerIdle(seconds: try c.decode(Double.self, forKey: .idleS))
        case "computer_sleep": self = .computerSleep
        case "computer_wake": self = .computerWake
        case "checkin_shown": self = .checkinShown(id: try c.decode(String.self, forKey: .id))
        case "checkin_answered": self = .checkinAnswered(id: try c.decode(String.self, forKey: .id))
        case "checkin_dismissed": self = .checkinDismissed(id: try c.decode(String.self, forKey: .id))
        case "notification_scheduled": self = .notificationScheduled(id: try c.decode(String.self, forKey: .id))
        case "notification_cancelled": self = .notificationCancelled(id: try c.decode(String.self, forKey: .id))
        case "pairing":
            self = .pairing(
                method: try c.decode(String.self, forKey: .method), success: try c.decode(Bool.self, forKey: .success),
                durationMs: try c.decode(Double.self, forKey: .durationMs))
        case "sensor_permission": self = .sensorPermission(promptSeen: try c.decode(Bool.self, forKey: .promptSeen))
        case "marker": self = .marker(label: try c.decode(String.self, forKey: .label))
        default: self = .unknown(name: name)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        switch self {
        case let .pingSent(seq, senderMs):
            try c.encode("ping_sent", forKey: .event); try c.encode(seq, forKey: .seq); try c.encode(senderMs, forKey: .senderMs)
        case let .pingReceived(seq, senderMs, appState, restored, rssi, bg):
            try c.encode("ping_received", forKey: .event); try c.encode(seq, forKey: .seq)
            try c.encode(senderMs, forKey: .senderMs); try c.encode(appState, forKey: .appState)
            try c.encode(restored, forKey: .restoredLaunch)
            try c.encodeIfPresent(rssi, forKey: .rssi); try c.encodeIfPresent(bg, forKey: .backgroundRemainingS)
        case let .orientation(x, y, z, cls, latency, error):
            try c.encode("orientation", forKey: .event)
            try c.encode(x, forKey: .x); try c.encode(y, forKey: .y); try c.encode(z, forKey: .z)
            try c.encode(cls, forKey: .cls)
            try c.encodeIfPresent(latency, forKey: .readLatencyMs); try c.encodeIfPresent(error, forKey: .error)
        case .connect: try c.encode("connect", forKey: .event)
        case let .disconnect(reason):
            try c.encode("disconnect", forKey: .event); try c.encodeIfPresent(reason, forKey: .reason)
        case .restore: try c.encode("restore", forKey: .event)
        case .launch: try c.encode("launch", forKey: .event)
        case let .bluetoothState(state):
            try c.encode("bluetooth_state", forKey: .event); try c.encode(state, forKey: .state)
        case let .battery(level, charging, low):
            try c.encode("battery", forKey: .event); try c.encode(level, forKey: .level)
            try c.encode(charging, forKey: .charging); try c.encode(low, forKey: .lowPowerMode)
        case let .computerIdle(seconds):
            try c.encode("computer_idle", forKey: .event); try c.encode(seconds, forKey: .idleS)
        case .computerSleep: try c.encode("computer_sleep", forKey: .event)
        case .computerWake: try c.encode("computer_wake", forKey: .event)
        case let .checkinShown(id): try c.encode("checkin_shown", forKey: .event); try c.encode(id, forKey: .id)
        case let .checkinAnswered(id): try c.encode("checkin_answered", forKey: .event); try c.encode(id, forKey: .id)
        case let .checkinDismissed(id): try c.encode("checkin_dismissed", forKey: .event); try c.encode(id, forKey: .id)
        case let .notificationScheduled(id):
            try c.encode("notification_scheduled", forKey: .event); try c.encode(id, forKey: .id)
        case let .notificationCancelled(id):
            try c.encode("notification_cancelled", forKey: .event); try c.encode(id, forKey: .id)
        case let .pairing(method, success, durationMs):
            try c.encode("pairing", forKey: .event); try c.encode(method, forKey: .method)
            try c.encode(success, forKey: .success); try c.encode(durationMs, forKey: .durationMs)
        case let .sensorPermission(seen):
            try c.encode("sensor_permission", forKey: .event); try c.encode(seen, forKey: .promptSeen)
        case let .marker(label): try c.encode("marker", forKey: .event); try c.encode(label, forKey: .label)
        case let .unknown(name): try c.encode(name, forKey: .event)
        }
    }
}
