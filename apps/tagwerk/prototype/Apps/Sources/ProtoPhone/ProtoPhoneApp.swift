import SwiftUI
import UIKit
import ProtoKit

/// Owns the log and the Bluetooth central. Created in the app delegate so a background launch by Bluetooth
/// restoration starts it without any screen.
final class Model: ObservableObject {
    let log = PhoneLog()
    let central: Central
    let checkins: Checkins
    private var shared: URL { log.url }
    var logURL: URL { shared }

    init() {
        central = Central(log: log)
        checkins = Checkins(log: log)
        checkins.attach { [central] in central.send($0) }
        central.onEvent = { [checkins] in checkins.handle($0) }
    }

    func marker(_ label: String) { log.log(.marker(label: label)) }

    func sensorPrompt(seen: Bool) { log.log(.sensorPermission(promptSeen: seen)) }

    /// A pairing code from the Camera link (`qr`) or the typed number (`number`).
    func pair(method: String, code: String) {
        central.send(.pairing(method: method, code: code), pairing: (method, Date()))
    }

    func open(_ url: URL) {
        guard let code = ProtoWire.pairingCode(fromLink: url.absoluteString) else { return }
        pair(method: "qr", code: code)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    let model = Model()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // A launch by restoration also logs `restore` from willRestoreState; that event is its reason.
        model.central.restoredLaunch = launchOptions?[.bluetoothCentrals] != nil
        model.log.log(.launch)
        return true
    }
}

@main
struct ProtoPhoneApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            ContentView(model: delegate.model)
                .onOpenURL { delegate.model.open($0) }
        }
    }
}
