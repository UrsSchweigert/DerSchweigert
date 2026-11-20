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
    /// Link interruptions the reconnect table reports. None is a marker: each is recognised from logged events
    /// (see `reconnectStarts` in ExtraMetrics.swift), so the owner taps nothing extra.
    public static let reconnectKinds = ["out_of_range", "bluetooth_off", "computer_sleep", "phone_restart", "app_removed"]

    public static var all: [String] {
        [near, away, distancePrefix + "<metres>m", faceUp, faceDown]
            + interruptionKinds.flatMap { [$0 + start, $0 + end] }
    }
}
