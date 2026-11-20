import Foundation

/// The ping the computer sends the phone: version byte, then big-endian sequence (4 bytes), sender time in
/// milliseconds since 1970 (8 bytes) and the computer's idle seconds (4 bytes).
public struct PingFrame: Equatable {
    public static let version: UInt8 = 1
    public static let length = 17

    public enum DecodeError: Error, Equatable {
        case tooShort(Int)
        case wrongVersion(UInt8)
    }

    public var seq: UInt32
    public var senderMs: UInt64
    public var idleSeconds: UInt32

    public init(seq: UInt32, senderMs: UInt64, idleSeconds: UInt32) {
        self.seq = seq; self.senderMs = senderMs; self.idleSeconds = idleSeconds
    }

    public func encoded() -> Data {
        var out = [Self.version]
        out += Self.be(UInt64(seq), 4) + Self.be(senderMs, 8) + Self.be(UInt64(idleSeconds), 4)
        return Data(out)
    }

    public static func decode(_ data: Data) throws -> PingFrame {
        let b = [UInt8](data)
        guard b.count >= length else { throw DecodeError.tooShort(b.count) }
        guard b[0] == version else { throw DecodeError.wrongVersion(b[0]) }
        return PingFrame(seq: UInt32(num(b, 1, 4)), senderMs: num(b, 5, 8), idleSeconds: UInt32(num(b, 13, 4)))
    }

    private static func be(_ v: UInt64, _ n: Int) -> [UInt8] {
        (0..<n).map { UInt8(truncatingIfNeeded: v >> UInt64(8 * (n - 1 - $0))) }
    }

    private static func num(_ b: [UInt8], _ at: Int, _ n: Int) -> UInt64 {
        b[at..<at + n].reduce(0) { $0 << 8 | UInt64($1) }
    }
}

public enum SequenceGaps {
    /// Sequence numbers missing between the first and last received, sorted. Duplicates and reordering do not
    /// count as gaps.
    public static func missing(in received: [Int]) -> [Int] {
        guard let lo = received.min(), let hi = received.max() else { return [] }
        let have = Set(received)
        return (lo...hi).filter { !have.contains($0) }
    }
}
