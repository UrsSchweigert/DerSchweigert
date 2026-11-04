import Foundation
import CoreFoundation

// Host-side doubles exercise production Swift control flow, not actual iOS speech output.
var assertions = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String = #function, line: Int = #line) {
    assertions += 1
    if !condition() { fatalError("Line \(line): \(message)") }
}
func mainThread() { expect(Thread.isMainThread, "Native speech/audio must run on main") }
let injectedError = NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "injected audio failure"])

class CAPPlugin: NSObject { func load() {} }
@objc protocol CAPBridgedPlugin {
    var identifier: String { get }
    var jsName: String { get }
    var pluginMethods: [CAPPluginMethod] { get }
}
class CAPPluginMethod: NSObject {
    init(name: String, returnType: String) {}
}
let CAPPluginReturnPromise = "promise"
enum CAPLog {
    static var messages: [String] = []
    static func print(_ message: String) { messages.append(message) }
}
class CAPPluginCall: NSObject {
    let options: [String: Any]
    var result: [String: Any]?
    var error: String?
    init(_ options: [String: Any] = [:]) { self.options = options }
    func getString(_ key: String) -> String? { options[key] as? String }
    func resolve(_ data: [String: Any] = [:]) {
        mainThread()
        expect(result == nil && error == nil, "Promise settled twice")
        result = data
    }
    func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil) {
        mainThread()
        expect(result == nil && self.error == nil, "Promise settled twice")
        self.error = message
    }
}

class AVSpeechSynthesisVoice {
    enum Quality { case `default`, enhanced, premium }
    struct Traits: OptionSet {
        let rawValue: Int
        static let isPersonalVoice = Traits(rawValue: 1)
        static let isNoveltyVoice = Traits(rawValue: 2)
    }
    static var available: [AVSpeechSynthesisVoice] = []
    let identifier: String
    let name: String
    let language: String
    let quality: Quality
    let voiceTraits: Traits
    let installed: Bool
    init(_ identifier: String, _ language: String, quality: Quality = .default,
         traits: Traits = [], installed: Bool = true) {
        self.identifier = identifier
        self.name = identifier
        self.language = language
        self.quality = quality
        self.voiceTraits = traits
        self.installed = installed
    }
    convenience init?(identifier: String) {
        mainThread()
        guard let voice = Self.available.first(where: { $0.identifier == identifier && $0.installed }) else { return nil }
        self.init(voice.identifier, voice.language, quality: voice.quality, traits: voice.voiceTraits)
    }
    static func speechVoices() -> [AVSpeechSynthesisVoice] { mainThread(); return available }
}
class AVSpeechUtterance {
    let text: String
    var voice: AVSpeechSynthesisVoice?
    var rate: Float = 0
    var pitchMultiplier: Float = 0
    init(string: String) { mainThread(); text = string }
}
let AVSpeechUtteranceDefaultSpeechRate: Float = 0.5
let AVSpeechUtteranceMinimumSpeechRate: Float = 0
let AVSpeechUtteranceMaximumSpeechRate: Float = 1
protocol AVSpeechSynthesizerDelegate: AnyObject {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance)
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance)
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance)
}
class AVSpeechSynthesizer {
    enum Boundary { case immediate }
    static var instances: [AVSpeechSynthesizer] = []
    weak var delegate: AVSpeechSynthesizerDelegate?
    var usesApplicationAudioSession = false
    var isSpeaking = false
    var isPaused = false
    var current: AVSpeechUtterance?
    var stopSucceeds = true
    init() { mainThread(); Self.instances.append(self) }
    func speak(_ utterance: AVSpeechUtterance) { mainThread(); isSpeaking = true; current = utterance }
    func stopSpeaking(at boundary: Boundary) -> Bool {
        mainThread()
        guard stopSucceeds else { return false }
        isSpeaking = false
        isPaused = false
        if let current { delegate?.speechSynthesizer(self, didCancel: current) }
        current = nil
        return true
    }
    func start() {
        mainThread()
        if let current { delegate?.speechSynthesizer(self, didStart: current) }
    }
    func finish() {
        mainThread()
        isSpeaking = false
        if let current { delegate?.speechSynthesizer(self, didFinish: current) }
        current = nil
    }
}
class AVAudioSession: NSObject {
    enum Category { case playback }
    enum Mode { case spokenAudio }
    enum InterruptionType: UInt { case began = 1, ended = 0 }
    struct Options: OptionSet {
        let rawValue: Int
        static let duckOthers = Options(rawValue: 1)
        static let notifyOthersOnDeactivation = Options(rawValue: 2)
    }
    static let interruptionNotification = Notification.Name("interruption")
    static let mediaServicesWereResetNotification = Notification.Name("reset")
    static let shared = AVAudioSession()
    static func sharedInstance() -> AVAudioSession { mainThread(); return shared }
    var active = false
    var category: Category?
    var mode: Mode?
    var activationOptions: Options = []
    var deactivationOptions: Options = []
    var failCategory = false
    var failActivation = false
    var failDeactivation = false
    func setCategory(_ category: Category, mode: Mode, options: Options) throws {
        mainThread()
        if failCategory { throw injectedError }
        self.category = category
        self.mode = mode
        activationOptions = options
    }
    func setActive(_ active: Bool, options: Options = []) throws {
        mainThread()
        if active ? failActivation : failDeactivation { throw injectedError }
        self.active = active
        if !active { deactivationOptions = options }
    }
}
let AVAudioSessionInterruptionTypeKey = "interruptionType"

// PRODUCTION_PLUGIN

let plugin = OfflineTtsPlugin()
plugin.load()
let session = AVAudioSession.shared
let anna = AVSpeechSynthesisVoice("com.apple.voice.compact.Anna", "de-DE")
let austrian = AVSpeechSynthesisVoice("com.apple.voice.compact.Austrian", "de_AT")
let samantha = AVSpeechSynthesisVoice("com.apple.voice.compact.Samantha", "en-US")
let british = AVSpeechSynthesisVoice("com.apple.ttsbundle.Daniel-compact", "en-GB")
AVSpeechSynthesisVoice.available = [
    austrian, british, samantha, anna,
    AVSpeechSynthesisVoice("com.provider.Network", "de-DE"),
    AVSpeechSynthesisVoice("com.apple.voice.enhanced.Anna", "de-DE", quality: .enhanced),
    AVSpeechSynthesisVoice("com.provider.Enhanced", "de-DE", quality: .enhanced),
    AVSpeechSynthesisVoice("com.apple.ttsbundle.siri_unknown", "de-DE"),
    AVSpeechSynthesisVoice("com.apple.voice.compact.Personal", "de-DE", traits: .isPersonalVoice),
    AVSpeechSynthesisVoice("com.apple.voice.compact.Novelty", "de-DE", traits: .isNoveltyVoice),
    AVSpeechSynthesisVoice("com.apple.voice.compact.Missing", "de-DE", installed: false)
]
func speak(_ options: [String: Any] = ["text": "Hallo"]) -> CAPPluginCall {
    let call = CAPPluginCall(options)
    plugin.speak(call)
    return call
}
func stop() -> CAPPluginCall {
    let call = CAPPluginCall()
    plugin.stop(call)
    return call
}
func latestSynth() -> AVSpeechSynthesizer { AVSpeechSynthesizer.instances.last! }
func listed(_ lang: Any? = nil) -> CAPPluginCall {
    let call = CAPPluginCall(lang.map { ["lang": $0] } ?? [:])
    plugin.listOfflineVoices(call)
    return call
}

expect(speak().error?.contains("not initialized") == true)
expect(listed().error?.contains("not initialized") == true)
expect(stop().result != nil, "stop is safely idempotent before warm()")
let initialized = CAPPluginCall()
plugin.initialize(initialized)
expect(initialized.result?["status"] as? String == "ready")
expect(initialized.result?["languageAvailable"] as? Bool == true)
expect(latestSynth().usesApplicationAudioSession)
let german = listed()
let germanVoices = german.result?["voices"] as! [[String: Any]]
expect(german.result?["suitableCount"] as? Int == 3)
expect(germanVoices.first?["name"] as? String == anna.identifier)
expect(germanVoices.allSatisfy { $0["networkRequired"] as? Bool == false && $0["notInstalled"] as? Bool == false })
expect(listed("en_GB").result?["suitableCount"] as? Int == 2)
for bad in ["", "fr-FR", "english", "de-DE-bogus", " de", "en--US", "deutsch"] {
    expect(listed(bad).error != nil, "Reject malformed/unsupported language \(bad)")
}
expect(listed(NSNumber(value: 1)).error != nil)
expect(listed(NSNull()).error != nil)
expect(speak().error?.contains("inactive") == true)
plugin.setSceneActive(true)
for bad in [[:], ["text": ""], ["text": " \n"], ["text": 1],
            ["text": "a", "rate": "0.8"], ["text": "a", "rate": true],
            ["text": "a", "pitch": NSNull()], ["text": "a", "rate": Double.nan],
            ["text": "a", "rate": Double.infinity], ["text": "a", "rate": 0.0],
            ["text": "a", "pitch": 2.1], ["text": "a", "lang": "fr-FR"]] as [[String: Any]] {
    expect(speak(bad).error != nil, "Invalid values must not silently default or clamp")
}
let first = speak()
let synth = latestSynth()
expect(first.result == nil && first.error == nil, "No pretend success before playback")
expect(synth.current?.voice?.identifier == anna.identifier)
expect(synth.current?.rate == 0.4 && synth.current?.pitchMultiplier == 1)
expect(session.active && session.category == .playback && session.mode == .spokenAudio)
expect(session.activationOptions == .duckOthers)
synth.start()
expect(first.result == nil, "Start is not completion")
synth.finish()
expect(first.result?["status"] as? String == "finished")
expect(!session.active && session.deactivationOptions == .notifyOthersOnDeactivation)

let previous = speak()
let previousUtterance = synth.current!
let replacement = speak(["text": "Hello", "lang": "en-GB", "rate": 1.2, "pitch": 1.1])
expect(previous.result?["status"] as? String == "cancelled")
expect(synth.current?.voice?.identifier == british.identifier)
plugin.speechSynthesizer(synth, didFinish: previousUtterance)
expect(session.active && replacement.result == nil, "Stale callbacks cannot deactivate newer playback")
expect(stop().result != nil)
expect(replacement.result?["status"] as? String == "cancelled")
expect(!session.active && !synth.isSpeaking)
expect(stop().result != nil)

let background = speak()
plugin.setSceneActive(false)
expect(background.result?["status"] as? String == "cancelled")
expect(!session.active)
expect(speak().error != nil, "Queued JS cannot restart background audio")
plugin.setSceneActive(true)
let interrupted = speak()
NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: session,
                                userInfo: [AVAudioSessionInterruptionTypeKey: NSNumber(value: 1)])
expect(interrupted.result?["status"] as? String == "cancelled")
expect(!session.active && speak().error != nil)
NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: session,
                                userInfo: [AVAudioSessionInterruptionTypeKey: NSNumber(value: 0)])
expect(!synth.isSpeaking && !session.active, "Interruption end must not auto-resume")

session.failCategory = true
expect(speak().error?.contains("injected audio failure") == true)
session.failCategory = false
session.failActivation = true
expect(speak().error?.contains("injected audio failure") == true)
session.failActivation = false
let deactivationFailure = speak()
session.failDeactivation = true
synth.finish()
expect(deactivationFailure.error?.contains("injected audio failure") == true)
session.failDeactivation = false
expect(stop().result != nil && !session.active, "Failed deactivation can be retried")
let failedStop = speak()
synth.stopSucceeds = false
expect(stop().error?.contains("Failed to stop") == true)
expect(failedStop.error?.contains("Failed to stop") == true)
synth.stopSucceeds = true
expect(stop().result != nil && !session.active)

let unexpectedCancel = speak()
synth.isSpeaking = false
plugin.speechSynthesizer(synth, didCancel: synth.current!)
expect(unexpectedCancel.error?.contains("unexpectedly cancelled") == true)
let timedOut = speak()
let timeout = Mirror(reflecting: plugin).children.first { $0.label == "startTimeout" }!.value as! DispatchWorkItem
timeout.perform()
expect(timedOut.error?.contains("did not start") == true)
expect(!session.active && !synth.isSpeaking)
let reset = speak()
NotificationCenter.default.post(name: AVAudioSession.mediaServicesWereResetNotification, object: session)
expect(reset.result?["status"] as? String == "cancelled")
let afterReset = speak()
expect(latestSynth() !== synth && latestSynth().usesApplicationAudioSession)
latestSynth().finish()
expect(afterReset.result?["status"] as? String == "finished")

AVSpeechSynthesisVoice.available = [samantha]
expect(listed().result?["suitableCount"] as? Int == 0)
expect(speak().error?.contains("No installed offline voice") == true)
let noGerman = CAPPluginCall()
plugin.initialize(noGerman)
expect(noGerman.result?["languageAvailable"] as? Bool == false)
expect(!session.active, "No default/network fallback without a matching offline voice")
let english = speak(["text": "Hello", "lang": "en-US"])
latestSynth().finish()
expect(english.result?["status"] as? String == "finished")

let excludedVoices = [
    AVSpeechSynthesisVoice("com.provider.Network", "de-DE"),
    AVSpeechSynthesisVoice("com.provider.Enhanced", "de-DE", quality: .enhanced),
    AVSpeechSynthesisVoice("com.apple.ttsbundle.siri_unknown", "de-DE"),
    AVSpeechSynthesisVoice("com.apple.voice.compact.Personal", "de-DE", traits: .isPersonalVoice),
    AVSpeechSynthesisVoice("com.apple.voice.premium.Novelty", "de-DE", quality: .premium, traits: .isNoveltyVoice),
    AVSpeechSynthesisVoice("com.apple.voice.enhanced.Missing", "de-DE", quality: .enhanced, installed: false),
    AVSpeechSynthesisVoice("com.apple.voice.premium.Missing", "en-US", quality: .premium, installed: false)
]
for (identifier, lang, quality) in [
    ("com.apple.voice.enhanced.de-DE.Anna", "de-DE", AVSpeechSynthesisVoice.Quality.enhanced),
    ("com.apple.voice.premium.de-DE.Petra", "de-DE", .premium),
    ("com.apple.voice.enhanced.en-US.Samantha", "en-US", .enhanced),
    ("com.apple.voice.premium.en-GB.Daniel", "en-GB", .premium),
    ("com.apple.ttsbundle.Anna-premium", "de-DE", .enhanced),
    ("com.apple.ttsbundle.Daniel-enhanced", "en-GB", .enhanced),
    ("com.apple.voice.super-compact.de-DE.Anna", "de-DE", .default)
] {
    let downloaded = AVSpeechSynthesisVoice(identifier, lang, quality: quality)
    AVSpeechSynthesisVoice.available = excludedVoices + [downloaded]
    let voices = listed(lang).result?["voices"] as! [[String: Any]]
    expect(voices.count == 1 && voices.first?["name"] as? String == identifier,
           "A downloaded Apple voice must be usable without a compact voice: \(identifier)")
    let playback = speak(["text": "Test", "lang": lang])
    expect(playback.error == nil && latestSynth().current?.voice?.identifier == identifier)
    latestSynth().finish()
    expect(playback.result?["status"] as? String == "finished")
}
AVSpeechSynthesisVoice.available = excludedVoices
expect(listed("de-DE").result?["suitableCount"] as? Int == 0)
expect(listed("en-US").result?["suitableCount"] as? Int == 0)
expect(speak().error?.contains("No installed offline voice") == true)

var offMainCall: CAPPluginCall?
DispatchQueue.global().async {
    let call = CAPPluginCall()
    plugin.initialize(call)
    DispatchQueue.main.async { offMainCall = call }
}
let deadline = Date().addingTimeInterval(5)
while offMainCall == nil && Date() < deadline {
    RunLoop.main.run(until: Date().addingTimeInterval(0.01))
}
expect(offMainCall?.result?["status"] as? String == "ready", "Bridge work marshals to main")
print("Native speech regression assertions passed: \(assertions)")
