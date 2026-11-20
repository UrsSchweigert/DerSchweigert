import AppKit
import ProtoKit

/// Menu-bar app. Pass `--checkin-after <minutes>` to show a check-in after that delay and again every time it
/// passes, so a working day gets regular check-ins without the menu.
final class AppDelegate: NSObject, NSApplicationDelegate {
    let log = ProtoLog()
    var peripheral: Peripheral!
    var watcher: SystemWatcher!
    var checkin: Checkin!
    var pairing: Pairing!
    var item: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.log(.launch)
        peripheral = Peripheral(log: log)
        watcher = SystemWatcher(log: log)
        checkin = Checkin(log: log, peripheral: peripheral)
        pairing = Pairing(log: log)
        peripheral.onMessage = { [weak self] in self?.checkin.handle($0); self?.pairing.handle($0) }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Proto"
        let menu = NSMenu()
        menu.addItem(withTitle: "Check in now", action: #selector(checkInNow), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Show pairing code", action: #selector(showPairing), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--checkin-after"), i + 1 < args.count, let minutes = Double(args[i + 1]),
           minutes > 0 {
            Timer.scheduledTimer(withTimeInterval: minutes * 60, repeats: true) { [weak self] _ in self?.checkin.show() }
        }
    }

    @objc func checkInNow() { checkin.show() }
    @objc func showPairing() { pairing.show() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
