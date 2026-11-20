import Foundation
import ProtoKit

public enum AnalyseError: Error, Equatable, CustomStringConvertible {
    case unreadable(String)
    case emptyLog(String)
    case noPingPairs
    case badThresholds

    public var description: String {
        switch self {
        case .unreadable(let p): return "cannot read \(p)"
        case .emptyLog(let which): return "the \(which) log is missing or has no readable lines"
        case .noPingPairs: return "no ping_sent in the computer log matches a ping_received in the phone log by seq, so the clocks cannot be aligned"
        case .badThresholds: return "the thresholds file is not a JSON object of numbers"
        }
    }
}

public struct Metrics: Equatable {
    public var clockOffsetMs: Double
    public var sent = 0, received = 0
    public var shareByState: [String: (received: Int, sent: Int)] = [:]
    public var nearAwakeShare: Double?
    public var gapMedianMin: Double?, gapP95Min: Double?, gapLongestMin: Double?
    /// Longest gap that overlaps no away, interruption or sleep interval; nil when no near/away marker exists.
    public var ordinaryLongestMin: Double?
    public var lostMinutes: [Int: Double] = [:]
    var extra = ExtraMetrics()

    public static func == (a: Metrics, b: Metrics) -> Bool { a.values == b.values && a.shareByState.mapValues { [$0.received, $0.sent] } == b.shareByState.mapValues { [$0.received, $0.sent] } }

    /// Numbers a threshold key can name (`min_ping_share_near_awake`, `max_lost_minutes_grace_5`, ...).
    public var values: [String: Double] {
        var v: [String: Double] = [:]
        v["ping_share_near_awake"] = nearAwakeShare
        v["ordinary_gap_minutes"] = ordinaryLongestMin
        for (g, m) in lostMinutes where ordinaryLongestMin != nil { v["lost_minutes_grace_\(g)"] = m }
        return v.merging(extra.values) { a, _ in a }
    }
}

func median(_ s: [Double]) -> Double? {
    guard !s.isEmpty else { return nil }
    let a = s.sorted(), n = a.count
    return n % 2 == 1 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2
}

/// Nearest-rank percentile: the smallest value with at least p of the data at or below it.
func percentile(_ s: [Double], _ p: Double) -> Double? {
    guard !s.isEmpty else { return nil }
    let a = s.sorted()
    return a[max(0, Int((p * Double(a.count)).rounded(.up)) - 1)]
}

typealias Interval = (start: Double, end: Double)

/// Phone-clock offset: median over seq-matched pairs of (phone receive time - computer send time). It contains
/// the link latency, a fraction of a second, which is far below the minute scale of every metric.
func clockOffsetMs(phone: [LogLine], computer: [LogLine]) throws -> Double {
    var sentAt: [Int: Int64] = [:]
    for l in computer { if case let .pingSent(seq, _, _, _) = l.event, sentAt[seq] == nil { sentAt[seq] = l.wallMs } }
    var diffs: [Double] = []
    for l in phone { if case let .pingReceived(seq, _, _, _, _, _) = l.event, let s = sentAt[seq] { diffs.append(Double(l.wallMs - s)) } }
    guard let m = median(diffs) else { throw AnalyseError.noPingPairs }
    return m
}

/// Pairs `open` and `close` events into intervals; an open one runs to `dayEnd`.
func intervals(_ events: [(t: Double, open: Bool)], dayEnd: Double) -> [Interval] {
    var out: [Interval] = [], start: Double?
    for e in events.sorted(by: { $0.t < $1.t }) {
        if e.open { start = start ?? e.t } else if let s = start { out.append((s, e.t)); start = nil }
    }
    if let s = start { out.append((s, dayEnd)) }
    return out
}

func compute(phone: [LogLine], computer: [LogLine]) throws -> Metrics {
    let offset = try clockOffsetMs(phone: phone, computer: computer)
    // Everything on the phone clock, in milliseconds.
    let shifted = computer.map { ($0.event, Double($0.wallMs) + offset) } + phone.map { ($0.event, Double($0.wallMs)) }
    var m = Metrics(clockOffsetMs: offset)
    let stamped = computer.map { Stamped(t: Double($0.wallMs) + offset, role: .computer, event: $0.event) }
        + phone.map { Stamped(t: Double($0.wallMs), role: .phone, event: $0.event) }
    var sends: [(seq: Int, t: Double)] = [], recv: [(seq: Int, t: Double, state: String)] = []
    var near: [(t: Double, open: Bool)] = [], asleep: [(t: Double, open: Bool)] = [], interrupted: [(t: Double, open: Bool)] = []
    for (event, t) in shifted {
        switch event {
        case let .pingSent(seq, _, _, _): sends.append((seq, t))
        case let .pingReceived(seq, _, state, _, _, _): recv.append((seq, t, state))
        case .computerSleep: asleep.append((t, true))
        case .computerWake: asleep.append((t, false))
        case .marker(MarkerLabel.near): near.append((t, true))
        case .marker(MarkerLabel.away): near.append((t, false))
        case let .marker(label) where MarkerLabel.interruptionKinds.contains { label == $0 + MarkerLabel.start }: interrupted.append((t, true))
        case let .marker(label) where MarkerLabel.interruptionKinds.contains { label == $0 + MarkerLabel.end }: interrupted.append((t, false))
        default: break
        }
    }
    recv.sort { $0.t < $1.t }; sends.sort { $0.t < $1.t }
    let dayEnd = max(recv.last?.t ?? 0, sends.last?.t ?? 0)
    let nearIv = intervals(near, dayEnd: dayEnd), sleepIv = intervals(asleep, dayEnd: dayEnd)
    let excluded = sleepIv + intervals(interrupted, dayEnd: dayEnd)
        + complement(nearIv, from: near.map { $0.t }.min() ?? 0, to: dayEnd)
    let receivedSeqs = Set(recv.map { $0.seq })
    m.sent = sends.count; m.received = sends.filter { receivedSeqs.contains($0.seq) }.count
    // A lost ping has no app_state of its own: it takes the state of the latest received ping before it.
    let stateAt = recv.map { ($0.t, $0.state) }
    for s in sends {
        let state = stateAt.last { $0.0 <= s.t }?.1 ?? "unknown"
        var c = m.shareByState[state] ?? (0, 0)
        c.sent += 1; if receivedSeqs.contains(s.seq) { c.received += 1 }
        m.shareByState[state] = c
    }
    if !near.isEmpty {
        let counted = sends.filter { s in inside(s.t, nearIv) && !inside(s.t, sleepIv) }
        if !counted.isEmpty { m.nearAwakeShare = Double(counted.filter { receivedSeqs.contains($0.seq) }.count) / Double(counted.count) }
    }
    let times = recv.map { $0.t }
    let gaps = zip(times, times.dropFirst()).map { (start: $0, end: $1) }
    let minutes = gaps.map { ($0.end - $0.start) / 60_000 }
    m.gapMedianMin = median(minutes); m.gapP95Min = percentile(minutes, 0.95); m.gapLongestMin = minutes.max()
    if !near.isEmpty {
        let ordinary = gaps.filter { g in !excluded.contains { $0.start < g.end && g.start < $0.end } }
        m.ordinaryLongestMin = ordinary.map { ($0.end - $0.start) / 60_000 }.max() ?? 0
        for grace in [2, 5, 10] {
            m.lostMinutes[grace] = ordinary.map { max(0, ($0.end - $0.start) / 60_000 - Double(grace)) }.reduce(0, +)
        }
    }
    m.extra = computeExtra(stamped, nearIv: nearIv, hasNear: !near.isEmpty, dayEnd: dayEnd)
    return m
}

func inside(_ t: Double, _ iv: [Interval]) -> Bool { iv.contains { $0.start <= t && t <= $0.end } }

/// The stretches in [from, to] that `iv` does not cover: before the first `near` marker counts as away.
func complement(_ iv: [Interval], from: Double, to: Double) -> [Interval] {
    var out: [Interval] = [], cursor = from
    for i in iv.sorted(by: { $0.start < $1.start }) {
        if i.start > cursor { out.append((cursor, i.start)) }
        cursor = max(cursor, i.end)
    }
    if cursor < to { out.append((cursor, to)) }
    return out
}
