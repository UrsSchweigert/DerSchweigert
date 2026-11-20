import Foundation

/// One log line: the common header plus the event, flattened into a single JSON object.
public struct LogLine: Equatable {
    public var wallMs: Int64
    public var uptimeS: Double
    public var role: DeviceRole
    public var runId: String
    public var event: LogEvent

    public init(wallMs: Int64, uptimeS: Double, role: DeviceRole, runId: String, event: LogEvent) {
        self.wallMs = wallMs; self.uptimeS = uptimeS; self.role = role; self.runId = runId; self.event = event
    }

    enum Header: String, CodingKey {
        case wallMs = "wall_ms", uptimeS = "uptime_s", role, runId = "run_id"
    }

    /// The JSON object on one line, without a trailing newline. JSON escapes newlines inside strings, so a line
    /// never spans two.
    public func encoded() throws -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var obj = try JSONSerialization.jsonObject(with: enc.encode(event)) as? [String: Any] ?? [:]
        obj[Header.wallMs.rawValue] = wallMs
        obj[Header.uptimeS.rawValue] = uptimeS
        obj[Header.role.rawValue] = role.rawValue
        obj[Header.runId.rawValue] = runId
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }

    public static func decode(_ line: String) throws -> LogLine {
        let data = Data(line.utf8)
        let dec = JSONDecoder()
        let h = try dec.decode(HeaderBox.self, from: data)
        return LogLine(wallMs: h.wallMs, uptimeS: h.uptimeS, role: h.role, runId: h.runId,
                       event: try dec.decode(LogEvent.self, from: data))
    }

    private struct HeaderBox: Decodable {
        let wallMs: Int64, uptimeS: Double, role: DeviceRole, runId: String
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Header.self)
            wallMs = try c.decode(Int64.self, forKey: .wallMs)
            uptimeS = try c.decode(Double.self, forKey: .uptimeS)
            role = try c.decode(DeviceRole.self, forKey: .role)
            runId = try c.decode(String.self, forKey: .runId)
        }
    }
}

public struct LogReadResult: Equatable {
    public var lines: [LogLine]
    /// Lines that did not parse. A log cut off mid-write by a crash or a killed app ends in one such line.
    public var skipped: Int
}

public enum LogReader {
    public static func read(_ text: String) -> LogReadResult {
        var result = LogReadResult(lines: [], skipped: 0)
        for raw in text.split(separator: "\n", omittingEmptySubsequences: true) {
            if let line = try? LogLine.decode(String(raw)) { result.lines.append(line) } else { result.skipped += 1 }
        }
        return result
    }
}
