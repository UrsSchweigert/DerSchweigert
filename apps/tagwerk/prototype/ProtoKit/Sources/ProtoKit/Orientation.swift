import Foundation

public enum Orientation {
    /// Gravity in g along the screen normal beyond which the phone counts as flat. 0.8 allows about 37 degrees
    /// of tilt; a phone on its edge reads about 0 and a phone held at 45 degrees about 0.7.
    public static let flatThreshold = 0.8

    /// Uses the Core Motion convention: a phone lying face up reads z of about -1, face down about +1.
    public static func classify(x: Double, y: Double, z: Double) -> OrientationClass {
        if z <= -flatThreshold { return .faceUp }
        if z >= flatThreshold { return .faceDown }
        return .neither
    }
}
