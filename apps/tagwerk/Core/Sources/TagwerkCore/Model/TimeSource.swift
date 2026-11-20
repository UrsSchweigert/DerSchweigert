import Foundation

/// The only way code in the package learns the current time; nothing calls `Date()` itself.
public protocol TimeSource: Sendable {
    /// The current instant.
    var now: Date { get }
}

/// A time source that always answers the same instant, for tests and replays.
public struct FixedTimeSource: TimeSource, Equatable {
    /// The instant returned by `now`.
    public let now: Date
    /// Fixes the clock at `now`.
    public init(_ now: Date) { self.now = now }
}
