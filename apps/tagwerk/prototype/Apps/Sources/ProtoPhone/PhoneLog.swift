import Foundation
import ProtoKit

/// Appends one JSON line per event to a file in the Documents folder, which the share sheet can reach.
final class PhoneLog {
    let url: URL
    private let runId = UUID().uuidString
    private let handle: FileHandle?
    private let queue = DispatchQueue(label: "protolog")

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        url = docs.appendingPathComponent("tagwerk-proto-phone-\(Int(Date().timeIntervalSince1970)).jsonl")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try? FileHandle(forWritingTo: url)
    }

    func log(_ event: LogEvent) {
        let line = LogLine(wallMs: Int64(Date().timeIntervalSince1970 * 1000), uptimeS: ProcessInfo.processInfo.systemUptime,
                           role: .phone, runId: runId, event: event)
        queue.sync {
            guard let text = try? line.encoded() else { return }
            handle?.write(Data((text + "\n").utf8))
        }
    }
}
