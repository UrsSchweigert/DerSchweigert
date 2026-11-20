import AppKit
import ProtoKit

/// The prototype check-in: three answers in a panel. The first answer, here or on the phone, wins.
final class Checkin {
    private let log: ProtoLog
    private let peripheral: Peripheral
    private var sync = CheckinSync()
    private var panel: NSPanel?
    private var currentId: String?
    static let answers = ["Working", "Break", "Done"]

    init(log: ProtoLog, peripheral: Peripheral) { self.log = log; self.peripheral = peripheral }

    /// Called for every message from the phone; an answer from the phone closes the panel here.
    func handle(_ message: ProtoWire.Message) {
        guard case let .checkinAnswered(id, _) = message else { return }
        log.log(.checkinAnswered(id: id))
        if sync.handle(.answeredThere, checkin: id), id == currentId { close(); log.log(.checkinDismissed(id: id)) }
    }

    func show() {
        let id = UUID().uuidString
        currentId = id
        _ = sync.handle(.shown, checkin: id)
        log.log(.checkinShown(id: id))
        peripheral.send(.checkinShown(id: id))
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 90), styleMask: [.titled, .closable],
                            backing: .buffered, defer: false)
        panel.title = "What are you doing?"
        let buttons = Self.answers.enumerated().map { i, title -> NSButton in
            let b = NSButton(title: title, target: self, action: #selector(answered(_:)))
            b.tag = i
            return b
        }
        let stack = NSStackView(views: buttons)
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        panel.contentView = stack
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        self.panel = panel
    }

    @objc private func answered(_ sender: NSButton) {
        guard let id = currentId else { return }
        _ = sync.handle(.answeredHere, checkin: id)
        log.log(.checkinAnswered(id: id))
        peripheral.send(.checkinAnswered(id: id, answer: Self.answers[sender.tag]))
        close()
    }

    private func close() { panel?.close(); panel = nil; currentId = nil }
}
