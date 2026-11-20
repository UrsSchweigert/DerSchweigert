import Foundation

/// A half-open interval `[start, end)` of dates; it is empty when `end <= start`.
public struct TimeSpan: Codable, Sendable, Equatable {
    /// First instant inside the span.
    public var start: Date
    /// First instant after the span; not part of it.
    public var end: Date

    /// Creates the span `[start, end)`.
    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }

    /// True when the span holds no time, so touching spans do not overlap.
    public var isEmpty: Bool { end <= start }

    /// Length in seconds; an empty span has duration 0, never a negative one.
    public var duration: TimeInterval { isEmpty ? 0 : end.timeIntervalSince(start) }

    /// The part both spans share, or nil when they only touch or are apart.
    public func intersection(_ other: TimeSpan) -> TimeSpan? {
        let s = max(start, other.start)
        let e = min(end, other.end)
        return s < e && !isEmpty && !other.isEmpty ? TimeSpan(start: s, end: e) : nil
    }

    /// The parts of this span not covered by `other`: zero, one or two sorted spans.
    public func subtracting(_ other: TimeSpan) -> [TimeSpan] {
        if isEmpty { return [] }
        guard let cut = intersection(other) else { return [self] }
        var rest: [TimeSpan] = []
        if start < cut.start { rest.append(TimeSpan(start: start, end: cut.start)) }
        if cut.end < end { rest.append(TimeSpan(start: cut.end, end: end)) }
        return rest
    }

    /// The parts of this span not covered by any of `others`, sorted and disjoint.
    public func subtracting(_ others: [TimeSpan]) -> [TimeSpan] {
        others.reduce([self]) { parts, other in parts.flatMap { $0.subtracting(other) } }
    }

    /// Merges overlapping and touching spans into disjoint spans sorted by start; empty spans are dropped.
    public static func union(_ spans: [TimeSpan]) -> [TimeSpan] {
        var result: [TimeSpan] = []
        for span in spans.filter({ !$0.isEmpty }).sorted(by: { $0.start < $1.start }) {
            if let last = result.last, span.start <= last.end {
                result[result.count - 1].end = max(last.end, span.end)
            } else {
                result.append(span)
            }
        }
        return result
    }

    /// Total seconds covered by the spans, counting overlapping time once.
    public static func totalDuration(_ spans: [TimeSpan]) -> TimeInterval {
        union(spans).reduce(0) { $0 + $1.duration }
    }
}
