import Foundation

/// Rule for breaks in an area: after `workBeforeBreak` of continuous presence, `breakLength` is not counted.
public struct AreaBreakRule: Codable, Sendable, Equatable {
    /// Continuous presence in seconds after which the break applies; clamped to 1 h ... 12 h.
    public var workBeforeBreak: TimeInterval
    /// Seconds deducted as break; clamped to 1 min ... 2 h.
    public var breakLength: TimeInterval

    /// Creates the rule, clamping both values into their ranges.
    public init(workBeforeBreak: TimeInterval, breakLength: TimeInterval) {
        self.workBeforeBreak = min(max(workBeforeBreak, 3600), 12 * 3600)
        self.breakLength = min(max(breakLength, 60), 7200)
    }

    /// Decodes and clamps like `init(workBeforeBreak:breakLength:)`.
    public init(from decoder: Decoder) throws {
        enum K: String, CodingKey { case workBeforeBreak, breakLength }
        let c = try decoder.container(keyedBy: K.self)
        self.init(workBeforeBreak: try c.decode(TimeInterval.self, forKey: .workBeforeBreak),
                  breakLength: try c.decode(TimeInterval.self, forKey: .breakLength))
    }
}

/// User-tunable tracking values; every value is clamped into its range on creation and on decoding.
public struct TrackingSettings: Codable, Sendable, Equatable {
    /// Seconds a lost signal still counts as present; default 300, clamped to 0 ... 30 min.
    public var gracePeriod: TimeInterval
    /// Seconds without input after which a computer counts as idle; default 300, clamped to 1 ... 60 min.
    public var idleThreshold: TimeInterval
    /// Signal strength in dBm at or above which a device counts as near; default -70, clamped to -100 ... -30.
    public var nearSignalThreshold: Int
    /// Optional break rule for areas; nil means no break is deducted.
    public var areaBreakRule: AreaBreakRule?

    /// Creates settings with the defaults, clamping out-of-range values.
    public init(gracePeriod: TimeInterval = 300, idleThreshold: TimeInterval = 300,
                nearSignalThreshold: Int = -70, areaBreakRule: AreaBreakRule? = nil) {
        self.gracePeriod = min(max(gracePeriod, 0), 1800)
        self.idleThreshold = min(max(idleThreshold, 60), 3600)
        self.nearSignalThreshold = min(max(nearSignalThreshold, -100), -30)
        self.areaBreakRule = areaBreakRule
    }

    /// Decodes with defaults for missing keys and clamps like `init`.
    public init(from decoder: Decoder) throws {
        enum K: String, CodingKey { case gracePeriod, idleThreshold, nearSignalThreshold, areaBreakRule }
        let c = try decoder.container(keyedBy: K.self)
        self.init(gracePeriod: try c.decodeIfPresent(TimeInterval.self, forKey: .gracePeriod) ?? 300,
                  idleThreshold: try c.decodeIfPresent(TimeInterval.self, forKey: .idleThreshold) ?? 300,
                  nearSignalThreshold: try c.decodeIfPresent(Int.self, forKey: .nearSignalThreshold) ?? -70,
                  areaBreakRule: try c.decodeIfPresent(AreaBreakRule.self, forKey: .areaBreakRule))
    }
}
