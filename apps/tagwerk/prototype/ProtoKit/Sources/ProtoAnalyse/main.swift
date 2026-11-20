import Foundation
import ProtoAnalysis

let args = CommandLine.arguments
guard args.count == 4 else {
    FileHandle.standardError.write(Data("usage: ProtoAnalyse <phone.log> <computer.log> <thresholds.json>\n".utf8))
    exit(1)
}
do {
    func read(_ path: String) throws -> String {
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { throw AnalyseError.unreadable(path) }
        return text
    }
    print(try analyse(phoneLog: read(args[1]), computerLog: read(args[2]), thresholdsJSON: read(args[3])))
} catch {
    FileHandle.standardError.write(Data("error: \(error)\n".utf8))
    exit(1)
}
