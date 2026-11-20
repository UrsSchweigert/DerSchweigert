import AppKit
import CoreImage
import ProtoKit

/// Shows the pairing code as a QR image of a custom-scheme link and as a short number.
final class Pairing {
    private let log: ProtoLog
    private var window: NSWindow?
    let code = String(format: "%06d", Int.random(in: 0..<1_000_000))

    init(log: ProtoLog) { self.log = log }

    /// The phone reports which way it paired; that is logged here.
    func handle(_ message: ProtoWire.Message) {
        if case let .pairing(method) = message { log.log(.pairing(method: method, success: true, durationMs: 0)) }
    }

    func show() {
        let link = ProtoWire.pairingLink(code: code)
        let filter = CIFilter(name: "CIQRCodeGenerator")
        filter?.setValue(Data(link.utf8), forKey: "inputMessage")
        let image = NSImageView(frame: NSRect(x: 20, y: 60, width: 240, height: 240))
        if let out = filter?.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) {
            let rep = NSCIImageRep(ciImage: out)
            let nsImage = NSImage(size: rep.size)
            nsImage.addRepresentation(rep)
            image.image = nsImage
        }
        let label = NSTextField(labelWithString: "Code: \(code)")
        label.font = .monospacedDigitSystemFont(ofSize: 24, weight: .medium)
        label.frame = NSRect(x: 20, y: 15, width: 240, height: 30)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 280, height: 320), styleMask: [.titled, .closable],
                              backing: .buffered, defer: false)
        window.title = "Pair the phone"
        window.contentView?.addSubview(image)
        window.contentView?.addSubview(label)
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        log.log(.marker(label: "pairing_shown code=\(code)"))
    }
}
