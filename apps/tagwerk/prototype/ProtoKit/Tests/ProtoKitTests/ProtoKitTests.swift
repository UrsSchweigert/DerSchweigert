import XCTest
@testable import ProtoKit

final class LogFormatTests: XCTestCase {
    static let events: [LogEvent] = [
        .pingSent(seq: 3, senderMs: 1_700_000_000_123, subscribers: 1, queued: true),
        .pingSent(seq: 4, senderMs: 9, subscribers: 0, queued: false),
        .subscribe(characteristic: ProtoWire.pingUUID, subscribers: 1), .unsubscribe(characteristic: "x", subscribers: 0),
        .ack(seq: 3, rttMs: 85.5), .ack(seq: 9, rttMs: nil), .pairingShown,
        .pairing(method: "qr", success: false, durationMs: nil),
        .pingReceived(seq: 3, senderMs: 1_700_000_000_123, appState: "background", restoredLaunch: true, rssi: -61, backgroundRemainingS: 9.5),
        .pingReceived(seq: 4, senderMs: 5, appState: "active", restoredLaunch: false, rssi: nil, backgroundRemainingS: nil),
        .orientation(x: 0.01, y: -0.02, z: -0.99, cls: .faceUp, readLatencyMs: 12.5, error: nil),
        .orientation(x: 0, y: 0, z: 0, cls: .neither, readLatencyMs: nil, error: "denied"),
        .connect, .disconnect(reason: "timeout"), .disconnect(reason: nil), .restore, .launch,
        .bluetoothState(state: "poweredOn"),
        .battery(level: 0.5, charging: false, lowPowerMode: true),
        .computerIdle(seconds: 42), .computerSleep, .computerWake,
        .checkinShown(id: "c1"), .checkinAnswered(id: "c1"), .checkinDismissed(id: "c1"),
        .notificationScheduled(id: "n1"), .notificationCancelled(id: "n1"),
        .pairing(method: "passkey", success: true, durationMs: 4200),
        .sensorPermission(promptSeen: false),
        .marker(label: "walked away\nwith \"quotes\" /"),
    ]

    func testEveryEventRoundTripsOnOneLine() throws {
        for event in Self.events {
            let line = LogLine(wallMs: 1_700_000_000_000, uptimeS: 12.25, role: .phone, runId: "r1", event: event)
            let text = try line.encoded()
            XCTAssertFalse(text.contains("\n"), text)
            XCTAssertEqual(try LogLine.decode(text), line)
        }
    }

    func testHeaderKeys() throws {
        let text = try LogLine(wallMs: 7, uptimeS: 1.5, role: .computer, runId: "r", event: .launch).encoded()
        XCTAssertEqual(text, #"{"event":"launch","role":"computer","run_id":"r","uptime_s":1.5,"wall_ms":7}"#)
    }

    /// The procedure and the analyser name these keys; a rename must fail here.
    func testMeasurementKeys() throws {
        func keys(_ e: LogEvent) throws -> String {
            let text = try LogLine(wallMs: 1, uptimeS: 1, role: .computer, runId: "r", event: e).encoded()
            let obj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] ?? [:]
            return obj.keys.filter { !["wall_ms", "uptime_s", "role", "run_id"].contains($0) }.sorted().joined(separator: ",")
        }
        XCTAssertEqual(try keys(.pingSent(seq: 1, senderMs: 2, subscribers: 1, queued: true)), "event,queued,sender_ms,seq,subscribers")
        XCTAssertEqual(try keys(.subscribe(characteristic: "c", subscribers: 1)), "characteristic,event,subscribers")
        XCTAssertEqual(try keys(.ack(seq: 1, rttMs: 3)), "event,rtt_ms,seq")
        XCTAssertEqual(try keys(.pairing(method: "qr", success: true, durationMs: 5)), "duration_ms,event,method,success")
    }

    func testUnknownEventDecodesToUnknown() throws {
        let text = #"{"event":"teleport","role":"phone","run_id":"r","uptime_s":1,"wall_ms":7}"#
        XCTAssertEqual(try LogLine.decode(text).event, .unknown(name: "teleport"))
    }

    func testTruncatedLastLineIsSkippedAndCounted() throws {
        let a = try LogLine(wallMs: 1, uptimeS: 1, role: .phone, runId: "r", event: .launch).encoded()
        let b = try LogLine(wallMs: 2, uptimeS: 2, role: .phone, runId: "r", event: .connect).encoded()
        let result = LogReader.read(a + "\n" + b + "\n" + String(b.prefix(20)))
        XCTAssertEqual(result.lines.map(\.wallMs), [1, 2])
        XCTAssertEqual(result.skipped, 1)
        XCTAssertEqual(LogReader.read(a + "\n").skipped, 0)
    }
}

final class OrientationTests: XCTestCase {
    func testFaces() {
        XCTAssertEqual(Orientation.classify(x: 0, y: 0, z: -1), .faceUp)
        XCTAssertEqual(Orientation.classify(x: 0, y: 0, z: 1), .faceDown)
        XCTAssertEqual(Orientation.classify(x: 0, y: 0, z: -Orientation.flatThreshold), .faceUp)
    }

    func testOnEdgeAndTiltedAreNeither() {
        XCTAssertEqual(Orientation.classify(x: 1, y: 0, z: 0), .neither)
        XCTAssertEqual(Orientation.classify(x: 0, y: -0.7, z: -0.7), .neither)
        XCTAssertEqual(Orientation.classify(x: 0, y: 0.7, z: 0.7), .neither)
    }
}

final class PingFrameTests: XCTestCase {
    func testRoundTrip() throws {
        let f = PingFrame(seq: 70_000, senderMs: 1_700_000_000_123, idleSeconds: 300)
        let data = f.encoded()
        XCTAssertEqual(data.count, PingFrame.length)
        XCTAssertEqual(data.first, PingFrame.version)
        XCTAssertEqual(try PingFrame.decode(data), f)
    }

    func testRejectsWrongVersionAndShortFrame() {
        var bad = PingFrame(seq: 1, senderMs: 2, idleSeconds: 3).encoded()
        bad[0] = 9
        XCTAssertThrowsError(try PingFrame.decode(bad)) { XCTAssertEqual($0 as? PingFrame.DecodeError, .wrongVersion(9)) }
        let short = PingFrame(seq: 1, senderMs: 2, idleSeconds: 3).encoded().prefix(10)
        XCTAssertThrowsError(try PingFrame.decode(Data(short))) { XCTAssertEqual($0 as? PingFrame.DecodeError, .tooShort(10)) }
    }

    func testSequenceGaps() {
        XCTAssertEqual(SequenceGaps.missing(in: [1, 2, 5, 5, 7, 6]), [3, 4])
        XCTAssertEqual(SequenceGaps.missing(in: []), [])
    }
}

final class CheckinSyncTests: XCTestCase {
    func testShownThenAnsweredThereDismisses() {
        var s = CheckinSync()
        XCTAssertFalse(s.handle(.shown, checkin: "c"))
        XCTAssertTrue(s.handle(.answeredThere, checkin: "c"))
    }

    func testAnsweredThereThenShownDismissesOnShow() {
        var s = CheckinSync()
        XCTAssertFalse(s.handle(.answeredThere, checkin: "c"))
        XCTAssertTrue(s.handle(.shown, checkin: "c"))
    }

    func testDuplicateAnswerDismissesOnce() {
        var s = CheckinSync()
        _ = s.handle(.shown, checkin: "c")
        XCTAssertTrue(s.handle(.answeredThere, checkin: "c"))
        XCTAssertFalse(s.handle(.answeredThere, checkin: "c"))
    }

    func testAnsweredHereNeverDismissesAndIdsAreIndependent() {
        var s = CheckinSync()
        _ = s.handle(.shown, checkin: "c")
        _ = s.handle(.answeredHere, checkin: "c")
        XCTAssertFalse(s.handle(.answeredThere, checkin: "c"))
        XCTAssertFalse(s.handle(.shown, checkin: "d"))
    }
}

final class ProtoWireTests: XCTestCase {
    func testUUIDsAreValidAndDistinct() {
        let all = [ProtoWire.serviceUUID, ProtoWire.pingUUID, ProtoWire.phoneToComputerUUID, ProtoWire.eventsUUID]
        XCTAssertEqual(Set(all).count, 4)
        for s in all { XCTAssertNotNil(UUID(uuidString: s)) }
    }

    func testMessagesRoundTrip() {
        let msgs: [ProtoWire.Message] = [.ack(seq: 7), .checkinAnswered(id: "c1", answer: "a:b"), .pairing(method: "qr", code: "042117"),
                                         .checkinShown(id: "c1")]
        for m in msgs { XCTAssertEqual(ProtoWire.Message.parse(Data(m.text.utf8)), m) }
        XCTAssertNil(ProtoWire.Message.parse(Data("ack:x".utf8)))
    }

    func testPairingLink() {
        let link = ProtoWire.pairingLink(code: "123456")
        XCTAssertEqual(ProtoWire.pairingCode(fromLink: link), "123456")
        XCTAssertNil(ProtoWire.pairingCode(fromLink: "https://pair?code=1"))
    }
}
