# App Review notes — Buchstabenzeit for iOS

Bundle id `de.derschweigert.buchstabenzeit`, display name **Buchstabenzeit**
("Letter time"). The app is a guided reading exercise for children: an adult
picks letter cards, the child reads each card aloud, and the adult marks the
answer. It is a Capacitor 8.6.0 shell around the web app in `../static/`, built
as a universal iPhone/iPad app in German and English.

This file is the review package for the four native capabilities, an
airplane-mode demonstration a reviewer can follow without prior knowledge, and
the screenshot list. It also states exactly what the repository checks do **not**
prove, so nothing here is claimed beyond the build. App Store submission,
screenshots attached to the submission, and signing are maintainer actions; see
`RELEASING.md`.

## What the reviewer needs to know

- There is no account, no sign-in, no advertising, no analytics, and no network
  feature. Progress, settings and the parent report stay in the app container.
- The webview loads the bundled `www/` copy. `capacitor.config.json` has no
  `server.url`, and `npm run copy-assets` fails if the bundle depends on a
  remote script, stylesheet, import or fetch.
- German is the default language; the DE/EN buttons at the top right switch the
  whole interface, and the about dialog links to the language-matched bundled
  privacy page (`datenschutz.html` or `datenschutz-en.html`).
- Haptics and reminder delivery need a physical iPhone or iPad. The simulator
  has no haptics, no notification delivery and no real airplane mode, so
  simulator screenshots show layout only, never offline or tactile behaviour.
- Optional speech uses the registered native `OfflineTts` bridge with
  `AVSpeechSynthesizer`, a playback/spoken-audio session and ducking. Only
  enumerated, installed Apple compact DE/EN voices are admitted, preferring
  de-DE for German; unknown, Siri, provider and personal voices are excluded.
  Without a suitable voice the app explains the limitation and practice
  continues without audio. Website speech keeps its existing Web Speech path.

## The four native capabilities (the native spine)

The four approved capabilities are native speech, progress/report, reminders
and haptics. File writing and sharing are two parts of one report capability,
not substitutes for speech. The local speech plugin is registered from the
already compiled `SceneDelegate.swift`; the SPM project
(`App/CapApp-SPM/Package.swift`) links the other locked plugins below.
All four operate locally without an app server.

| # | Capability | Plugin (locked version) | Where a reviewer sees it | On-device only |
| --- | --- | --- | --- | --- |
| 1 | Native speech | Local `OfflineTts` / AVFAudio | Practice button "Vorlesen" / "Read aloud"; installed compact voices, rate/pitch, playback session and cancellation | Silent-switch, offline audio and interruption checks remain device gates |
| 2 | Progress + parent report | `@capacitor/filesystem` 8.1.5 + `@capacitor/share` 8.0.3 | Progress stays local. Footer "Bericht als CSV speichern" / "Save report as CSV" writes `buchstabenzeit-report.csv` into **CACHE**, resolves `getUri`, and opens the system share sheet | App-container write needs no permission; user chooses where to share |
| 3 | Practice reminders | `@capacitor/local-notifications` 8.3.1 | Footer "Übungserinnerungen" / "Practice reminders"; adult challenge, daily local time, opt-in and explicit Save | Off by default; no server or push; real delivery remains a device gate |
| 4 | Grading haptics | `@capacitor/haptics` 8.0.2 | Correct = `SUCCESS`, retry = `ERROR`; suppressed with Reduce Motion | Physical-device verification required |

A fifth locked plugin, `@capacitor/app` 8.1.2, supplies the native app identity
(about dialog version) and lifecycle events (stopping speech when the app is
backgrounded). It is infrastructure, not a user-facing capability, so it is not
counted among the four.

### Privacy alignment

`App/App/PrivacyInfo.xcprivacy` is registered in the App target's Resources
build phase and matches these capabilities:

- One required-reason API: `NSPrivacyAccessedAPICategoryFileTimestamp` with
  reason `C617.1`, for the Filesystem plugin reading metadata of files it
  writes in the app's own container (capability 2).
- `NSPrivacyTracking` is `false`, `NSPrivacyTrackingDomains` and
  `NSPrivacyCollectedDataTypes` are empty.
- No analytics or advertising SDK is linked. The audit and the re-check
  commands live in `PRIVACY-MANIFEST.md`; keep both files in step when plugins
  change.

## Airplane-mode demo script

Prerequisites: a signed build installed through TestFlight (or a development
build) on a physical iPhone, at least iOS 15 (the deployment target), and an
iPad if the universal layout is being checked. No prior knowledge of the app is
needed.

1. **Turn the network off.** Open Settings → Airplane Mode and switch it on.
   Also switch Wi-Fi off in Control Center so no known network is rejoined.
   **Expected:** the airplane icon appears in the status bar and the device has
   no cellular or Wi-Fi connection.
2. **Cold-launch offline.** Force-quit Buchstabenzeit (swipe up in the app
   switcher) and launch it again. **Expected:** the full setup screen appears
   with the heading "Lesen lernen, Karte für Karte.", the DE/EN buttons, the
   consonant/vowel/special letter groups, the card-count field and the
   "Lesen starten" button. No spinner, no blank page, no network error.
3. **Switch language.** Tap **EN** at the top right. **Expected:** the setup
   screen switches to English ("Learn to read, card by card.", "Start
   reading"); tap **DE** to switch back. The choice survives a relaunch.
4. **Start a deck.** Pick letters and a card count (defaults work: 10 cards) and
   tap "Lesen starten" / "Start reading". **Expected:** the practice screen
   "Deine Lesekarten" / "Your reading cards" shows one card, a progress bar and
   the counters "0 geschafft / 10 offen / 10 insgesamt" (English: "0 completed /
   10 remaining / 10 total").
5. **Grade with haptics.** Tap "Richtig gelesen" / "Read correctly".
   **Expected:** the card counts as done, the feedback line reads "Karte
   geschafft." / "Card completed.", and a physical device gives one short
   success pulse. On another card tap "Noch üben" / "Practice more":
   **Expected:** feedback "Versuch es noch einmal." / "Try again." and a
   distinctly different error pattern. Then enable Settings → Accessibility →
   Motion → Reduce Motion and grade again: **Expected:** no haptics at all.
6. **Finish the deck.** Grade or retry until the queue is empty (or tap
   "Auswahl" / "Selection" and confirm "Beenden" / "End"). **Expected:** the
   completion screen "Alle Karten geschafft!" / "All cards completed!".
7. **Export the parent report.** Tap "Bericht als CSV speichern" / "Save report
   as CSV" in the footer. **Expected:** the iOS share sheet opens for
   `buchstabenzeit-report.csv`, which was written to the app's cache directory
   (capability 2). Save it to Files or cancel; after the sheet closes the footer
   status reads "Bericht gespeichert." / "Report saved." (a failure reads
   "Bericht konnte nicht gespeichert werden." / "Report could not be saved.").
   **Expected:** nothing was uploaded and no permission prompt appeared.
8. **Check the universal layout.** Rotate the device, repeat on an iPad, and
   confirm the layout keeps clear of the notch/home indicator in portrait and
   landscape. **Expected:** the interface stays usable and matches the
   orientations declared in `Info.plist`.
9. **Read the bundled privacy page offline.** Tap "Rechtliches & Datenschutz"
   in the footer, then "Vollständige Datenschutzerklärung". **Expected:** the
   bundled German page `datenschutz.html` opens in the webview with no network
   request. Repeat in English for `datenschutz-en.html`. This navigates the
   webview to a separate local document with no in-app back button, so relaunch
   the app afterwards to return to setup. (The pages contain plain external
   attribution links; those naturally do not load while airplane mode is on —
   the page itself is local.)

A simulator run can cover steps 2–4, 6, 8 and 9 (layout and bundle) but not
the airplane-mode radio state, haptics, or share-sheet-to-Files behaviour of a
physical device.

## Native speech and reminder demonstration

1. In practice, tap **Vorlesen / Read aloud** with airplane mode and the silent
   switch on. An installed eligible voice should speak. With no suitable
   voice, the explanatory feedback must appear and grading must still work.
   Change cards, leave practice, lock/background the app and interrupt audio:
   stale cards must stop. After a call ends, a new tap can speak; an old card
   must not automatically restart.
2. In the footer, open **Übungserinnerungen / Practice reminders**. This entry
   is native-only; the ordinary website has no reminder control or browser
   notification prompt. Solve the adult multiplication challenge. An incorrect
   answer must not reveal settings or request permission. Closing or
   backgrounding locks the gate again; it is an adult UI gate, not identity
   authentication.
3. Check **Täglich ans Lesen erinnern / Remind me to read every day**, choose
   the approximate device-local time and press **Speichern / Save**. Only this
   explicit opt-in requests permission. Allow schedules one daily, inexact
   notification. Deny shows a settings explanation and never re-prompts on
   later saves. Permission can instead be changed in system settings.
4. Cold-launch: the saved time is restored without a permission prompt.
   Disable and save: the pending reminder is cancelled. A cancellation failure
   must display failure and retain the prior enabled state, not claim success.
   Confirm real delivery and cancellation on a physical device.

`tests/reminder-settings.test.mjs` exercises the actual mounted controller with
the real adapter and a native-plugin double; `tests/ios-speech.test.mjs` checks
registration and executes production Swift against API doubles on macOS.
Neither mocks nor a simulator build prove real-device audio or notifications.

## Offline screenshots

The repository does not contain airplane-mode or device screenshots, and this
package does not fabricate any. Capturing and attaching them is a maintainer
action on a simulator (layout) or physical device (offline proof). Keep the
files outside the checkout (for example in `/tmp/ios-review-screenshots/`): the
repository does not ignore screenshot files, so they must never be committed by
accident. Use these exact names so the App Review notes and the submission stay
consistent:

| File | Must show |
| --- | --- |
| `01-airplane-mode-on.png` | Settings or Control Center with Airplane Mode on and Wi-Fi off, airplane icon in the status bar |
| `02-cold-launch-setup-de.png` | Full German setup screen after a force-quit relaunch, no spinner or error |
| `03-setup-en.png` | The same setup screen after tapping EN |
| `04-privacy-page-en.png` | Bundled `datenschutz-en.html` open inside the app while still offline |
| `05-practice-card.png` | A practice card with the progress counters and the grade buttons |
| `06-share-sheet.png` | The iOS share sheet open for `buchstabenzeit-report.csv` |
| `07-report-saved.png` | Footer status "Bericht gespeichert." / "Report saved." after the sheet closes |
| `08-ipad-landscape.png` | The universal layout on iPad in landscape |
| `09-reminders-settings.png` | Adult-unlocked reminder time and saved status, without showing the challenge answer |

On a simulator, `xcrun simctl io booted screenshot <file>` captures layout only.
On a device, use the normal screenshot buttons. The only image currently
committed is the owner-uploaded simulator setup render at
`../assets/F2DF9B84-40E6-4028-8BE6-0464A61D8DC9.png`; it is not airplane-mode,
device, haptics or submission evidence, and the app does not reference it.

## What repository checks prove — and what they do not

Proven on Linux or in the maintainer-owned unsigned simulator CI job:

- `node --test tests/*.test.mjs` exercises shared behaviour, native bridge
  contracts, reminder gate, opt-in/denial, restart and cancellation failures.
- `npm run copy-assets` verifies the offline bundle is complete and free of
  remote app-load dependencies.
- `capacitor.config.json` has no `server.url`; the webview loads bundled assets.
- `Info.plist` parses with `CFBundleLocalizations` exactly `[de, en]`, and the
  project targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`).
- `PrivacyInfo.xcprivacy` parses, carries a reason for every required-reason
  category, and is in the App target's Resources build phase.
- The project compiles for a generic iOS Simulator destination with
  `CODE_SIGNING_ALLOWED=NO`.

Not proven by any of the above, and therefore not claimed here: distribution
signing, the `.ipa`, TestFlight install/upgrade, physical-device layout,
on-device speech and the silent switch, real haptics, notification delivery,
airplane-mode behaviour, and the screenshots above.

## Copy-paste block for App Store Connect

> Buchstabenzeit is a guided reading app for children. An adult selects letter
> cards and marks the child's answers; no account, no ads, no analytics, no
> network feature. The app is fully usable in airplane mode because the web
> bundle ships inside the app (no `server.url`).
>
> To review: enable Airplane Mode, force-quit and relaunch. Assemble a deck and
> start reading; "Read correctly" and "Practice more" give distinct haptics on a
> device (silent under Reduce Motion). "Save report as CSV" writes the report to
> the app cache and opens the system share sheet. Switch DE/EN at the top right;
> the privacy page is bundled and opens offline.
>
> "Read aloud" uses installed offline-capable native voices; without a suitable
> voice, reading practice still works without sound. "Practice reminders" in the
> footer opens an adult challenge, then an optional daily local reminder, off by
> default. Enable, select a time and Save to request notification permission.
> Denial is remembered without repeated prompts. No server or push service is
> involved. Device test and capture records must accompany submission.

## See also

- `RELEASING.md` — asset sync, signing, TestFlight, per-release device checks.
- `PRIVACY-MANIFEST.md` — required-reason audit behind `PrivacyInfo.xcprivacy`.
- `../RELEASING.md` — Android release process and shared plugin prerequisites.
