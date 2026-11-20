import Foundation
import ProtoKit

/// Appends one JSON line per event to a file in the temp folder and prints its path.
final class ProtoLog {
    let url: URL
    private let runId = UUID().uuidString
    private let handle: FileHandle?
    private let queue = DispatchQueue(label: "protolog")

    init() {
        let name = "tagwerk-proto-mac-\(Int(Date().timeIntervalSince1970)).jsonl"
        url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try? FileHandle(forWritingTo: url)
        print("log file: \(url.path)")
    }

    func log(_ event: LogEvent) {
        let line = LogLine(wallMs: Int64(Date().timeIntervalSince1970 * 1000), uptimeS: ProcessInfo.processInfo.systemUptime,
                           role: .computer, runId: runId, event: event)
        queue.sync {
            guard let text = try? line.encoded() else { return }
            handle?.write(Data((text + "\n").utf8))
        }
    }
}
