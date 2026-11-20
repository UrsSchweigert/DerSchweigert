import UserNotifications
import ProtoKit

/// The prototype check-in as a local notification. The computer tells the phone when it shows the check-in; an
/// answer on either device cancels the prompt on the other.
final class Checkins: NSObject, UNUserNotificationCenterDelegate {
    private let log: PhoneLog
    private let center = UNUserNotificationCenter.current()
    private var sync = CheckinSync()
    private var send: (ProtoWire.Message) -> Void = { _ in }
    private static let category = "checkin"

    init(log: PhoneLog) {
        self.log = log
        super.init()
        center.delegate = self
        let actions = ["Working", "Break", "Done"].map { UNNotificationAction(identifier: $0, title: $0) }
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.category, actions: actions,
                                                                 intentIdentifiers: [], options: [.customDismissAction])])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func attach(send: @escaping (ProtoWire.Message) -> Void) { self.send = send }

    func handle(_ message: ProtoWire.Message) {
        switch message {
        case let .checkinShown(id):
            _ = sync.handle(.shown, checkin: id)
            let content = UNMutableNotificationContent()
            content.title = "What are you doing?"
            content.categoryIdentifier = Self.category
            let request = UNNotificationRequest(identifier: id, content: content,
                                                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
            center.add(request) { [log] error in if error == nil { log.log(.notificationScheduled(id: id)) } }
        case let .checkinAnswered(id, _):
            if sync.handle(.answeredThere, checkin: id) {
                center.removePendingNotificationRequests(withIdentifiers: [id])
                center.removeDeliveredNotifications(withIdentifiers: [id])
                log.log(.notificationCancelled(id: id))
            }
        default: break
        }
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        log.log(.checkinShown(id: n.request.identifier))
        done([.banner, .sound])
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        let id = r.notification.request.identifier
        if r.actionIdentifier == UNNotificationDismissActionIdentifier {
            log.log(.checkinDismissed(id: id))
        } else {
            let answer = r.actionIdentifier == UNNotificationDefaultActionIdentifier ? "Opened" : r.actionIdentifier
            _ = sync.handle(.answeredHere, checkin: id)
            log.log(.checkinAnswered(id: id))
            send(.checkinAnswered(id: id, answer: answer))
        }
        done()
    }
}
