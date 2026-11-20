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
    private var subscribers = Set<UUID>()
    private var seq: UInt32 = 0
    private var sentAt: [Int: Date] = [:]
    private var timer: Timer?
    /// Called on the main thread for every message the phone writes, after it has been logged.
    var onMessage: ((ProtoWire.Message) -> Void)?

    init(log: ProtoLog, pingInterval: TimeInterval = 60) {
        self.log = log
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: .main)
        timer = Timer.scheduledTimer(withTimeInterval: pingInterval, repeats: true) { [weak self] _ in self?.sendPing() }
    }

    func send(_ message: ProtoWire.Message) {
        manager.updateValue(Data(message.text.utf8), for: events, onSubscribedCentrals: nil)
    }

    private func sendPing() {
        let now = Date()
        // Seconds since the last keyboard or mouse input, whichever is newer.
        let idle = min(CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown),
                       CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved))
        seq += 1
        let frame = PingFrame(seq: seq, senderMs: UInt64(now.timeIntervalSince1970 * 1000), idleSeconds: UInt32(max(0, idle)))
        sentAt[Int(seq)] = now
        _ = manager.updateValue(frame.encoded(), for: ping, onSubscribedCentrals: nil)
        log.log(.pingSent(seq: Int(seq), senderMs: Int64(frame.senderMs)))
        log.log(.marker(label: "ping_sent seq=\(seq) subscribers=\(subscribers.count)"))
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        log.log(.bluetoothState(state: String(describing: peripheral.state.rawValue)))
        guard peripheral.state == .poweredOn else { return }
        let service = CBMutableService(type: CBUUID(string: ProtoWire.serviceUUID), primary: true)
        service.characteristics = [ping, inbox, events]
        peripheral.add(service)
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service.uuid]])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                           didSubscribeTo characteristic: CBCharacteristic) {
        subscribers.insert(central.identifier)
        log.log(.marker(label: "subscribe \(characteristic.uuid.uuidString) subscribers=\(subscribers.count)"))
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                           didUnsubscribeFrom characteristic: CBCharacteristic) {
        subscribers.remove(central.identifier)
        log.log(.marker(label: "unsubscribe \(characteristic.uuid.uuidString) subscribers=\(subscribers.count)"))
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let data = request.value, let message = ProtoWire.Message.parse(data) else { continue }
            if case let .ack(seq) = message, let sent = sentAt.removeValue(forKey: seq) {
                log.log(.marker(label: "ack seq=\(seq) rtt_ms=\(Int(Date().timeIntervalSince(sent) * 1000))"))
            }
            onMessage?(message)
            peripheral.respond(to: request, withResult: .success)
        }
    }
}
