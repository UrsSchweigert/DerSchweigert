import Foundation

/// What both prototype apps must agree on: the Bluetooth UUIDs and the small text messages written to the
/// phone-to-computer characteristic or notified on the events characteristic.
public enum ProtoWire {
    public static let serviceUUID = "6E7A0001-5A6B-4C1D-9E2F-7A1B3C5D7E90"
    /// Notify: PingFrame bytes, about once a minute.
    public static let pingUUID = "6E7A0002-5A6B-4C1D-9E2F-7A1B3C5D7E90"
    /// Write: acknowledgements and check-in answers from the phone.
    public static let phoneToComputerUUID = "6E7A0003-5A6B-4C1D-9E2F-7A1B3C5D7E90"
    /// Notify: check-in shown and answered, computer to phone.
    public static let eventsUUID = "6E7A0004-5A6B-4C1D-9E2F-7A1B3C5D7E90"

    public static let pairingScheme = "tagwerkproto"

    public enum Message: Equatable {
        case ack(seq: Int)
        case checkinAnswered(id: String, answer: String)
        /// The phone reports how it got the code (`qr` or `number`) and the code itself, so the computer can tell
        /// whether pairing succeeded.
        case pairing(method: String, code: String)
        case checkinShown(id: String)

        public var text: String {
            switch self {
            case let .ack(seq): return "ack:\(seq)"
            case let .checkinAnswered(id, answer): return "answer:\(id):\(answer)"
            case let .pairing(method, code): return "pair:\(method):\(code)"
            case let .checkinShown(id): return "shown:\(id)"
            }
        }

        public static func parse(_ data: Data) -> Message? {
            let p = String(decoding: data, as: UTF8.self).split(separator: ":", maxSplits: 2).map(String.init)
            switch (p.first, p.count) {
            case ("ack", 2): return Int(p[1]).map { .ack(seq: $0) }
            case ("answer", 3): return .checkinAnswered(id: p[1], answer: p[2])
            case ("pair", 3): return .pairing(method: p[1], code: p[2])
            case ("shown", 2): return .checkinShown(id: p[1])
            default: return nil
            }
        }
    }

    /// The link the QR image carries. The short number is typed on the phone instead; both reach the same code.
    public static func pairingLink(code: String) -> String { "\(pairingScheme)://pair?code=\(code)" }

    public static func pairingCode(fromLink link: String) -> String? {
        guard let c = URLComponents(string: link), c.scheme == pairingScheme else { return nil }
        return c.queryItems?.first { $0.name == "code" }?.value
    }
}
