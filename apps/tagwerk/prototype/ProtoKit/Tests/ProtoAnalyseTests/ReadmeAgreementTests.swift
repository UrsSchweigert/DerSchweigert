import XCTest
@testable import ProtoAnalysis

/// The procedure and the analyser must agree: every marker the analyser reads and every threshold it judges has to be
/// in the owner's README, or the day protocol would not produce what the analysis needs.
final class ReadmeAgreementTests: XCTestCase {
    private func read(_ file: String) throws -> String {
        let root = #filePath.replacingOccurrences(of: "ProtoKit/Tests/ProtoAnalyseTests/ReadmeAgreementTests.swift", with: "")
        return try String(contentsOfFile: root + file, encoding: .utf8)
    }

    func testReadmeNamesEveryAnalyserMarker() throws {
        let readme = try read("README.md")
        // The interruption markers have no button in the prototype, and the README says so; the rest must be tappable.
        let needed = [MarkerLabel.near, MarkerLabel.away, MarkerLabel.faceUp, MarkerLabel.faceDown]
            + ["1m", "2m", "5m", "next_room"].map { MarkerLabel.distancePrefix + $0 }
            + ["locked", "in_bag"]
        for label in needed { XCTAssertTrue(readme.contains("`\(label)`"), "README lacks marker \(label)") }
        for kind in MarkerLabel.interruptionKinds { XCTAssertTrue(readme.contains(kind), "README lacks \(kind)") }
    }

    func testReadmeNamesEveryThreshold() throws {
        let readme = try read("README.md")
        let json = try read("thresholds.json")
        let keys = try JSONDecoder().decode([String: Double].self, from: Data(json.utf8)).keys
        XCTAssertFalse(keys.isEmpty)
        for key in keys { XCTAssertTrue(readme.contains("`\(key)`"), "README lacks threshold \(key)") }
    }
}
