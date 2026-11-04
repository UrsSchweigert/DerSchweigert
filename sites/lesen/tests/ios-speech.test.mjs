import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const site = new URL('../', import.meta.url);
const scene = await readFile(new URL('ios/App/App/SceneDelegate.swift', site), 'utf8');

test('iOS speech: the compiled scene uses a bridge with the local OfflineTts plugin', async () => {
  const project = await readFile(new URL('ios/App/App.xcodeproj/project.pbxproj', site), 'utf8');
  const sources = project.split('/* Begin PBXSourcesBuildPhase section */')[1]
    .split('/* End PBXSourcesBuildPhase section */')[0];
  assert.match(sources, /SceneDelegate\.swift in Sources/);
  assert.match(scene, /rootViewController = LesenBridgeViewController\(\)/);
  assert.match(scene, /class LesenBridgeViewController: CAPBridgeViewController/);
  assert.match(scene, /override func capacitorDidLoad\(\)[\s\S]*?bridge\?\.registerPluginInstance\(offlineTts\)/);
  assert.match(scene, /class OfflineTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate/);
  assert.match(scene, /let jsName = "OfflineTts"/);
  for (const name of ['initialize', 'listOfflineVoices', 'speak', 'stop']) {
    assert.ok(scene.includes(`CAPPluginMethod(name: "${name}", returnType: CAPPluginReturnPromise)`));
    assert.ok(scene.includes(`@objc func ${name}(_ call: CAPPluginCall)`));
  }
});

test('iOS speech: installed Apple de/en speech assets are eligible regardless of quality', () => {
  assert.match(scene, /AVSpeechSynthesisVoice\.speechVoices\(\)\.filter/);
  assert.doesNotMatch(scene, /voice\.quality == \.default/);
  assert.match(scene, /#available\(iOS 17\.0, \*\), !voice\.voiceTraits\.isEmpty/);
  assert.match(scene, /\["compact", "super-compact", "enhanced", "premium"\]/);
  assert.match(scene, /com\.apple\.ttsbundle\./);
  assert.match(scene, /\["-compact", "-enhanced", "-premium"\]/);
  assert.match(scene, /AVSpeechSynthesisVoice\(identifier: id\) != nil/);
  assert.match(scene, /primary == "de", locale == "de-de"/);
  assert.doesNotMatch(scene, /AVSpeechSynthesisVoice\(language:|requestPersonalVoiceAuthorization|URLSession/);
});

test('iOS speech: listed voices are probed for real audio before they are offered', () => {
  // iOS lists downloaded voices whose assets cannot synthesize (FB12994908).
  assert.match(scene, /prober\?\.write\(sample\)/);
  assert.match(scene, /\(buffer as\? AVAudioPCMBuffer\)\?\.frameLength \?\? 0\) > 0/);
  assert.match(scene, /@objc func listOfflineVoices[\s\S]*?usableVoices\(lang: lang\)/);
  assert.match(scene, /@objc func speak[\s\S]*?usableVoices\(lang: lang\)/);
});

test('iOS speech: shared adapter cancellation and native scene exit remain wired', async () => {
  const adapter = await readFile(new URL('static/speech-adapter.js', site), 'utf8');
  const html = await readFile(new URL('static/index.html', site), 'utf8');
  assert.match(adapter, /const plugin = win\.Capacitor\?\.Plugins\?\.OfflineTts/);
  assert.match(adapter, /await plugin\.stop\(\)/);
  assert.ok(/function markCard\([^)]*\)[\s\S]*?__speech\?\.cancel\(\)/.test(html),
    'marking a card cancels the shared native speech adapter');
  assert.ok(/function returnToSetup\([^)]*\)\s*\{\s*window\.__speech\?\.cancel\(\)/.test(html),
    'leaving practice cancels the shared native speech adapter');
  for (const callback of ['sceneWillResignActive', 'sceneDidEnterBackground', 'sceneDidDisconnect']) {
    assert.match(scene, new RegExp(`func ${callback}\\([^}]*setSceneActive\\(false\\)`));
  }
  assert.match(scene, /AVAudioSession\.interruptionNotification/);
  assert.match(scene, /AVAudioSession\.mediaServicesWereResetNotification/);
});

test('iOS speech: playback uses the application session and waits for actual completion', () => {
  assert.match(scene, /setCategory\(\.playback, mode: \.spokenAudio, options: \.duckOthers\)/);
  assert.match(scene, /usesApplicationAudioSession = true/);
  assert.match(scene, /setActive\(true\)/);
  assert.match(scene, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(scene, /stopSpeaking\(at: \.immediate\)/);
  // speak() can finish in silence with downloaded voices; speech is rendered and played by an engine.
  assert.doesNotMatch(scene, /synthesizer\?\.speak\(/);
  assert.match(scene, /synthesizer\?\.write\(next\)/);
  assert.match(scene, /scheduleBuffer\(copy, completionCallbackType: \.dataPlayedBack\)/);
  assert.match(scene, /func finishIfPlayedBack\(\)[\s\S]*?call\?\.resolve\(\["status": "finished"\]\)/);
  assert.match(scene, /\.AVAudioEngineConfigurationChange/);
  assert.match(scene, /Speech synthesis did not start/);
  assert.match(scene, /Thread\.isMainThread/);
  assert.doesNotMatch(scene, /try\?/);
});

test('iOS speech: production Swift behavior with native API doubles (not a device/audio test)', {
  skip: process.platform !== 'darwin' && 'requires the macOS Swift toolchain',
}, async t => {
  // Compile the actual plugin implementation, not a JS reimplementation of its policy.
  // Xcode separately checks the full scene against real Capacitor/AVFAudio/UIKit.
  const folder = new URL(`../.build/ios-speech-regression-${process.pid}/`, import.meta.url);
  await mkdir(folder, { recursive: true });
  try {
    const fixture = await readFile(new URL('fixtures/ios-speech-native.swift', import.meta.url), 'utf8');
    const pluginStart = scene.indexOf('@objc(OfflineTtsPlugin)');
    assert.ok(pluginStart > 0);
    const source = fixture.replace('// PRODUCTION_PLUGIN', scene.slice(pluginStart));
    const swift = fileURLToPath(new URL('main.swift', folder));
    const binary = fileURLToPath(new URL('native-regression', folder));
    const scratch = fileURLToPath(folder);
    await writeFile(swift, source);
    const options = { encoding: 'utf8', env: { ...process.env, TMPDIR: scratch }, timeout: 120_000 };
    try {
      execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', scratch, swift, '-o', binary], options);
      const output = execFileSync(binary, [], options);
      assert.match(output, /Native speech regression assertions passed: \d+/);
      t.diagnostic(output.trim());
    } catch (error) {
      assert.fail(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
