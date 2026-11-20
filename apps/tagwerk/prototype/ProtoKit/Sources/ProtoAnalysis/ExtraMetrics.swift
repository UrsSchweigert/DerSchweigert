import Foundation
import ProtoKit

struct Stamped {
    var t: Double
    var role: DeviceRole
    var event: LogEvent
}

struct PairingStats: Equatable {
    var attempts = 0, successes = 0
    var medianMs: Double?
}

/// The metrics beyond the ping share and gaps. Every value is nil (reported "not measured") when the log lacks
/// the data it needs: no marker, no sample or no matching event on the other device.
struct ExtraMetrics {
    var orientationReads = 0
    var orientationShare: Double?
    var rssiByMarker: [String: (mean: Double, count: Int)] = [:]
    var rssiCut: Double?, rssiErrorRate: Double?
    /// Longest wait from the moment the link could return to the next received ping, per kind (minutes).
    var reconnectMinutes: [String: Double] = [:]
    var idleSamples = 0
    var idleAgreeShare: Double?
    var checkinsShown = 0
    var checkinCompleteShare: Double?, checkinLatencyMaxS: Double?
    var batteryDropPerHour: Double?
    var sensorPromptSeen: Bool?
    var pairing: [String: PairingStats] = [:]

    var reconnectMax: Double? { reconnectMinutes.values.max() }

    var values: [String: Double] {
        var v: [String: Double] = [:]
        v["orientation_read_share"] = orientationShare
        v["rssi_error_rate"] = rssiErrorRate
        v["reconnect_minutes_max"] = reconnectMax
        v["idle_agree_share"] = idleAgreeShare
        v["checkin_complete_share"] = checkinCompleteShare
        v["checkin_latency_s_max"] = checkinLatencyMaxS
        v["battery_drop_per_hour"] = batteryDropPerHour
        return v
    }
}

/// Idle seconds may lag the `away` marker by this much: the owner taps it by hand, often after the last keystroke.
private let idleSlackS = 60.0
/// A distance marker names the RSSI samples within this long of it.
private let distanceWindowMs = 120_000.0

func computeExtra(_ events: [Stamped], nearIv: [Interval], awayIv: [Interval], hasNear: Bool) -> ExtraMetrics {
    var x = ExtraMetrics()
    let sorted = events.sorted { $0.t < $1.t }
    func markers(_ pred: (String) -> Bool) -> [(t: Double, label: String)] {
        sorted.compactMap { if case let .marker(l) = $0.event, pred(l) { return ($0.t, l) } else { return nil } }
    }
    let received = sorted.filter { if case .pingReceived = $0.event { return true } else { return false } }

    // Orientation: a read counts when it returned a value and agrees with the nearest face marker.
    let faces = markers { $0 == MarkerLabel.faceUp || $0 == MarkerLabel.faceDown }
    var good = 0
    if !faces.isEmpty {
        for s in sorted {
            guard case let .orientation(_, _, _, cls, _, error) = s.event else { continue }
            x.orientationReads += 1
            let nearest = faces.min { abs($0.t - s.t) < abs($1.t - s.t) }!
            let want: OrientationClass = nearest.label == MarkerLabel.faceUp ? .faceUp : .faceDown
            if error == nil && cls == want { good += 1 }
        }
        if x.orientationReads > 0 { x.orientationShare = Double(good) / Double(x.orientationReads) }
    }

    // RSSI per distance marker, and the cut that best separates near-interval pings from the rest.
    let distances = markers { $0.hasPrefix(MarkerLabel.distancePrefix) }
    var byMarker: [String: [Double]] = [:], desk: [Double] = [], away: [Double] = []
    for s in received {
        guard case let .pingReceived(_, _, _, _, rssi?, _) = s.event else { continue }
        let r = Double(rssi)
        if let d = distances.min(by: { abs($0.t - s.t) < abs($1.t - s.t) }), abs(d.t - s.t) <= distanceWindowMs {
            byMarker[d.label, default: []].append(r)
        }
        if hasNear { if inside(s.t, nearIv) { desk.append(r) } else { away.append(r) } }
    }
    x.rssiByMarker = byMarker.mapValues { ($0.reduce(0, +) / Double($0.count), $0.count) }
    if !desk.isEmpty && !away.isEmpty {
        // A ping at or above the cut is classed at-desk. Try the midpoints between neighbouring distinct values.
        let all = Set(desk + away).sorted()
        var best: (cut: Double, errors: Int)?
        for cut in all.isEmpty ? [] : [all[0] - 1] + zip(all, all.dropFirst()).map { ($0 + $1) / 2 } + [all.last! + 1] {
            let errors = desk.filter { $0 < cut }.count + away.filter { $0 >= cut }.count
            if best == nil || errors < best!.errors { best = (cut, errors) }
        }
        x.rssiCut = best?.cut
        x.rssiErrorRate = best.map { Double($0.errors) / Double(desk.count + away.count) }
    }

    // Reconnect: from the moment the link could come back to the next received ping; never is infinite.
    for (kind, starts) in reconnectStarts(sorted, nearIv: nearIv) {
        let waits = starts.map { e in received.first { $0.t >= e }.map { ($0.t - e) / 60_000 } ?? .infinity }
        if let worst = waits.max() { x.reconnectMinutes[kind] = worst }
    }

    // Idle seconds: after the owner taps `away` the computer is untouched, so idle_s must cover the time since.
    var agree = 0
    if hasNear {
        for s in sorted {
            guard case let .computerIdle(secs) = s.event, let iv = awayIv.first(where: { $0.start <= s.t && s.t <= $0.end }) else { continue }
            x.idleSamples += 1
            if secs >= (s.t - iv.start) / 1000 - idleSlackS { agree += 1 }
        }
    }
    if x.idleSamples > 0 { x.idleAgreeShare = Double(agree) / Double(x.idleSamples) }

    // Check-in: shown on both devices, answered on one, dismissed on the other. Latency is answer to dismissal.
    var byId: [String: [(t: Double, role: DeviceRole, kind: Character)]] = [:]
    for s in sorted {
        switch s.event {
        case let .checkinShown(id): byId[id, default: []].append((s.t, s.role, "s"))
        case let .checkinAnswered(id): byId[id, default: []].append((s.t, s.role, "a"))
        case let .checkinDismissed(id): byId[id, default: []].append((s.t, s.role, "d"))
        default: break
        }
    }
    var complete = 0, latencies: [Double] = []
    for (_, evs) in byId {
        let shownOn = Set(evs.filter { $0.kind == "s" }.map { $0.role })
        guard !shownOn.isEmpty else { continue }
        x.checkinsShown += 1
        let a = evs.filter { $0.kind == "a" }, d = evs.filter { $0.kind == "d" }
        if shownOn.count == 2, a.count == 1, d.count == 1, a[0].role != d[0].role {
            complete += 1; latencies.append(max(0, (d[0].t - a[0].t) / 1000))
        }
    }
    if x.checkinsShown > 0 {
        x.checkinCompleteShare = Double(complete) / Double(x.checkinsShown)
        x.checkinLatencyMaxS = latencies.max()
    }

    // Battery: percentage points lost per hour between the first and last reading that were not charging.
    let drain = sorted.compactMap { s -> (t: Double, level: Double)? in
        if s.role == .phone, case let .battery(level, false, _) = s.event { return (s.t, level) } else { return nil }
    }
    if let a = drain.first, let b = drain.last, b.t > a.t {
        x.batteryDropPerHour = max(0, a.level - b.level) * 100 / ((b.t - a.t) / 3_600_000)
    }

    for s in sorted {
        switch s.event {
        case let .sensorPermission(seen): x.sensorPromptSeen = seen
        case let .pairing(method, success, _):
            var p = x.pairing[method] ?? PairingStats()
            p.attempts += 1; if success { p.successes += 1 }
            x.pairing[method] = p
        default: break
        }
    }
    for method in x.pairing.keys {
        x.pairing[method]?.medianMs = median(sorted.compactMap {
            if case let .pairing(m, true, d?) = $0.event, m == method { return d } else { return nil }
        })
    }
    return x
}

/// A phone `launch` and `restore` this close together are one relaunch by Bluetooth state restoration.
private let restoreWindowMs = 10_000.0

/// When each interruption kind ended, from logged events only (the procedure names them):
/// - out_of_range: the `near` marker that closes an away stretch in which the phone logged a `disconnect`;
/// - bluetooth_off: a `bluetooth_state` back to powered on (`poweredOn` on the computer, raw `5` on the phone)
///   after any other state on the same device;
/// - computer_sleep: `computer_wake`;
/// - phone_restart: a phone `launch` with a `restore` beside it (iOS relaunched the app after the restart);
/// - app_removed: a later phone `launch` without `restore` (iOS does not relaunch a removed app; the owner did).
func reconnectStarts(_ sorted: [Stamped], nearIv: [Interval]) -> [String: [Double]] {
    var out: [String: [Double]] = [:]
    let phone = sorted.filter { $0.role == .phone }
    let disconnects = phone.compactMap { if case .disconnect = $0.event { return $0.t } else { return nil } }
    for (prev, iv) in zip(nearIv, nearIv.dropFirst()) where disconnects.contains(where: { prev.end <= $0 && $0 <= iv.start }) {
        out["out_of_range", default: []].append(iv.start)
    }
    var btOff: Set<String> = []
    let restores = phone.compactMap { if case .restore = $0.event { return $0.t } else { return nil } }
    var launches = 0
    for s in sorted {
        switch s.event {
        case let .bluetoothState(state):
            let on = state == (s.role == .computer ? "poweredOn" : "5")
            if !on { btOff.insert(s.role.rawValue) } else if btOff.remove(s.role.rawValue) != nil { out["bluetooth_off", default: []].append(s.t) }
        case .computerWake: out["computer_sleep", default: []].append(s.t)
        case .launch where s.role == .phone:
            launches += 1
            if restores.contains(where: { abs($0 - s.t) <= restoreWindowMs }) { out["phone_restart", default: []].append(s.t) }
            else if launches > 1 { out["app_removed", default: []].append(s.t) }
        default: break
        }
    }
    return out
}
