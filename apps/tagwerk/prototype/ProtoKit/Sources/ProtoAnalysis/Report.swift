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
    out += ["", "## Thresholds", "", "| Threshold | Limit | Measured | Verdict |", "| --- | --- | --- | --- |"]
    for r in results { out.append("| \(r.key) | \(r.limit) | \(f(r.value, 3)) | \(r.verdict.rawValue) |") }
    out += ["", "## Marker labels", ""] + MarkerLabel.all.map { "- `\($0)`" }
    return out.joined(separator: "\n") + "\n"
}
