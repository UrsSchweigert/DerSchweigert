import Foundation
import ProtoKit

/// Reads both logs of one measurement and returns the Markdown report. Throws on a missing or empty log.
public func analyse(phoneLog: String, computerLog: String, thresholdsJSON: String) throws -> String {
    let phone = LogReader.read(phoneLog), computer = LogReader.read(computerLog)
    if phone.lines.isEmpty { throw AnalyseError.emptyLog("phone") }
    if computer.lines.isEmpty { throw AnalyseError.emptyLog("computer") }
    let m = try compute(phone: phone.lines, computer: computer.lines)
    let (results, overall) = try evaluate(thresholdsJSON: thresholdsJSON, metrics: m.values)
    func f(_ v: Double?, _ digits: Int = 2) -> String { v.map { String(format: "%.\(digits)f", $0) } ?? "n/a" }
    func pct(_ r: Int, _ s: Int) -> String { s == 0 ? "n/a" : String(format: "%.1f %%", 100 * Double(r) / Double(s)) }
    var out = ["# Tagwerk link measurement", "", "Overall verdict: **\(overall.rawValue)**", ""]
    out += ["Clock offset (phone minus computer, applied before all timing): \(f(m.clockOffsetMs / 1000, 3)) s",
            "Skipped unreadable lines: phone \(phone.skipped), computer \(computer.skipped)", "",
            "## Pings", "", "| Scope | Received | Sent | Share |", "| --- | --- | --- | --- |",
            "| all | \(m.received) | \(m.sent) | \(pct(m.received, m.sent)) |"]
    for state in m.shareByState.keys.sorted() {
        let c = m.shareByState[state]!
        out.append("| app_state \(state) | \(c.received) | \(c.sent) | \(pct(c.received, c.sent)) |")
    }
    out += ["", "Share while near and computer awake: \(m.nearAwakeShare.map { String(format: "%.1f %%", 100 * $0) } ?? "n/a")", "",
            "## Gaps between received pings (minutes)", "",
            "| Median | p95 | Longest | Longest ordinary |", "| --- | --- | --- | --- |",
            "| \(f(m.gapMedianMin)) | \(f(m.gapP95Min)) | \(f(m.gapLongestMin)) | \(f(m.ordinaryLongestMin)) |", "",
            "Ordinary: overlaps no away, interruption or computer-sleep interval.", "",
            "## Minutes lost (ordinary gap time beyond the grace)", "", "| Grace (min) | Lost (min) |", "| --- | --- |"]
    for g in [2, 5, 10] { out.append("| \(g) | \(f(m.lostMinutes[g])) |") }
    let x = m.extra
    func share(_ v: Double?) -> String { v.map { String(format: "%.1f %%", 100 * $0) } ?? "not measured" }
    out += ["", "## Orientation", "",
            "Reads \(x.orientationReads); succeeded and agree with the nearest face marker: \(share(x.orientationShare))", "",
            "## RSSI (dBm)", "", "| Distance marker | Pings | Mean |", "| --- | --- | --- |"]
    for k in x.rssiByMarker.keys.sorted() { out.append("| \(k) | \(x.rssiByMarker[k]!.count) | \(f(x.rssiByMarker[k]!.mean, 1)) |") }
    if x.rssiByMarker.isEmpty { out.append("| not measured | | |") }
    out += ["", "At-desk against away: cut \(x.rssiCut.map { f($0, 1) } ?? "not measured") dBm, error rate \(share(x.rssiErrorRate))", "",
            "## Reconnect after interruption (minutes to the next ping)", "", "| Kind | Longest |", "| --- | --- |"]
    for k in MarkerLabel.reconnectKinds {
        out.append("| \(k) | \(x.reconnectMinutes[k].map { $0.isFinite ? f($0) : "never" } ?? "not measured") |")
    }
    out += ["", "## Idle seconds", "", "Samples inside idle markers: \(x.idleSamples); agreeing: \(share(x.idleAgreeShare))", "",
            "## Check-in", "", "Shown: \(x.checkinsShown); shown on both, answered on one, dismissed on the other: \(share(x.checkinCompleteShare))",
            "Longest answer-to-dismissal latency after the clock offset: \(x.checkinLatencyMaxS.map { f($0, 1) + " s" } ?? "not measured")", "",
            "## Battery", "", "Drop per hour (percentage points, not charging): \(x.batteryDropPerHour.map { f($0, 1) } ?? "not measured")", "",
            "## Sensor permission", "",
            "Prompt recorded: \(x.sensorPromptSeen.map { $0 ? "seen" : "not seen" } ?? "not measured")", "",
            "## Pairing", "", "| Method | Attempts | Succeeded | Median duration (ms) |", "| --- | --- | --- | --- |"]
    for k in x.pairing.keys.sorted() {
        let p = x.pairing[k]!
        out.append("| \(k) | \(p.attempts) | \(p.successes) | \(p.medianMs.map { f($0, 0) } ?? "n/a") |")
    }
    if x.pairing.isEmpty { out.append("| not measured | | | |") }
    out += ["", "## Thresholds", "", "| Threshold | Limit | Measured | Verdict |", "| --- | --- | --- | --- |"]
    for r in results { out.append("| \(r.key) | \(r.limit) | \(f(r.value, 3)) | \(r.verdict.rawValue) |") }
    out += ["", "## Marker labels", ""] + MarkerLabel.all.map { "- `\($0)`" }
    return out.joined(separator: "\n") + "\n"
}
