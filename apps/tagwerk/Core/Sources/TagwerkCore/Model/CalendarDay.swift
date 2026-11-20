import Foundation

/// A calendar day (year, month, day) as read on the wall in an injected time zone.
public struct CalendarDay: Codable, Sendable, Equatable, Hashable, Comparable {
    /// Gregorian-style year number of the calendar passed in.
    public var year: Int
    /// Month, 1 to 12.
    public var month: Int
    /// Day of the month, starting at 1.
    public var day: Int

    /// Creates a day from its components.
    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// The day that contains `date` in `timeZone`; the calendar and zone are always passed in.
    public init(containing date: Date, calendar: Calendar, timeZone: TimeZone) {
        let c = CalendarDay.calendar(calendar, timeZone).dateComponents([.year, .month, .day], from: date)
        self.init(year: c.year ?? 0, month: c.month ?? 0, day: c.day ?? 0)
    }

    /// Orders days chronologically.
    public static func < (a: CalendarDay, b: CalendarDay) -> Bool {
        (a.year, a.month, a.day) < (b.year, b.month, b.day)
    }

    /// The real span of this day, midnight to next midnight: 23 or 25 hours at daylight-saving changes.
    public func span(calendar: Calendar, timeZone: TimeZone) -> TimeSpan? {
        let cal = CalendarDay.calendar(calendar, timeZone)
        guard let start = cal.date(from: DateComponents(year: year, month: month, day: day)),
              let end = cal.date(byAdding: .day, value: 1, to: start) else { return nil }
        return TimeSpan(start: start, end: end)
    }

    /// Cuts a span at local midnights into per-day pieces, sorted by day; an empty span gives no pieces.
    public static func split(_ span: TimeSpan, calendar: Calendar, timeZone: TimeZone) -> [(day: CalendarDay, span: TimeSpan)] {
        guard !span.isEmpty else { return [] }
        var pieces: [(day: CalendarDay, span: TimeSpan)] = []
        var cursor = span.start
        while cursor < span.end {
            let day = CalendarDay(containing: cursor, calendar: calendar, timeZone: timeZone)
            let nextMidnight = day.span(calendar: calendar, timeZone: timeZone)?.end ?? span.end
            let pieceEnd = min(nextMidnight > cursor ? nextMidnight : span.end, span.end)
            pieces.append((day, TimeSpan(start: cursor, end: pieceEnd)))
            cursor = pieceEnd
        }
        return pieces
    }

    private static func calendar(_ calendar: Calendar, _ timeZone: TimeZone) -> Calendar {
        var copy = calendar
        copy.timeZone = timeZone
        return copy
    }
}
