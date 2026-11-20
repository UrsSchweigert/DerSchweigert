import Foundation

public enum Verdict: String, Equatable {
    case met = "met", notMet = "not met", notMeasured = "not measured"
}

public enum Overall: String, Equatable {
    case go = "go", noGo = "no-go", incomplete = "incomplete"
}

public struct ThresholdResult: Equatable {
    public var key: String
    public var limit: Double
    public var value: Double?
    public var verdict: Verdict
}

/// Thresholds are a flat JSON object of numbers. `min_<metric>` needs value >= limit, `max_<metric>` needs
/// value <= limit. A key naming no metric this analyser computes is "not measured", never silently met.
public func evaluate(thresholdsJSON: String, metrics: [String: Double]) throws -> (results: [ThresholdResult], overall: Overall) {
    guard let limits = try? JSONDecoder().decode([String: Double].self, from: Data(thresholdsJSON.utf8)) else {
        throw AnalyseError.badThresholds
    }
    let results = limits.keys.sorted().map { key -> ThresholdResult in
        let limit = limits[key]!
        let metric = key.dropFirst(4)
        guard key.hasPrefix("min_") || key.hasPrefix("max_"), let value = metrics[String(metric)] else {
            return ThresholdResult(key: key, limit: limit, value: nil, verdict: .notMeasured)
        }
        let ok = key.hasPrefix("min_") ? value >= limit : value <= limit
        return ThresholdResult(key: key, limit: limit, value: value, verdict: ok ? .met : .notMet)
    }
    let overall: Overall = results.contains { $0.verdict == .notMet } ? .noGo
        : results.contains { $0.verdict == .notMeasured } ? .incomplete : .go
    return (results, overall)
}
