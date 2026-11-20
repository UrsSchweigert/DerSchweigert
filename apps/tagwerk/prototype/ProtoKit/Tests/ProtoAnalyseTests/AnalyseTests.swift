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
private func fixture(minutes: Int = 120, lost: Range<Int> = 0..<0, markers: Bool = true,
                     skew: Int64 = 0) -> (phone: String, computer: String) {
    var phone: [String] = [], computer: [String] = []
    if markers { phone.append(line(t0, .phone, .marker(label: MarkerLabel.near))) }
    for i in 0..<minutes {
        let t = t0 + Int64(i) * 60_000
        computer.append(line(t + skew, .computer, .pingSent(seq: i, senderMs: t + skew, subscribers: 1, queued: true)))
        if !lost.contains(i) {
            phone.append(line(t + 200, .phone, .pingReceived(seq: i, senderMs: t + skew, appState: i % 2 == 0 ? "background" : "active",
                                                          restoredLaunch: false, rssi: nil, backgroundRemainingS: nil)))
        }
    }
    return (phone.joined(separator: "\n"), computer.joined(separator: "\n"))
}

final class AnalyseTests: XCTestCase {
    func testCleanDayIsGo() throws {
        let f = fixture()
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
}
