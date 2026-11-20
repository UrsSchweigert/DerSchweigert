import XCTest
@testable import TagwerkCore

final class CalendarDayTests: XCTestCase {
    let berlin = TimeZone(identifier: "Europe/Berlin")!
    let cal = Calendar(identifier: .gregorian)

    func testDayLengthsAtDaylightSavingChanges() throws {
        let spring = try XCTUnwrap(CalendarDay(year: 2026, month: 3, day: 29).span(calendar: cal, timeZone: berlin))
        let autumn = try XCTUnwrap(CalendarDay(year: 2026, month: 10, day: 25).span(calendar: cal, timeZone: berlin))
        let normal = try XCTUnwrap(CalendarDay(year: 2026, month: 6, day: 1).span(calendar: cal, timeZone: berlin))
        XCTAssertEqual(spring.duration, 23 * 3600)
        XCTAssertEqual(autumn.duration, 25 * 3600)
        XCTAssertEqual(normal.duration, 24 * 3600)
    }

    func testSplitOverMidnight() throws {
        let day1 = try XCTUnwrap(CalendarDay(year: 2026, month: 6, day: 1).span(calendar: cal, timeZone: berlin))
        let s = TimeSpan(start: day1.end.addingTimeInterval(-3600), end: day1.end.addingTimeInterval(1800))
        let parts = CalendarDay.split(s, calendar: cal, timeZone: berlin)
        XCTAssertEqual(parts.map(\.day), [CalendarDay(year: 2026, month: 6, day: 1), CalendarDay(year: 2026, month: 6, day: 2)])
        XCTAssertEqual(parts.map(\.span.duration), [3600, 1800])
    }

    func testSplitAcrossAutumnChangeKeepsRealDuration() throws {
        let day = try XCTUnwrap(CalendarDay(year: 2026, month: 10, day: 25).span(calendar: cal, timeZone: berlin))
        let s = TimeSpan(start: day.start.addingTimeInterval(-3600), end: day.end.addingTimeInterval(3600))
        let parts = CalendarDay.split(s, calendar: cal, timeZone: berlin)
        XCTAssertEqual(parts.map(\.span.duration), [3600, 25 * 3600, 3600])
    }

    func testSplitEmptyAndInsideOneDay() {
        XCTAssertTrue(CalendarDay.split(span(5, 5), calendar: cal, timeZone: berlin).isEmpty)
        XCTAssertEqual(CalendarDay.split(span(100, 200), calendar: cal, timeZone: berlin).count, 1)
    }
}
