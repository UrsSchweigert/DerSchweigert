import Foundation

/// Opaque identifier of a computer; compared only for equality, never parsed.
public struct ComputerID: Codable, Sendable, Equatable, Hashable {
    /// The raw identifier text.
    public var value: String
    /// Wraps an identifier.
    public init(_ value: String) { self.value = value }
    /// Decodes from a bare string.
    public init(from decoder: Decoder) throws { value = try decoder.singleValueContainer().decode(String.self) }
    /// Encodes as a bare string.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

/// Opaque identifier of an area; compared only for equality, never parsed.
public struct AreaID: Codable, Sendable, Equatable, Hashable {
    /// The raw identifier text.
    public var value: String
    /// Wraps an identifier.
    public init(_ value: String) { self.value = value }
    /// Decodes from a bare string.
    public init(from decoder: Decoder) throws { value = try decoder.singleValueContainer().decode(String.self) }
    /// Encodes as a bare string.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

/// Where a piece of working time came from. JSON: `{"kind":"computer","id":"…"}`, `{"kind":"area","id":"…"}` or `{"kind":"manual"}`.
public enum Source: Codable, Sendable, Equatable, Hashable {
    /// Presence at a computer.
    case computer(ComputerID)
    /// Presence in an area.
    case area(AreaID)
    /// A session started by hand.
    case manual

    private enum Key: String, CodingKey { case kind, id }

    /// Decodes the stable form; an unknown kind is an error.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "computer": self = .computer(try c.decode(ComputerID.self, forKey: .id))
        case "area": self = .area(try c.decode(AreaID.self, forKey: .id))
        case "manual": self = .manual
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown source kind")
        }
    }

    /// Encodes the stable form.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        switch self {
        case .computer(let id): try c.encode("computer", forKey: .kind); try c.encode(id, forKey: .id)
        case .area(let id): try c.encode("area", forKey: .kind); try c.encode(id, forKey: .id)
        case .manual: try c.encode("manual", forKey: .kind)
        }
    }
}
