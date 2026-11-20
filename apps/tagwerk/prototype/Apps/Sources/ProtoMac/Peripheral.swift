import CoreBluetooth
import CoreGraphics
import Foundation
import ProtoKit

/// Advertises one service with three characteristics and pings subscribers about once a minute.
final class Peripheral: NSObject, CBPeripheralManagerDelegate {
    private let log: ProtoLog
    private var manager: CBPeripheralManager!
    private let ping = CBMutableCharacteristic(type: CBUUID(string: ProtoWire.pingUUID), properties: [.notify],
                                               value: nil, permissions: [.readable])
    private let events = CBMutableCharacteristic(type: CBUUID(string: ProtoWire.eventsUUID), properties: [.notify],
                                                 value: nil, permissions: [.readable])
    private let inbox = CBMutableCharacteristic(type: CBUUID(string: ProtoWire.phoneToComputerUUID),
                                                properties: [.write], value: nil, permissions: [.writeable])
    /// Centrals subscribed to the ping characteristic: the ones a ping reaches.
    private var subscribers = Set<UUID>()
    private var serviceAdded = false
    private var seq: UInt32 = 0
    private var sentAt: [Int: Date] = [:]
    /// Event messages the stack refused because its queue was full; sent again when it is ready. Pings are not
    /// queued: a late ping would carry a stale time, so a refused ping stays a gap.
    private var pendingEvents: [Data] = []
    private var timer: Timer?
    /// Called on the main thread for every message the phone writes.
    var onMessage: ((ProtoWire.Message) -> Void)?

    init(log: ProtoLog, pingInterval: TimeInterval = 60) {
        self.log = log
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: .main)
        timer = Timer.scheduledTimer(withTimeInterval: pingInterval, repeats: true) { [weak self] _ in self?.sendPing() }
    }

    func send(_ message: ProtoWire.Message) {
        pendingEvents.append(Data(message.text.utf8))
        flushEvents()
    }

    private func flushEvents() {
        while let data = pendingEvents.first, manager.updateValue(data, for: events, onSubscribedCentrals: nil) {
            pendingEvents.removeFirst()
        }
    }

    /// Seconds since the last keyboard, mouse or trackpad input of any kind.
    static func idleSeconds() -> Double {
        guard let any = CGEventType(rawValue: ~0) else { return 0 }
        return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: any)
    }

    private func sendPing() {
        guard serviceAdded else { return }
        let now = Date()
        seq += 1
        let frame = PingFrame(seq: seq, senderMs: UInt64(now.timeIntervalSince1970 * 1000),
                              idleSeconds: UInt32(min(Double(UInt32.max), max(0, Self.idleSeconds()))))
        let queued = manager.updateValue(frame.encoded(), for: ping, onSubscribedCentrals: nil)
        if queued { sentAt[Int(seq)] = now }
        log.log(.pingSent(seq: Int(seq), senderMs: Int64(frame.senderMs), subscribers: subscribers.count, queued: queued))
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        log.log(.bluetoothState(state: Self.name(peripheral.state)))
        guard peripheral.state == .poweredOn else {
            // Bluetooth off or reset drops the service and every subscription.
            serviceAdded = false
            subscribers.removeAll()
            return
        }
        peripheral.removeAllServices()
        let service = CBMutableService(type: CBUUID(string: ProtoWire.serviceUUID), primary: true)
        service.characteristics = [ping, inbox, events]
        peripheral.add(service)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            log.log(.marker(label: "service_add_failed \(error.localizedDescription)"))
            return
        }
        serviceAdded = true
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service.uuid]])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                           didSubscribeTo characteristic: CBCharacteristic) {
        if characteristic.uuid == ping.uuid { subscribers.insert(central.identifier) }
        log.log(.subscribe(characteristic: characteristic.uuid.uuidString, subscribers: subscribers.count))
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                           didUnsubscribeFrom characteristic: CBCharacteristic) {
        if characteristic.uuid == ping.uuid { subscribers.remove(central.identifier) }
        log.log(.unsubscribe(characteristic: characteristic.uuid.uuidString, subscribers: subscribers.count))
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) { flushEvents() }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let data = request.value, let message = ProtoWire.Message.parse(data) else { continue }
            if case let .ack(seq) = message {
                let rtt = sentAt.removeValue(forKey: seq).map { Date().timeIntervalSince($0) * 1000 }
                log.log(.ack(seq: seq, rttMs: rtt))
            }
            onMessage?(message)
        }
        // Core Bluetooth expects one response per batch, given with the first request.
        if let first = requests.first { peripheral.respond(to: first, withResult: .success) }
    }

    private static func name(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .resetting: return "resetting"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .unknown: return "unknown"
        @unknown default: return "raw\(state.rawValue)"
        }
    }
}
