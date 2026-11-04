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
    // A speak call that is waiting for its voices to be probed.
    private var pendingSpeak: CAPPluginCall?
    private var prober: AVSpeechSynthesizer?
    private var voiceProbes: [String: Bool] = [:]
    private var probeWaiters: [String: [() -> Void]] = [:]
    private var probeTimeouts: [String: DispatchWorkItem] = [:]
    // Speech is rendered with write() and played by our own engine: on iOS 17+ speak()
    // can finish in silence with downloaded (enhanced/premium) voices in third-party apps.
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var renderEnded = false
    private var renderedFrames = 0
    private var queuedBuffers = 0

    override func load() {
        onMain {
            NotificationCenter.default.addObserver(self, selector: #selector(self.audioInterrupted(_:)),
                                                   name: AVAudioSession.interruptionNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(self.audioServicesReset(_:)),
                                                   name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(self.audioEngineChanged(_:)),
                                                   name: .AVAudioEngineConfigurationChange, object: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        startTimeout?.cancel()
        probeTimeouts.values.forEach { $0.cancel() }
        let synth = synthesizer
        let call = speechCall
        let pending = pendingSpeak
        let wasActive = sessionActive
        let player = self.player
        let engine = self.engine
        Self.onMain {
            synth?.delegate = nil
            if let synth, synth.isSpeaking || synth.isPaused {
                if !synth.stopSpeaking(at: .immediate) {
                    CAPLog.print("OfflineTts: failed to stop speech during teardown.")
                }
            }
            player?.stop()
            engine?.stop()
            call?.reject("Speech bridge was closed.", "OFFLINE_TTS")
            pending?.reject("Speech bridge was closed.", "OFFLINE_TTS")
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
            self.usableVoices(lang: lang) { usable in
                let voices = usable.map { voice -> [String: Any] in
                    ["name": voice.name, "locale": voice.language, "networkRequired": false, "notInstalled": false]
                }
                call.resolve(["voices": voices, "suitableCount": voices.count])
            }
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
            self.pendingSpeak = call
            self.usableVoices(lang: lang) { voices in
                // A newer speak, stop or lifecycle cancellation has already settled this call.
                guard self.pendingSpeak === call else { return }
                self.pendingSpeak = nil
                do {
                    guard self.sceneIsActive, !self.interrupted else {
                        throw self.failure("Speech is unavailable while the scene is inactive or audio is interrupted.")
                    }
                    guard let voice = voices.first else {
                        throw self.failure("No installed offline voice available for language: \(lang)")
                    }
                    try self.play(call, text: text, voice: voice, rate: rate, pitch: pitch)
                } catch {
                    call.reject(error.localizedDescription, "OFFLINE_TTS", error)
                }
            }
        }
    }

    private func play(_ call: CAPPluginCall, text: String, voice: AVSpeechSynthesisVoice,
                      rate: Double, pitch: Double) throws {
        CAPLog.print("OfflineTts: speaking with \(voice.identifier)")
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try session.setActive(true)
        sessionActive = true
        prepareSynthesizer()

        let next = AVSpeechUtterance(string: text)
        next.voice = voice
        next.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                        max(AVSpeechUtteranceMinimumSpeechRate, Float(rate) * AVSpeechUtteranceDefaultSpeechRate))
        next.pitchMultiplier = Float(pitch)
        utterance = next
        speechCall = call
        renderEnded = false
        renderedFrames = 0
        queuedBuffers = 0
        let timeout = DispatchWorkItem { [weak self, weak next] in
            guard let self, let next, self.utterance === next else { return }
            self.failSpeech("Speech synthesis did not start.")
        }
        startTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
        synthesizer?.write(next) { [weak self, weak next] buffer in
            self?.onMain {
                guard let self, let next, self.utterance === next else { return }
                self.render(buffer, of: next, voice: voice)
            }
        }
    }

    private func render(_ buffer: AVAudioBuffer, of next: AVSpeechUtterance, voice: AVSpeechSynthesisVoice) {
        guard let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 else {
            // The end-of-speech marker is an empty buffer and may be delivered more than once.
            guard !renderEnded else { return }
            renderEnded = true
            if renderedFrames == 0 {
                voiceProbes[voice.identifier] = false
                CAPLog.print("OfflineTts: \(voice.identifier) produced no audio and is skipped.")
                failSpeech("Speech synthesis produced no audio.")
            } else {
                finishIfPlayedBack()
            }
            return
        }
        do {
            let player = try startPlayback(sampleRate: pcm.format.sampleRate, channels: pcm.format.channelCount)
            let format = player.outputFormat(forBus: 0)
            guard let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: pcm.frameLength),
                  let converter = AVAudioConverter(from: pcm.format, to: format) else {
                throw failure("Unsupported speech audio format.")
            }
            // Copy: the synthesizer may reuse its buffer after the callback returns.
            try converter.convert(to: copy, from: pcm)
            renderedFrames += Int(pcm.frameLength)
            queuedBuffers += 1
            player.scheduleBuffer(copy, completionCallbackType: .dataPlayedBack) { [weak self, weak next] _ in
                self?.onMain {
                    guard let self, let next, self.utterance === next else { return }
                    self.queuedBuffers -= 1
                    self.finishIfPlayedBack()
                }
            }
        } catch {
            failSpeech(error.localizedDescription)
        }
    }

    private func startPlayback(sampleRate: Double, channels: AVAudioChannelCount) throws -> AVAudioPlayerNode {
        if let player { return player }
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels) else {
            throw failure("Unsupported speech audio format.")
        }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        try engine.start()
        self.engine = engine
        self.player = player
        player.play()
        startTimeout?.cancel()
        startTimeout = nil
        let session = AVAudioSession.sharedInstance()
        let route = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        CAPLog.print("OfflineTts: playing via \(route) at volume \(session.outputVolume)")
        return player
    }

    private func stopPlayback() {
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
    }

    private func finishIfPlayedBack() {
        guard renderEnded, queuedBuffers == 0 else { return }
        stopPlayback()
        let call = takeSpeechCall()
        do {
            try deactivateSession()
            call?.resolve(["status": "finished"])
        } catch {
            call?.reject(error.localizedDescription, "OFFLINE_TTS", error)
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
            if active {
                // The learner may have downloaded or repaired a voice in Settings meanwhile.
                self.voiceProbes = self.voiceProbes.filter { $0.value }
            } else {
                self.cancelForLifecycle()
            }
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

    @objc private func audioEngineChanged(_ notification: Notification) {
        onMain {
            // The engine stops itself on route/format changes, so queued audio would never finish.
            guard let engine = self.engine, notification.object as AnyObject? === engine else { return }
            self.cancelForLifecycle()
        }
    }

    @objc private func audioServicesReset(_ notification: Notification) {
        onMain {
            self.cancelForLifecycle()
            self.synthesizer?.delegate = nil
            self.synthesizer = nil
            self.voiceProbes.removeAll()
            if self.probeWaiters.isEmpty { self.prober = nil }
            self.sessionActive = false
            self.interrupted = false
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

    /// Eligible voices that actually produced audio. iOS keeps listing downloaded voices
    /// whose assets are missing or unusable offline (FB12994908); speaking with one ends
    /// immediately in silence, and there is no API to tell. Each voice is synthesized once
    /// into memory, without playback, and the result is cached.
    private func usableVoices(lang: String, _ completion: @escaping ([AVSpeechSynthesisVoice]) -> Void) {
        let candidates = offlineVoices(lang: lang)
        func check(_ index: Int) {
            guard index < candidates.count else {
                completion(candidates.filter { voiceProbes[$0.identifier] == true })
                return
            }
            probe(candidates[index]) { check(index + 1) }
        }
        check(0)
    }

    private func probe(_ voice: AVSpeechSynthesisVoice, _ done: @escaping () -> Void) {
        let id = voice.identifier
        if voiceProbes[id] != nil { return done() }
        if probeWaiters[id] != nil { probeWaiters[id]?.append(done); return }
        probeWaiters[id] = [done]
        if prober == nil { prober = AVSpeechSynthesizer() }
        let sample = AVSpeechUtterance(string: voice.language.lowercased().hasPrefix("de") ? "Hallo" : "Hello")
        sample.voice = voice
        var settled = false
        let settle = { [weak self] (usable: Bool) in
            self?.onMain {
                guard let self, !settled else { return }
                settled = true
                self.probeTimeouts.removeValue(forKey: id)?.cancel()
                self.voiceProbes[id] = usable
                if !usable { CAPLog.print("OfflineTts: \(id) produced no audio and is skipped.") }
                self.probeWaiters.removeValue(forKey: id)?.forEach { $0() }
            }
        }
        let timeout = DispatchWorkItem { settle(false) }
        probeTimeouts[id] = timeout
        // Generous: a downloaded neural voice can take seconds to load the first time.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
        // A working voice delivers audio frames first and an empty buffer only at the end;
        // an unusable voice delivers the empty end-of-speech buffer straight away.
        prober?.write(sample) { buffer in
            settle(((buffer as? AVAudioPCMBuffer)?.frameLength ?? 0) > 0)
        }
    }

    private func offlineVoices(lang: String) -> [AVSpeechSynthesisVoice] {
        let primary = lang.split(separator: "-").first
        return AVSpeechSynthesisVoice.speechVoices().filter { voice in
            let locale = voice.language.replacingOccurrences(of: "_", with: "-").lowercased()
            guard locale.split(separator: "-").first == primary else { return false }
            if #available(iOS 17.0, *), !voice.voiceTraits.isEmpty { return false }
            // Quality describes fidelity, not network requirements. Accept installed Apple
            // speech assets at every quality, but not Siri or third-party providers: iOS
            // exposes no networkRequired flag for those voices.
            let id = voice.identifier
            let appleAsset = ["compact", "super-compact", "enhanced", "premium"].contains {
                id.hasPrefix("com.apple.voice.\($0).")
            } || (id.hasPrefix("com.apple.ttsbundle.") &&
                ["-compact", "-enhanced", "-premium"].contains { id.hasSuffix($0) })
            return appleAsset && AVSpeechSynthesisVoice(identifier: id) != nil
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
        if let pending = pendingSpeak {
            pendingSpeak = nil
            pending.resolve(["status": "cancelled"])
        }
        let call = takeSpeechCall()
        var failure: Error?
        if let synthesizer, synthesizer.isSpeaking || synthesizer.isPaused {
            if !synthesizer.stopSpeaking(at: .immediate) {
                failure = self.failure("Failed to stop speech synthesis.")
            }
        }
        stopPlayback()
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
