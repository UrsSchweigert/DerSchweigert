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
    var producesAudio: Bool
    init(_ identifier: String, _ language: String, quality: Quality = .default,
         traits: Traits = [], installed: Bool = true, producesAudio: Bool = true) {
        self.identifier = identifier
        self.name = identifier
        self.language = language
        self.quality = quality
        self.voiceTraits = traits
        self.installed = installed
        self.producesAudio = producesAudio
    }
    convenience init?(identifier: String) {
        mainThread()
        guard let voice = Self.available.first(where: { $0.identifier == identifier && $0.installed }) else { return nil }
        self.init(voice.identifier, voice.language, quality: voice.quality, traits: voice.voiceTraits,
                  producesAudio: voice.producesAudio)
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
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance)
}
typealias AVAudioChannelCount = UInt32
final class AVAudioFormat: Equatable {
    let sampleRate: Double
    let channelCount: AVAudioChannelCount
    let isFloat: Bool
    init?(standardFormatWithSampleRate sampleRate: Double, channels: AVAudioChannelCount) {
        self.sampleRate = sampleRate
        channelCount = channels
        isFloat = true
    }
    init(int16SampleRate sampleRate: Double) {
        self.sampleRate = sampleRate
        channelCount = 1
        isFloat = false
    }
    static func == (left: AVAudioFormat, right: AVAudioFormat) -> Bool {
        left.sampleRate == right.sampleRate && left.channelCount == right.channelCount && left.isFloat == right.isFloat
    }
}
class AVAudioBuffer {}
class AVAudioPCMBuffer: AVAudioBuffer {
    // Synthesized speech arrives in this format; playback must convert and copy it.
    static var speechFormat = AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1)!
    let format: AVAudioFormat
    let frameCapacity: UInt32
    var frameLength: UInt32 = 0
    init?(pcmFormat: AVAudioFormat, frameCapacity: UInt32) {
        format = pcmFormat
        self.frameCapacity = frameCapacity
    }
    convenience init(frames: UInt32) {
        self.init(pcmFormat: Self.speechFormat, frameCapacity: max(frames, 1))!
        frameLength = frames
    }
}
final class AVAudioConverter {
    static var conversions = 0
    let from: AVAudioFormat
    let to: AVAudioFormat
    init?(from: AVAudioFormat, to: AVAudioFormat) { self.from = from; self.to = to }
    func convert(to output: AVAudioPCMBuffer, from input: AVAudioPCMBuffer) throws {
        expect(input.format == from && output.format == to && output.frameCapacity >= input.frameLength)
        Self.conversions += 1
        output.frameLength = input.frameLength
    }
}
class AVAudioNode {}
final class AVAudioMixerNode: AVAudioNode {}
final class AVAudioPlayerNode: AVAudioNode {
    enum CompletionCallbackType { case dataPlayedBack }
    static var instances: [AVAudioPlayerNode] = []
    var format: AVAudioFormat?
    var playing = false
    var scheduled: [(AVAudioPCMBuffer, (CompletionCallbackType) -> Void)] = []
    var playedFrames = 0
    override init() { super.init(); mainThread(); Self.instances.append(self) }
    func outputFormat(forBus bus: Int) -> AVAudioFormat { format! }
    func play() { mainThread(); playing = true }
    func scheduleBuffer(_ buffer: AVAudioPCMBuffer, completionCallbackType: CompletionCallbackType,
                        completionHandler: @escaping (CompletionCallbackType) -> Void) {
        mainThread()
        expect(buffer.format == format && buffer.frameLength > 0, "Only converted audio is scheduled")
        scheduled.append((buffer, completionHandler))
    }
    // Like the real node, stopping completes every buffer that was still queued.
    func stop() {
        mainThread()
        playing = false
        let pending = scheduled
        scheduled = []
        pending.forEach { $0.1(.dataPlayedBack) }
    }
    func playBack() {
        expect(playing, "Audio is only played back by a running player")
        while !scheduled.isEmpty {
            let (buffer, done) = scheduled.removeFirst()
            playedFrames += Int(buffer.frameLength)
            done(.dataPlayedBack)
        }
    }
}
final class AVAudioEngine {
    static var instances: [AVAudioEngine] = []
    static var failStart = false
    let mainMixerNode = AVAudioMixerNode()
    var attached: [AVAudioNode] = []
    var running = false
    init() { mainThread(); Self.instances.append(self) }
    func attach(_ node: AVAudioNode) { mainThread(); attached.append(node) }
    func connect(_ node: AVAudioNode, to mixer: AVAudioNode, format: AVAudioFormat?) {
        mainThread()
        expect(attached.contains { $0 === node } && mixer === mainMixerNode)
        (node as? AVAudioPlayerNode)?.format = format
    }
    func start() throws {
        mainThread()
        expect(AVAudioSession.shared.active, "The engine starts inside the active playback session")
        if Self.failStart { throw injectedError }
        running = true
    }
    func stop() { mainThread(); running = false }
}
extension Notification.Name {
    static let AVAudioEngineConfigurationChange = Notification.Name("engineConfigurationChange")
}
class AVSpeechSynthesizer {
    enum Boundary { case immediate }
    static var instances: [AVSpeechSynthesizer] = []
    // Holds syntheses back so tests can interleave calls with unfinished rendering.
    static var deferWrites = false
    static var pendingWrites: [() -> Void] = []
    static var probeWrites: [String] = []
    weak var delegate: AVSpeechSynthesizerDelegate?
    var usesApplicationAudioSession = false
    var isSpeaking = false
    var isPaused = false
    var current: AVSpeechUtterance?
    var stopSucceeds = true
    init() { mainThread(); Self.instances.append(self) }
    func speak(_ utterance: AVSpeechUtterance) {
        expect(false, "speak() is silent with downloaded voices on iOS 17+; speech must be rendered")
    }
    func write(_ utterance: AVSpeechUtterance, toBufferCallback callback: @escaping (AVAudioBuffer) -> Void) {
        mainThread()
        let voice = utterance.voice!
        if !usesApplicationAudioSession { Self.probeWrites.append(voice.identifier) }
        current = utterance
        isSpeaking = true
        let deliver = { [weak self] in
            guard let self, self.current === utterance else { return }
            if voice.producesAudio {
                callback(AVAudioPCMBuffer(frames: 240))
                callback(AVAudioPCMBuffer(frames: 120))
            }
            // Real synthesizers can repeat the empty end-of-speech marker.
            callback(AVAudioPCMBuffer(frames: 0))
            callback(AVAudioPCMBuffer(frames: 0))
            if self.current === utterance { self.isSpeaking = false }
        }
        if Self.deferWrites { Self.pendingWrites.append(deliver) } else { deliver() }
    }
    static func deliverWrites() {
        let pending = pendingWrites
        pendingWrites = []
        pending.forEach { $0() }
    }
    func stopSpeaking(at boundary: Boundary) -> Bool {
        mainThread()
        guard stopSucceeds else { return false }
        isSpeaking = false
        isPaused = false
        if let current { delegate?.speechSynthesizer(self, didCancel: current) }
        current = nil
        return true
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
    struct Port { struct PortType { let rawValue: String }; let portType: PortType }
    struct Route { let outputs: [Port] }
    var currentRoute = Route(outputs: [Port(portType: Port.PortType(rawValue: "Speaker"))])
    var outputVolume: Float = 0.5
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
func latestSynth() -> AVSpeechSynthesizer { AVSpeechSynthesizer.instances.last { $0.usesApplicationAudioSession }! }
func latestPlayer() -> AVAudioPlayerNode { AVAudioPlayerNode.instances.last! }
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
let enhancedAnna = "com.apple.voice.enhanced.Anna"
expect(AVSpeechSynthesizer.probeWrites == [enhancedAnna, samantha.identifier],
       "initialize probes the preferred German and English voice in the background")
let german = listed()
let germanVoices = german.result?["voices"] as! [[String: Any]]
expect(german.result?["suitableCount"] as? Int == 1, "Probing stops at the first working voice")
expect(germanVoices.first?["name"] as? String == enhancedAnna, "An enhanced voice beats a compact one")
expect(germanVoices.allSatisfy { $0["networkRequired"] as? Bool == false && $0["notInstalled"] as? Bool == false })
expect((listed("en_GB").result?["voices"] as! [[String: Any]]).first?["name"] as? String == british.identifier)
expect(AVSpeechSynthesizer.probeWrites == [enhancedAnna, samantha.identifier, british.identifier],
       "The warm-up result is reused")
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
expect(synth.current?.voice?.identifier == enhancedAnna)
expect(synth.current?.rate == 0.4 && synth.current?.pitchMultiplier == 1)
expect(session.active && session.category == .playback && session.mode == .spokenAudio)
expect(session.activationOptions == .duckOthers)
let firstEngine = AVAudioEngine.instances.last!
expect(firstEngine.running && latestPlayer().playing, "Rendered speech plays through the app's own engine")
expect(latestPlayer().format == AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1))
expect(latestPlayer().scheduled.count == 2, "Every rendered buffer is queued, end markers are not")
expect(first.result == nil && first.error == nil, "Rendering is not completion; playback is")
expect(CAPLog.messages.contains("OfflineTts: playing via Speaker at volume 0.5"))
latestPlayer().playBack()
expect(latestPlayer().playedFrames == 360)
expect(first.result?["status"] as? String == "finished")
expect(!firstEngine.running && !session.active && session.deactivationOptions == .notifyOthersOnDeactivation)

AVAudioPCMBuffer.speechFormat = AVAudioFormat(int16SampleRate: 24000)
let conversionsBefore = AVAudioConverter.conversions
let converted = speak()
expect(latestPlayer().format == AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1))
expect(AVAudioConverter.conversions == conversionsBefore + 2, "Integer speech is converted for playback")
latestPlayer().playBack()
expect(converted.result?["status"] as? String == "finished")
AVAudioPCMBuffer.speechFormat = AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1)!

AVSpeechSynthesizer.deferWrites = true
let previous = speak()
let replacement = speak(["text": "Hello", "lang": "en-GB", "rate": 1.2, "pitch": 1.1])
expect(previous.result?["status"] as? String == "cancelled")
expect(synth.current?.voice?.identifier == british.identifier)
AVSpeechSynthesizer.deliverWrites()
expect(session.active && replacement.result == nil, "Stale rendering cannot touch newer playback")
let replacedPlayer = latestPlayer()
expect(replacedPlayer.scheduled.count == 2)
expect(stop().result != nil)
expect(replacement.result?["status"] as? String == "cancelled")
expect(!session.active && !replacedPlayer.playing && AVAudioEngine.instances.last!.running == false)
expect(stop().result != nil)

let playing = speak()
AVSpeechSynthesizer.deliverWrites()
let stalePlayer = latestPlayer()
let newer = speak()
expect(playing.result?["status"] as? String == "cancelled" && stalePlayer.scheduled.isEmpty)
AVSpeechSynthesizer.deliverWrites()
expect(latestPlayer() !== stalePlayer && newer.result == nil, "Each utterance gets a fresh player")
NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: AVAudioEngine.instances.first!)
expect(newer.result == nil, "Changes of an old engine are ignored")
NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: AVAudioEngine.instances.last!)
expect(newer.result?["status"] as? String == "cancelled", "A route change ends speech instead of hanging")
expect(!session.active)
AVSpeechSynthesizer.deferWrites = false

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
expect(!latestPlayer().playing && !session.active, "Interruption end must not auto-resume")

session.failCategory = true
expect(speak().error?.contains("injected audio failure") == true)
session.failCategory = false
session.failActivation = true
expect(speak().error?.contains("injected audio failure") == true)
session.failActivation = false
AVAudioEngine.failStart = true
let engineFailure = speak()
expect(engineFailure.error?.contains("injected audio failure") == true && !session.active)
AVAudioEngine.failStart = false
let deactivationFailure = speak()
session.failDeactivation = true
latestPlayer().playBack()
expect(deactivationFailure.error?.contains("injected audio failure") == true)
session.failDeactivation = false
expect(stop().result != nil && !session.active, "Failed deactivation can be retried")
AVSpeechSynthesizer.deferWrites = true
let failedStop = speak()
synth.stopSucceeds = false
expect(stop().error?.contains("Failed to stop") == true)
expect(failedStop.error?.contains("Failed to stop") == true)
synth.stopSucceeds = true
expect(stop().result != nil && !session.active)

let unexpectedCancel = speak()
plugin.speechSynthesizer(synth, didCancel: synth.current!)
expect(unexpectedCancel.error?.contains("unexpectedly cancelled") == true)
let timedOut = speak()
let timeout = Mirror(reflecting: plugin).children.first { $0.label == "startTimeout" }!.value as! DispatchWorkItem
timeout.perform()
expect(timedOut.error?.contains("did not start") == true)
expect(!session.active && !synth.isSpeaking)
AVSpeechSynthesizer.pendingWrites = []
AVSpeechSynthesizer.deferWrites = false
let reset = speak()
NotificationCenter.default.post(name: AVAudioSession.mediaServicesWereResetNotification, object: session)
expect(reset.result?["status"] as? String == "cancelled")
let afterReset = speak()
expect(latestSynth() !== synth && latestSynth().usesApplicationAudioSession)
latestPlayer().playBack()
expect(afterReset.result?["status"] as? String == "finished")

AVSpeechSynthesisVoice.available = [samantha]
expect(listed().result?["suitableCount"] as? Int == 0)
expect(speak().error?.contains("No installed offline voice") == true)
let noGerman = CAPPluginCall()
plugin.initialize(noGerman)
expect(noGerman.result?["languageAvailable"] as? Bool == false)
expect(!session.active, "No default/network fallback without a matching offline voice")
let english = speak(["text": "Hello", "lang": "en-US"])
latestPlayer().playBack()
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
    latestPlayer().playBack()
    expect(playback.result?["status"] as? String == "finished")
}
AVSpeechSynthesisVoice.available = excludedVoices
expect(listed("de-DE").result?["suitableCount"] as? Int == 0)
expect(listed("en-US").result?["suitableCount"] as? Int == 0)
expect(speak().error?.contains("No installed offline voice") == true)

// Premium beats enhanced beats compact; lower-ranked voices are never probed once one works.
let compactKlara = AVSpeechSynthesisVoice("com.apple.voice.compact.de-DE.Klara", "de-DE")
let enhancedKlara = AVSpeechSynthesisVoice("com.apple.voice.enhanced.de-DE.Klara", "de-DE", quality: .enhanced)
let premiumKlara = AVSpeechSynthesisVoice("com.apple.voice.premium.de-DE.Klara", "de-DE", quality: .premium)
AVSpeechSynthesisVoice.available = [compactKlara, enhancedKlara, premiumKlara]
let probesBeforeQuality = AVSpeechSynthesizer.probeWrites.count
let qualitySpeak = speak()
expect(latestSynth().current?.voice?.identifier == premiumKlara.identifier, "Speak prefers a premium voice")
latestPlayer().playBack()
expect(qualitySpeak.result?["status"] as? String == "finished")
expect(Array(AVSpeechSynthesizer.probeWrites[probesBeforeQuality...]) == [premiumKlara.identifier])
AVSpeechSynthesisVoice.available = [compactKlara, enhancedKlara]
expect((listed("de-DE").result?["voices"] as! [[String: Any]]).first?["name"] as? String == enhancedKlara.identifier)

// iOS can list a downloaded voice that only yields silence (FB12994908); it must be skipped.
let silentEnhanced = AVSpeechSynthesisVoice("com.apple.voice.enhanced.de-DE.Markus", "de-DE",
                                            quality: .enhanced, producesAudio: false)
let workingCompact = AVSpeechSynthesisVoice("com.apple.voice.compact.de-DE.Markus", "de-DE")
AVSpeechSynthesisVoice.available = [silentEnhanced, workingCompact]
let probed = listed("de-DE")
expect(probed.result?["suitableCount"] as? Int == 1)
expect((probed.result?["voices"] as! [[String: Any]]).first?["name"] as? String == workingCompact.identifier)
expect(CAPLog.messages.contains { $0.contains(silentEnhanced.identifier) && $0.contains("no audio") })
let fallback = speak()
expect(latestSynth().current?.voice?.identifier == workingCompact.identifier, "Speak skips the silent voice")
latestPlayer().playBack()
expect(fallback.result?["status"] as? String == "finished")
let writesBefore = AVSpeechSynthesizer.probeWrites.count
expect(listed("de-DE").result?["suitableCount"] as? Int == 1)
let cachedSpeak = speak()
latestPlayer().playBack()
expect(cachedSpeak.result?["status"] as? String == "finished")
expect(AVSpeechSynthesizer.probeWrites.count == writesBefore, "Probe results are cached")
plugin.setSceneActive(false)
plugin.setSceneActive(true)
expect(listed("de-DE").result?["suitableCount"] as? Int == 1)
expect(Array(AVSpeechSynthesizer.probeWrites[writesBefore...]) == [silentEnhanced.identifier],
       "Returning from Settings re-probes only failed voices")

let silentOnly = AVSpeechSynthesisVoice("com.apple.voice.enhanced.de-DE.Helena", "de-DE",
                                        quality: .enhanced, producesAudio: false)
AVSpeechSynthesisVoice.available = [silentOnly]
expect(listed("de-DE").result?["suitableCount"] as? Int == 0)
expect(speak().error?.contains("No installed offline voice") == true)
expect(!session.active, "A silent voice never starts playback")

AVSpeechSynthesizer.deferWrites = true
let slowVoice = AVSpeechSynthesisVoice("com.apple.voice.compact.de-DE.Yannick", "de-DE")
AVSpeechSynthesisVoice.available = [slowVoice]
let waiting = speak()
expect(waiting.result == nil && waiting.error == nil, "Speak waits for the probe")
expect(stop().result != nil)
expect(waiting.result?["status"] as? String == "cancelled")
let waitingList = listed("de-DE")
let backgrounded = speak()
plugin.setSceneActive(false)
expect(backgrounded.result?["status"] as? String == "cancelled")
plugin.setSceneActive(true)
let superseded = speak()
let latestSpeak = speak()
expect(superseded.result?["status"] as? String == "cancelled")
AVSpeechSynthesizer.deliverWrites()
expect(AVSpeechSynthesizer.probeWrites.filter { $0 == slowVoice.identifier }.count == 1,
       "Concurrent requests share one probe")
expect(waitingList.result?["suitableCount"] as? Int == 1)
expect(latestSynth().current?.voice?.identifier == slowVoice.identifier)
AVSpeechSynthesizer.deliverWrites()
latestPlayer().playBack()
expect(latestSpeak.result?["status"] as? String == "finished")

let hangingVoice = AVSpeechSynthesisVoice("com.apple.voice.compact.de-DE.Hanging", "de-DE")
AVSpeechSynthesisVoice.available = [hangingVoice]
let hanging = speak()
let probeTimeouts = Mirror(reflecting: plugin).children.first { $0.label == "probeTimeouts" }!.value
    as! [String: DispatchWorkItem]
probeTimeouts[hangingVoice.identifier]!.perform()
expect(hanging.error?.contains("No installed offline voice") == true, "A probe that never answers fails")
AVSpeechSynthesizer.deliverWrites()
expect(listed("de-DE").result?["suitableCount"] as? Int == 0, "A late probe answer is ignored")
AVSpeechSynthesizer.deferWrites = false
expect(!session.active)

// A voice that passed its probe but renders nothing when speaking is rejected and skipped next time.
let flaky = AVSpeechSynthesisVoice("com.apple.voice.enhanced.de-DE.Flaky", "de-DE", quality: .enhanced)
AVSpeechSynthesisVoice.available = [flaky]
expect(listed("de-DE").result?["suitableCount"] as? Int == 1)
flaky.producesAudio = false
expect(speak().error?.contains("produced no audio") == true)
expect(!session.active)
expect(listed("de-DE").result?["suitableCount"] as? Int == 0)

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
