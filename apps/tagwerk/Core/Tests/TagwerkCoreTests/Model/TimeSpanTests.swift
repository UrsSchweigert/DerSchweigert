import XCTest
@testable import TagwerkCore

func span(_ a: Double, _ b: Double) -> TimeSpan {
    TimeSpan(start: Date(timeIntervalSince1970: a), end: Date(timeIntervalSince1970: b))
}

final class TimeSpanTests: XCTestCase {
    func testEmptyAndDuration() {
        XCTAssertTrue(span(5, 5).isEmpty)
        XCTAssertTrue(span(6, 5).isEmpty)
        XCTAssertEqual(span(6, 5).duration, 0)
        XCTAssertEqual(span(1, 4).duration, 3)
    }

    func testIntersection() {
        XCTAssertEqual(span(0, 10).intersection(span(5, 15)), span(5, 10))
        XCTAssertEqual(span(0, 10).intersection(span(2, 3)), span(2, 3))
        XCTAssertNil(span(0, 5).intersection(span(5, 9)))
        XCTAssertNil(span(0, 5).intersection(span(7, 9)))
        XCTAssertNil(span(0, 10).intersection(span(4, 4)))
    }

    func testSubtracting() {
        XCTAssertEqual(span(0, 10).subtracting(span(3, 5)), [span(0, 3), span(5, 10)])
        XCTAssertEqual(span(0, 10).subtracting(span(0, 4)), [span(4, 10)])
        XCTAssertEqual(span(0, 10).subtracting(span(-1, 11)), [])
        XCTAssertEqual(span(0, 5).subtracting(span(5, 9)), [span(0, 5)])
        XCTAssertEqual(span(3, 3).subtracting(span(0, 9)), [])
        XCTAssertEqual(span(0, 10).subtracting([span(1, 2), span(4, 6)]), [span(0, 1), span(2, 4), span(6, 10)])
    }

    func testUnion() {
        XCTAssertEqual(TimeSpan.union([span(5, 8), span(0, 2), span(2, 4), span(3, 3)]), [span(0, 4), span(5, 8)])
        XCTAssertEqual(TimeSpan.union([span(0, 10), span(2, 3)]), [span(0, 10)])
        XCTAssertEqual(TimeSpan.union([span(0, 6), span(4, 9)]), [span(0, 9)])
        XCTAssertEqual(TimeSpan.union([]), [])
    }

    func testTotalCountsOverlapOnce() {
        XCTAssertEqual(TimeSpan.totalDuration([span(0, 6), span(4, 9), span(20, 21)]), 10)
    }
}
