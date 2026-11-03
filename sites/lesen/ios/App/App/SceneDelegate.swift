import UIKit
import Capacitor
import AVFAudio

final class LesenBridgeViewController: CAPBridgeViewController {
    let offlineTts = OfflineTtsPlugin()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(offlineTts)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = LesenBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        (window?.rootViewController as? LesenBridgeViewController)?.offlineTts.setSceneActive(true)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        (window?.rootViewController as? LesenBridgeViewController)?.offlineTts.setSceneActive(false)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        (window?.rootViewController as? LesenBridgeViewController)?.offlineTts.setSceneActive(false)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        (window?.rootViewController as? LesenBridgeViewController)?.offlineTts.setSceneActive(false)
    }
}

@objc(OfflineTtsPlugin)
final class OfflineTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    let identifier = "OfflineTtsPlugin"
    let jsName = "OfflineTts"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listOfflineVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var synthesizer: AVSpeechSynthesizer?
    private var initialized = false
    private var sceneIsActive = false
    private var interrupted = false
    private var sessionActive = false
    private var utterance: AVSpeechUtterance?
    private var speechCall: CAPPluginCall?
    private var startTimeout: DispatchWorkItem?

    override func load() {
        onMain {
            NotificationCenter.default.addObserver(self, selector: #selector(self.audioInterrupted(_:)),
                                                   name: AVAudioSession.interruptionNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(self.audioServicesReset(_:)),
                                                   name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        startTimeout?.cancel()
        let synth = synthesizer
        let call = speechCall
        let wasActive = sessionActive
        Self.onMain {
            synth?.delegate = nil
            if let synth, synth.isSpeaking || synth.isPaused {
                if !synth.stopSpeaking(at: .immediate) {
                    CAPLog.print("OfflineTts: failed to stop speech during teardown.")
                }
            }
            call?.reject("Speech bridge was closed.", "OFFLINE_TTS")
            if wasActive {
                do {
                    try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                } catch {
                    CAPLog.print("OfflineTts: audio teardown failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        perform(call) {
            self.prepareSynthesizer()
            self.initialized = true
            call.resolve(["status": "ready", "languageAvailable": !self.offlineVoices(lang: "de-de").isEmpty])
        }
    }

    @objc func listOfflineVoices(_ call: CAPPluginCall) {
        perform(call) {
            try self.requireInitialized()
            let lang = try self.language(call)
            let voices = self.offlineVoices(lang: lang).map { voice -> [String: Any] in
                ["name": voice.name, "locale": voice.language, "networkRequired": false, "notInstalled": false]
            }
            call.resolve(["voices": voices, "suitableCount": voices.count])
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        perform(call) { [self] in
            try self.requireInitialized()
            guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw self.failure("text must be a non-empty string.")
            }
            let lang = try self.language(call)
            let rate = try self.number(call, key: "rate", defaultValue: 0.8, range: 0.1...2.0)
            let pitch = try self.number(call, key: "pitch", defaultValue: 1.0, range: 0.5...2.0)
            guard self.sceneIsActive, !self.interrupted else {
                throw self.failure("Speech is unavailable while the scene is inactive or audio is interrupted.")
            }

            try self.cancelSpeech()
            guard let voice = self.offlineVoices(lang: lang).first else {
                throw self.failure("No installed offline voice available for language: \(lang)")
            }
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try session.setActive(true)
            self.sessionActive = true
            self.prepareSynthesizer()

            let next = AVSpeechUtterance(string: text)
            next.voice = voice
            next.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                            max(AVSpeechUtteranceMinimumSpeechRate, Float(rate) * AVSpeechUtteranceDefaultSpeechRate))
            next.pitchMultiplier = Float(pitch)
            self.utterance = next
            self.speechCall = call
            let timeout = DispatchWorkItem { [weak self, weak next] in
                guard let self, let next, self.utterance === next else { return }
                self.failSpeech("Speech synthesis did not start.")
            }
            self.startTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
            self.synthesizer?.speak(next)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        perform(call) {
            try self.cancelSpeech()
            call.resolve()
        }
    }

    func setSceneActive(_ active: Bool) {
        onMain {
            self.sceneIsActive = active
            if !active { self.cancelForLifecycle() }
        }
    }

    @objc private func audioInterrupted(_ notification: Notification) {
        onMain {
            guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber,
                  let type = AVAudioSession.InterruptionType(rawValue: value.uintValue) else { return }
            self.interrupted = type == .began
            if self.interrupted { self.cancelForLifecycle() }
            // An ended interruption never restarts a card the learner may have left.
        }
    }

    @objc private func audioServicesReset(_ notification: Notification) {
        onMain {
            self.cancelForLifecycle()
            self.synthesizer?.delegate = nil
            self.synthesizer = nil
            self.sessionActive = false
            self.interrupted = false
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        onMain {
            guard self.utterance === utterance else { return }
            self.startTimeout?.cancel()
            self.startTimeout = nil
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onMain {
            guard self.utterance === utterance else { return }
            let call = self.takeSpeechCall()
            do {
                try self.deactivateSession()
                call?.resolve(["status": "finished"])
            } catch {
                call?.reject(error.localizedDescription, "OFFLINE_TTS", error)
            }
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        onMain {
            guard self.utterance === utterance else { return }
            self.failSpeech("Speech synthesis was unexpectedly cancelled.")
        }
    }

    private func prepareSynthesizer() {
        if synthesizer == nil {
            synthesizer = AVSpeechSynthesizer()
            synthesizer?.usesApplicationAudioSession = true
            synthesizer?.delegate = self
        }
    }

    private func offlineVoices(lang: String) -> [AVSpeechSynthesisVoice] {
        let primary = lang.split(separator: "-").first
        return AVSpeechSynthesisVoice.speechVoices().filter { voice in
            let locale = voice.language.replacingOccurrences(of: "_", with: "-").lowercased()
            guard locale.split(separator: "-").first == primary,
                  voice.quality == .default else { return false }
            if #available(iOS 17.0, *), !voice.voiceTraits.isEmpty { return false }
            // There is no public networkRequired flag. Fail closed to installed Apple compact
            // voices, not Siri/unknown identifiers. Provider voices are always .enhanced
            // (AVSpeechSynthesisProvider.h); personal/novelty voices are excluded above.
            let id = voice.identifier
            let compact = id.hasPrefix("com.apple.voice.compact.") ||
                (id.hasPrefix("com.apple.ttsbundle.") && id.hasSuffix("-compact"))
            return compact && AVSpeechSynthesisVoice(identifier: id) != nil
        }.sorted { left, right in
            func rank(_ voice: AVSpeechSynthesisVoice) -> Int {
                let locale = voice.language.replacingOccurrences(of: "_", with: "-").lowercased()
                if primary == "de", locale == "de-de" { return 0 }
                return locale == lang ? 1 : 2
            }
            let leftRank = rank(left), rightRank = rank(right)
            return leftRank == rightRank ? left.identifier < right.identifier : leftRank < rightRank
        }
    }

    private func language(_ call: CAPPluginCall) throws -> String {
        guard call.options["lang"] != nil else { return "de-de" }
        guard let value = call.getString("lang") else { throw failure("lang must be a de/en language tag.") }
        let lang = value.replacingOccurrences(of: "_", with: "-").lowercased()
        guard lang.range(of: "^(de|en)(-[a-z]{2})?$", options: .regularExpression) != nil else {
            throw failure("Only de/en language tags are supported.")
        }
        return lang
    }

    private func number(_ call: CAPPluginCall, key: String, defaultValue: Double, range: ClosedRange<Double>) throws -> Double {
        guard let raw = call.options[key] else { return defaultValue }
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, range.contains(number.doubleValue) else {
            throw failure("\(key) must be a finite number in \(range).")
        }
        return number.doubleValue
    }

    private func requireInitialized() throws {
        if !initialized { throw failure("TTS not initialized. Call initialize() first.") }
    }

    private func takeSpeechCall() -> CAPPluginCall? {
        let call = speechCall
        speechCall = nil
        utterance = nil
        startTimeout?.cancel()
        startTimeout = nil
        return call
    }

    private func deactivateSession() throws {
        if sessionActive {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
        }
    }

    private func cancelSpeech() throws {
        let hadUtterance = utterance != nil
        let call = takeSpeechCall()
        var failure: Error?
        if let synthesizer, hadUtterance || synthesizer.isSpeaking || synthesizer.isPaused {
            if !synthesizer.stopSpeaking(at: .immediate) {
                failure = self.failure("Failed to stop speech synthesis.")
            }
        }
        do {
            try deactivateSession()
        } catch {
            failure = error
        }
        if let failure {
            call?.reject(failure.localizedDescription, "OFFLINE_TTS", failure)
            throw failure
        }
        // Intentional cancellation is not a synthesis failure; the shared adapter must not
        // show an error on every card change. It is not reported as finished playback.
        call?.resolve(["status": "cancelled"])
    }

    private func cancelForLifecycle() {
        do {
            try cancelSpeech()
        } catch {
            CAPLog.print("OfflineTts: lifecycle cancellation failed: \(error.localizedDescription)")
        }
    }

    private func failSpeech(_ message: String) {
        let call = speechCall
        speechCall = nil
        do {
            try cancelSpeech()
            call?.reject(message, "OFFLINE_TTS")
        } catch {
            call?.reject("\(message) \(error.localizedDescription)", "OFFLINE_TTS", error)
        }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "OfflineTts", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func perform(_ call: CAPPluginCall, _ action: @escaping () throws -> Void) {
        onMain {
            do {
                try action()
            } catch {
                call.reject(error.localizedDescription, "OFFLINE_TTS", error)
            }
        }
    }

    private func onMain(_ action: @escaping () -> Void) {
        Self.onMain(action)
    }

    private static func onMain(_ action: @escaping () -> Void) {
        if Thread.isMainThread { action() } else { DispatchQueue.main.async(execute: action) }
    }
}
