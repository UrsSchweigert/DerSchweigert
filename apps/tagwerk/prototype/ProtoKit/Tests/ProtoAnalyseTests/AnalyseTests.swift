import XCTest
import ProtoKit
@testable import ProtoAnalysis

private let t0: Int64 = 1_700_000_000_000
private let thresholds = (try? String(contentsOfFile: #filePath.replacingOccurrences(
    of: "ProtoKit/Tests/ProtoAnalyseTests/AnalyseTests.swift", with: "thresholds.json"), encoding: .utf8)) ?? ""

private func line(_ t: Int64, _ role: DeviceRole, _ e: LogEvent) -> String {
    try! LogLine(wallMs: t, uptimeS: 0, role: role, runId: "r", event: e).encoded()
}

/// One measurement of `minutes` minutes with a ping a minute. `lost` minutes are sent but never received;
/// `skew` is how far the computer clock runs ahead of the phone clock.
/// `extras` adds the orientation, RSSI, reconnect, idle, check-in, battery, sensor and pairing events; `degraded`
/// makes each of them miss its threshold.
private func fixture(minutes: Int = 120, lost: Range<Int> = 0..<0, markers: Bool = true,
                     skew: Int64 = 0, extras: Bool = false, degraded: Bool = false) -> (phone: String, computer: String) {
    var phone: [String] = [], computer: [String] = []
    func at(_ min: Double) -> Int64 { t0 + Int64(min * 60_000) }
    func rssi(_ i: Int) -> Int? {
        guard extras else { return nil }
        if (90..<110).contains(i) { return degraded ? -50 : -85 }
        return (28...31).contains(i) ? -60 : (38...41).contains(i) ? -70 : -50
    }
    if markers { phone.append(line(t0, .phone, .marker(label: MarkerLabel.near))) }
    for i in 0..<minutes {
        let t = t0 + Int64(i) * 60_000
        computer.append(line(t + skew, .computer, .pingSent(seq: i, senderMs: t + skew, subscribers: 1, queued: true)))
        if !lost.contains(i) {
            phone.append(line(t + 200, .phone, .pingReceived(seq: i, senderMs: t + skew, appState: i % 2 == 0 ? "background" : "active",
                                                          restoredLaunch: false, rssi: rssi(i), backgroundRemainingS: nil)))
        }
    }
    if extras {
        func p(_ min: Double, _ e: LogEvent) { phone.append(line(at(min), .phone, e)) }
        func c(_ min: Double, _ e: LogEvent) { computer.append(line(at(min) + skew, .computer, e)) }
        p(5, .sensorPermission(promptSeen: true))
        p(90, .marker(label: MarkerLabel.away)); p(110, .marker(label: MarkerLabel.near))
        p(30, .marker(label: "distance_1m")); p(40, .marker(label: "distance_5m"))
        // Orientation: four good reads, and in the degraded run one error and one read against the marker.
        p(10, .marker(label: MarkerLabel.faceUp)); p(20, .marker(label: MarkerLabel.faceDown))
        for (m, cls) in [(10.5, OrientationClass.faceUp), (12, .faceUp), (20.5, .faceDown), (21, .faceDown)] {
            p(m, .orientation(x: 0, y: 0, z: 1, cls: cls, readLatencyMs: 50, error: nil))
        }
        if degraded {
            p(10.75, .orientation(x: 0, y: 0, z: 0, cls: .faceUp, readLatencyMs: nil, error: "timeout"))
            p(20.75, .orientation(x: 0, y: 0, z: 1, cls: .faceUp, readLatencyMs: 50, error: nil))
        }
        // Reconnect: each kind ends half a minute into a minute, so the next ping is 0.5 min away. Out of range
        // ends at the `near` marker after the away stretch, which lands on a ping.
        p(0, .launch)
        p(69, .bluetoothState(state: "4")); c(69, .bluetoothState(state: "poweredOff"))
        p(70.5, .bluetoothState(state: "5")); c(70.5, .bluetoothState(state: "poweredOn"))
        c(71.9, .computerSleep); c(72.5, .computerWake)
        p(74.5, .restore); p(74.5, .launch)
        p(76.5, .launch)
        p(95, .disconnect(reason: "out of range"))
        if degraded { p(80.5, .restore); p(80.5, .launch) }
        // Idle: the owner left at minute 90; the degraded run has a sample that says someone typed.
        c(92, .computerIdle(seconds: 120)); c(95, .computerIdle(seconds: 300))
        c(40, .computerIdle(seconds: 0))
        if degraded { c(98, .computerIdle(seconds: 0)) }
        // Check-ins: shown on both, answered on the phone after 5 s, dismissed on the computer 2 s or 30 s later.
        for (id, m, lag) in [("c1", 95.0, 2.0), ("c2", 100.0, degraded ? 30.0 : 3.0)] {
            p(m, .checkinShown(id: id)); c(m, .checkinShown(id: id))
            phone.append(line(at(m) + 5_000, .phone, .checkinAnswered(id: id)))
            computer.append(line(at(m) + 5_000 + Int64(lag * 1000) + skew, .computer, .checkinDismissed(id: id)))
        }
        if degraded { p(105, .checkinShown(id: "c3")); p(105.1, .checkinAnswered(id: "c3")) }
        p(0, .battery(level: 0.90, charging: false, lowPowerMode: false))
        p(60, .battery(level: degraded ? 0.60 : 0.85, charging: false, lowPowerMode: false))
        p(100, .battery(level: 1.0, charging: true, lowPowerMode: false))
        p(1, .pairing(method: "number", success: true, durationMs: 4000)); p(2, .pairing(method: "number", success: false, durationMs: nil))
    }
    return (phone.joined(separator: "\n"), computer.joined(separator: "\n"))
}

private func metricsEvents(_ f: (phone: String, computer: String)) throws -> [Stamped] {
    (LogReader.read(f.phone).lines.map { Stamped(t: Double($0.wallMs), role: .phone, event: $0.event) }
        + LogReader.read(f.computer).lines.map { Stamped(t: Double($0.wallMs), role: .computer, event: $0.event) })
        .sorted { $0.t < $1.t }
}

private func metrics(_ f: (phone: String, computer: String)) throws -> Metrics {
    try compute(phone: LogReader.read(f.phone).lines, computer: LogReader.read(f.computer).lines)
}

final class AnalyseTests: XCTestCase {
    func testCleanDayIsGo() throws {
        let f = fixture(extras: true)
        let m = try compute(phone: LogReader.read(f.phone).lines, computer: LogReader.read(f.computer).lines)
        XCTAssertEqual(m.sent, 120); XCTAssertEqual(m.received, 120)
        XCTAssertEqual(m.nearAwakeShare, 1); XCTAssertEqual(m.gapLongestMin!, 1, accuracy: 1e-9)
        XCTAssertEqual(m.lostMinutes[2], 0)
        let report = try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds)
        XCTAssertTrue(report.contains("Overall verdict: **go**"))
        XCTAssertTrue(report.contains("`interruption_call_start`"))
    }

    func testLongGapsAreNoGoWithLostMinutes() throws {
        let f = fixture(lost: 30..<45)
        let m = try compute(phone: LogReader.read(f.phone).lines, computer: LogReader.read(f.computer).lines)
        XCTAssertEqual(m.received, 105)
        XCTAssertEqual(m.nearAwakeShare!, 105.0 / 120, accuracy: 1e-9)
        XCTAssertEqual(m.gapMedianMin!, 1, accuracy: 1e-9); XCTAssertEqual(m.gapP95Min!, 1, accuracy: 1e-9)
        XCTAssertEqual(m.gapLongestMin!, 16, accuracy: 1e-9)
        XCTAssertEqual(m.lostMinutes[2]!, 14, accuracy: 1e-9)
        XCTAssertEqual(m.lostMinutes[5]!, 11, accuracy: 1e-9)
        XCTAssertEqual(m.lostMinutes[10]!, 6, accuracy: 1e-9)
        XCTAssertEqual(m.shareByState["background"]!.sent + m.shareByState["active"]!.sent, 120)
        let report = try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds)
        XCTAssertTrue(report.contains("Overall verdict: **no-go**"))
        XCTAssertTrue(report.contains("| max_ordinary_gap_minutes | 5.0 | 16.000 | not met |"))
    }

    func testMissingMarkersIsIncomplete() throws {
        let f = fixture(markers: false)
        let report = try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds)
        XCTAssertTrue(report.contains("Overall verdict: **incomplete**"))
        XCTAssertTrue(report.contains("not measured"))
    }

    func testAwayAndSleepGapsAreNotOrdinary() throws {
        var f = fixture(lost: 30..<60)
        f.phone += "\n" + line(t0 + 29 * 60_000, .phone, .marker(label: MarkerLabel.away))
            + "\n" + line(t0 + 60 * 60_000, .phone, .marker(label: MarkerLabel.near))
        let m = try compute(phone: LogReader.read(f.phone).lines, computer: LogReader.read(f.computer).lines)
        XCTAssertEqual(m.gapLongestMin!, 31, accuracy: 1e-9)
        XCTAssertEqual(m.ordinaryLongestMin!, 1, accuracy: 1e-9)
        XCTAssertEqual(m.nearAwakeShare!, 1, accuracy: 1e-9)
    }

    func testClockOffsetDoesNotChangeResult() throws {
        let a = fixture(lost: 30..<45), b = fixture(lost: 30..<45, skew: 3_000)
        let ma = try compute(phone: LogReader.read(a.phone).lines, computer: LogReader.read(a.computer).lines)
        let mb = try compute(phone: LogReader.read(b.phone).lines, computer: LogReader.read(b.computer).lines)
        XCTAssertEqual(mb.clockOffsetMs - ma.clockOffsetMs, -3000, accuracy: 1e-9)
        XCTAssertEqual(ma.values, mb.values); XCTAssertEqual(ma.gapLongestMin, mb.gapLongestMin)
        XCTAssertEqual(try analyse(phoneLog: a.phone, computerLog: a.computer, thresholdsJSON: thresholds).contains("no-go"), true)
        XCTAssertEqual(try analyse(phoneLog: b.phone, computerLog: b.computer, thresholdsJSON: thresholds).contains("no-go"), true)
    }

    func testMissingOrEmptyLogIsAnError() {
        let f = fixture()
        XCTAssertThrowsError(try analyse(phoneLog: "", computerLog: f.computer, thresholdsJSON: thresholds)) {
            XCTAssertEqual($0 as? AnalyseError, .emptyLog("phone"))
        }
        XCTAssertThrowsError(try analyse(phoneLog: f.phone, computerLog: "not json\n", thresholdsJSON: thresholds)) {
            XCTAssertEqual($0 as? AnalyseError, .emptyLog("computer"))
        }
        XCTAssertThrowsError(try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: "[")) {
            XCTAssertEqual($0 as? AnalyseError, .badThresholds)
        }
    }

    func testUnknownThresholdKeyIsNotMeasured() throws {
        let r = try evaluate(thresholdsJSON: #"{"max_reconnect_s": 3, "min_ping_share_near_awake": 0.9}"#,
                             metrics: ["ping_share_near_awake": 1])
        XCTAssertEqual(r.results.map { $0.verdict }, [.notMeasured, .met])
        XCTAssertEqual(r.overall, .incomplete)
    }

    func testExtraMetricsOnCleanDay() throws {
        let f = fixture(extras: true), x = try metrics(f).extra
        XCTAssertEqual(x.orientationReads, 4); XCTAssertEqual(x.orientationShare, 1)
        XCTAssertEqual(x.rssiByMarker["distance_1m"]!.mean, -60, accuracy: 1e-9)
        XCTAssertEqual(x.rssiByMarker["distance_1m"]!.count, 4)
        XCTAssertEqual(x.rssiByMarker["distance_5m"]!.mean, -70, accuracy: 1e-9)
        XCTAssertEqual(x.rssiErrorRate!, 0, accuracy: 1e-9)
        XCTAssertTrue(x.rssiCut! < -70 && x.rssiCut! > -85)
        XCTAssertEqual(Set(x.reconnectMinutes.keys), Set(MarkerLabel.reconnectKinds))
        XCTAssertEqual(x.reconnectMax!, 0.5, accuracy: 0.01)
        XCTAssertEqual(x.idleSamples, 2); XCTAssertEqual(x.idleAgreeShare, 1)
        XCTAssertEqual(x.checkinsShown, 2); XCTAssertEqual(x.checkinCompleteShare, 1)
        XCTAssertEqual(x.checkinLatencyMaxS!, 3, accuracy: 0.5)
        XCTAssertEqual(x.batteryDropPerHour!, 5, accuracy: 1e-9)
        XCTAssertEqual(x.sensorPromptSeen, true)
        XCTAssertEqual(x.pairing["number"]?.attempts, 2); XCTAssertEqual(x.pairing["number"]?.successes, 1)
        XCTAssertEqual(x.pairing["number"]?.medianMs, 4000)
        let report = try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds)
        XCTAssertTrue(report.contains("| max_battery_drop_per_hour | 10.0 | 5.000 | met |"))
        XCTAssertTrue(report.contains("| phone_restart | 0.5"))
        XCTAssertTrue(report.contains("| out_of_range | 0.0"))
        XCTAssertTrue(report.contains("| number | 2 | 1 | 4000 |"))
    }

    func testExtraMetricsIgnoreClockSkew() throws {
        let a = try metrics(fixture(extras: true)), b = try metrics(fixture(skew: 3_000, extras: true))
        XCTAssertEqual(a.values, b.values)
        XCTAssertEqual(b.extra.checkinLatencyMaxS!, 3, accuracy: 0.5)
    }

    func testDegradedRunMissesEveryExtraThreshold() throws {
        let f = fixture(lost: 80..<84, extras: true, degraded: true), m = try metrics(f), x = m.extra
        XCTAssertEqual(x.orientationShare!, 4.0 / 6, accuracy: 1e-9)
        XCTAssertEqual(x.rssiErrorRate!, 20.0 / 116, accuracy: 1e-9)
        XCTAssertEqual(x.reconnectMinutes["phone_restart"]!, 3.5, accuracy: 0.01)
        XCTAssertEqual(x.idleAgreeShare!, 2.0 / 3, accuracy: 1e-9)
        XCTAssertEqual(x.checkinCompleteShare!, 2.0 / 3, accuracy: 1e-9)
        XCTAssertEqual(x.checkinLatencyMaxS!, 30, accuracy: 0.5)
        XCTAssertEqual(x.batteryDropPerHour!, 30, accuracy: 0.5)
        let r = try evaluate(thresholdsJSON: thresholds, metrics: m.values).results
        for key in ["min_orientation_read_share", "max_rssi_error_rate", "max_reconnect_minutes_max", "min_idle_agree_share",
                    "min_checkin_complete_share", "max_checkin_latency_s_max", "max_battery_drop_per_hour"] {
            XCTAssertEqual(r.first { $0.key == key }?.verdict, .notMet, key)
        }
    }

    func testNoDataReportsNotMeasured() throws {
        let f = fixture(), m = try metrics(f)
        XCTAssertEqual(m.extra.values, [:])
        XCTAssertNil(m.extra.sensorPromptSeen); XCTAssertTrue(m.extra.pairing.isEmpty)
        let report = try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds)
        XCTAssertTrue(report.contains("| max_rssi_error_rate | 0.1 | n/a | not measured |"))
        XCTAssertTrue(report.contains("| out_of_range | not measured |"))
        XCTAssertTrue(report.contains("Prompt recorded: not measured"))
        XCTAssertTrue(report.contains("Overall verdict: **incomplete**"))
    }

    func testReconnectKindsComeFromLoggedEvents() throws {
        let at = { (m: Double) in Double(t0) + m * 60_000 }
        let starts = reconnectStarts(try metricsEvents(fixture(extras: true)), nearIv: [(at(0), at(90)), (at(110), at(120))])
        XCTAssertEqual(starts["bluetooth_off"], [at(70.5), at(70.5)])
        XCTAssertEqual(starts["computer_sleep"], [at(72.5)]); XCTAssertEqual(starts["phone_restart"], [at(74.5)])
        XCTAssertEqual(starts["app_removed"], [at(76.5)]); XCTAssertEqual(starts["out_of_range"], [at(110)])
        // A first launch is the start of the measurement, and an away stretch without a disconnect is no outage.
        XCTAssertNil(reconnectStarts(try metricsEvents(fixture()), nearIv: [(0, 1), (2, 3)])["out_of_range"])
    }

    func testReconnectThatNeverHappensIsInfinite() throws {
        var f = fixture()
        f.phone += "\n" + line(t0, .phone, .launch) + "\n" + line(t0 + 119 * 60_000 + 30_000, .phone, .launch)
        let x = try metrics(f).extra
        XCTAssertEqual(x.reconnectMinutes["app_removed"], .infinity)
        XCTAssertTrue(try analyse(phoneLog: f.phone, computerLog: f.computer, thresholdsJSON: thresholds).contains("| app_removed | never |"))
    }
}
