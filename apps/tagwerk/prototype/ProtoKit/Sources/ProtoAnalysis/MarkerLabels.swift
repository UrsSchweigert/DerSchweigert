/// The `marker` labels the owner types or taps during a measurement, defined once for the analyser, the report
/// and the procedure. Interruption kinds are bracketed: `<kind>_start` ... `<kind>_end`.
public enum MarkerLabel {
    public static let near = "near"
    public static let away = "away"
    /// `distance_<metres>m`, for example `distance_5m`.
    public static let distancePrefix = "distance_"
    public static let faceUp = "face_up"
    public static let faceDown = "face_down"
    public static let interruptionKinds = ["interruption_call", "interruption_meeting", "interruption_break"]
    public static let start = "_start"
    public static let end = "_end"
    public static let idle = "idle"

    public static var all: [String] {
        [near, away, distancePrefix + "<metres>m", faceUp, faceDown, idle]
            + interruptionKinds.flatMap { [$0 + start, $0 + end] }
    }
}
