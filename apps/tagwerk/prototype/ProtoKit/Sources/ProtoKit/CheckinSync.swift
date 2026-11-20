import Foundation

/// What one device knows about a check-in shown on both devices. The first answer wins: when the other device
/// answers, this one must dismiss its own prompt, whichever order the events arrive in.
public struct CheckinSync {
    public enum Event { case shown, answeredHere, answeredThere }

    private enum State { case shown, answeredHere, answeredThere, dismissed }
    private var states: [String: State] = [:]

    public init() {}

    /// Feeds an event and returns true when this device must dismiss its prompt now. True is returned once per
    /// check-in; duplicates and late events return false.
    public mutating func handle(_ event: Event, checkin id: String) -> Bool {
        switch (event, states[id]) {
        case (.shown, nil): states[id] = .shown
        case (.shown, .answeredThere?):
            // The answer from the other device beat the prompt here: dismiss it as soon as it appears.
            states[id] = .dismissed
            return true
        case (.answeredHere, nil), (.answeredHere, .shown?): states[id] = .answeredHere
        case (.answeredThere, nil): states[id] = .answeredThere
        case (.answeredThere, .shown?):
            states[id] = .dismissed
            return true
        default: break
        }
        return false
    }
}
