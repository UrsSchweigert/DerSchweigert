import CoreMotion
import ProtoKit

/// Reads the accelerometer once per ping. Only the accelerometer: iOS shows no permission prompt for it, and the
/// measurement is meant to show whether that stays true in the background.
final class Motion {
    private let manager = CMMotionManager()
    private let queue = OperationQueue()

    /// Calls `done` once with the first sample or the error; gives up after two seconds.
    func readOnce(log: PhoneLog, done: @escaping () -> Void) {
        guard manager.isAccelerometerAvailable else {
            log.log(.orientation(x: 0, y: 0, z: 0, cls: .neither, readLatencyMs: nil, error: "accelerometer unavailable"))
            return done()
        }
        let start = Date()
        var finished = false
        let finish: (CMAccelerometerData?, Error?) -> Void = { [manager] data, error in
            DispatchQueue.main.async {
                guard !finished else { return }
                finished = true
                manager.stopAccelerometerUpdates()
                if let a = data?.acceleration {
                    let ms = Date().timeIntervalSince(start) * 1000
                    log.log(.orientation(x: a.x, y: a.y, z: a.z, cls: Orientation.classify(x: a.x, y: a.y, z: a.z),
                                         readLatencyMs: ms, error: nil))
                } else {
                    log.log(.orientation(x: 0, y: 0, z: 0, cls: .neither, readLatencyMs: nil,
                                         error: error.map { "\($0)" } ?? "timeout"))
                }
                done()
            }
        }
        manager.accelerometerUpdateInterval = 0.05
        manager.startAccelerometerUpdates(to: queue) { data, error in finish(data, error) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { finish(nil, nil) }
    }
}
