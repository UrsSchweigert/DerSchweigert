import CoreBluetooth
import UIKit
import ProtoKit

/// The Bluetooth central: scans for the service, connects, subscribes to the ping, reconnects forever, and
/// answers each ping with the accelerometer reading and an acknowledgement.
final class Central: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let restoreId = "de.derschweigert.tagwerk.proto.central"
    private let log: PhoneLog
    private let motion = Motion()
    private var manager: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var phoneToComputer: CBCharacteristic?
    private var pending: (frame: PingFrame, state: String, remaining: Double?)?
    private var pings = 0
    /// Writes sent and not yet answered by the stack, in order.
    private var writes: [Write] = []
    /// Messages waiting for the phoneToComputer characteristic: a Camera link usually cold-launches the app before
    /// Bluetooth has connected, and that first pairing must reach the computer rather than vanish.
    private var outbox: [(message: ProtoWire.Message, write: Write)] = []
    /// Set at launch when iOS started the app to restore the central.
    var restoredLaunch = false
    /// Called for each text message the computer notifies on the events characteristic.
    var onEvent: ((ProtoWire.Message) -> Void)?

    private enum Write { case plain, pairing(method: String, since: Date) }

    init(log: PhoneLog) {
        self.log = log
        super.init()
        manager = CBCentralManager(delegate: self, queue: nil, options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreId])
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    var isConnected: Bool { phoneToComputer != nil }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        log.log(.bluetoothState(state: "\(central.state.rawValue)"))
        guard central.state == .poweredOn else { return }
        guard let p = peripheral else { return scan() }
        // A restored peripheral may still be connected: then didConnect does not fire again, so discover now.
        if p.state == .connected { p.discoverServices([CBUUID(string: ProtoWire.serviceUUID)]) } else { connect(p) }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        restoredLaunch = true
        log.log(.restore)
        if let p = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
            peripheral = p
            p.delegate = self
        }
    }

    private func scan() {
        manager.scanForPeripherals(withServices: [CBUUID(string: ProtoWire.serviceUUID)])
    }

    /// connect has no timeout: iOS completes it whenever the computer comes back in range.
    private func connect(_ p: CBPeripheral) {
        p.delegate = self
        peripheral = p
        manager.connect(p)
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        manager.stopScan()
        connect(p)
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        log.log(.connect)
        p.discoverServices([CBUUID(string: ProtoWire.serviceUUID)])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        log.log(.disconnect(reason: error.map { "\($0)" } ?? "connect failed"))
        connect(p)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        log.log(.disconnect(reason: error.map { "\($0)" }))
        phoneToComputer = nil
        // The stack answers no write that was in flight; a pairing among them failed and is logged as such.
        for case let .pairing(method, since) in writes { logPairing(method: method, since: since, success: false) }
        writes = []
        connect(p)
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        p.services?.forEach { p.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for c in service.characteristics ?? [] {
            switch c.uuid.uuidString.uppercased() {
            case ProtoWire.pingUUID, ProtoWire.eventsUUID: p.setNotifyValue(true, for: c)
            case ProtoWire.phoneToComputerUUID: phoneToComputer = c
            default: break
            }
        }
        let queued = outbox
        outbox = []
        queued.forEach { write($0.message, as: $0.write) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        if c.isNotifying, let n = peripheral { log.log(.subscribe(characteristic: c.uuid.uuidString, subscribers: n.state == .connected ? 1 : 0)) }
        else if let error { log.log(.disconnect(reason: "subscribe failed: \(error)")) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard let data = c.value else { return }
        switch c.uuid.uuidString.uppercased() {
        case ProtoWire.pingUUID:
            guard let frame = try? PingFrame.decode(data) else { return }
            let remaining = UIApplication.shared.backgroundTimeRemaining
            pending = (frame, Self.stateName(UIApplication.shared.applicationState), remaining > 1e8 ? nil : remaining)
            p.readRSSI()
        case ProtoWire.eventsUUID:
            if let m = ProtoWire.Message.parse(data) { onEvent?(m) }
        default: break
        }
    }

    func peripheral(_ p: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard let ping = pending else { return }
        pending = nil
        log.log(.pingReceived(seq: Int(ping.frame.seq), senderMs: Int64(ping.frame.senderMs), appState: ping.state,
                              restoredLaunch: restoredLaunch, rssi: error == nil ? RSSI.intValue : nil,
                              backgroundRemainingS: ping.remaining))
        pings += 1
        if pings % 10 == 1 {
            let d = UIDevice.current
            log.log(.battery(level: Double(d.batteryLevel), charging: d.batteryState == .charging || d.batteryState == .full,
                             lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled))
        }
        let task = UIApplication.shared.beginBackgroundTask(expirationHandler: nil)
        motion.readOnce(log: log) { [weak self] in
            self?.send(.ack(seq: Int(ping.frame.seq)))
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
    }

    /// Writes with response so the result of a pairing write can be logged. Before the characteristic is known the
    /// message waits in the outbox; a pairing's duration still runs from its entry.
    func send(_ message: ProtoWire.Message, pairing: (method: String, since: Date)? = nil) {
        write(message, as: pairing.map { .pairing(method: $0.method, since: $0.since) } ?? .plain)
    }

    private func write(_ message: ProtoWire.Message, as kind: Write) {
        guard let p = peripheral, p.state == .connected, let c = phoneToComputer else {
            return outbox.append((message, kind))
        }
        writes.append(kind)
        p.writeValue(Data(message.text.utf8), for: c, type: .withResponse)
    }

    private func logPairing(method: String, since: Date, success: Bool) {
        log.log(.pairing(method: method, success: success, durationMs: Date().timeIntervalSince(since) * 1000))
    }

    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        guard !writes.isEmpty else { return }
        if case let .pairing(method, since) = writes.removeFirst() {
            logPairing(method: method, since: since, success: error == nil)
        }
    }

    private static func stateName(_ s: UIApplication.State) -> String {
        switch s {
        case .active: return "active"
        case .inactive: return "inactive"
        case .background: return "background"
        @unknown default: return "unknown"
        }
    }
}
