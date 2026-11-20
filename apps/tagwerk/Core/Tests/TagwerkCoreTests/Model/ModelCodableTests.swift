import XCTest
@testable import TagwerkCore

final class ModelCodableTests: XCTestCase {
    func encode<T: Encodable>(_ v: T) throws -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return String(decoding: try e.encode(v), as: UTF8.self)
    }

    func testSourceStableJSONAndRoundTrip() throws {
        XCTAssertEqual(try encode(Source.computer(ComputerID("c1"))), #"{"id":"c1","kind":"computer"}"#)
        XCTAssertEqual(try encode(Source.area(AreaID("a1"))), #"{"id":"a1","kind":"area"}"#)
        XCTAssertEqual(try encode(Source.manual), #"{"kind":"manual"}"#)
        for s in [Source.computer(ComputerID("c1")), .area(AreaID("a1")), .manual] {
            XCTAssertEqual(try JSONDecoder().decode(Source.self, from: JSONEncoder().encode(s)), s)
        }
        XCTAssertThrowsError(try JSONDecoder().decode(Source.self, from: Data(#"{"kind":"x"}"#.utf8)))
    }

    func testSettingsStableJSONAndDefaults() throws {
        let s = TrackingSettings()
        XCTAssertEqual(s.gracePeriod, 300)
        XCTAssertEqual(s.idleThreshold, 300)
        XCTAssertEqual(try encode(s), #"{"gracePeriod":300,"idleThreshold":300,"nearSignalThreshold":-70}"#)
        XCTAssertEqual(try JSONDecoder().decode(TrackingSettings.self, from: Data("{}".utf8)), s)
    }

    func testSettingsClamp() throws {
        let low = TrackingSettings(gracePeriod: -5, idleThreshold: 0, nearSignalThreshold: -500,
                                   areaBreakRule: AreaBreakRule(workBeforeBreak: 0, breakLength: 0))
        XCTAssertEqual(low.gracePeriod, 0)
        XCTAssertEqual(low.idleThreshold, 60)
        XCTAssertEqual(low.nearSignalThreshold, -100)
        XCTAssertEqual(low.areaBreakRule, AreaBreakRule(workBeforeBreak: 3600, breakLength: 60))
        let high = TrackingSettings(gracePeriod: 1e9, idleThreshold: 1e9, nearSignalThreshold: 5)
        XCTAssertEqual(high.gracePeriod, 1800)
        XCTAssertEqual(high.idleThreshold, 3600)
        XCTAssertEqual(high.nearSignalThreshold, -30)
        let decoded = try JSONDecoder().decode(TrackingSettings.self, from: Data(#"{"gracePeriod":99999}"#.utf8))
        XCTAssertEqual(decoded.gracePeriod, 1800)
    }

    func testFixedTimeSource() {
        let d = Date(timeIntervalSince1970: 42)
        XCTAssertEqual(FixedTimeSource(d).now, d)
    }

    func testTextTable() {
        let ok = TextTable(["total": .init(de: "Gesamt", en: "Total")])
        assertComplete(ok)
        XCTAssertEqual(ok.text("total", .de), "Gesamt")
        let bad = TextTable(["a": .init(de: "x", en: nil), "b": .init(de: "", en: "y")])
        XCTAssertEqual(bad.missing, ["a.en", "b.de"])
        XCTAssertNil(bad.text("zzz", .en))
    }
}
