# Buchstabenzeit: iOS release plan

Written: 2026-11-03
Status: **proposal only.** Nothing is implemented, nothing is approved, no harness plan exists.
Companion document: [ANDROID-PLAN.md](./ANDROID-PLAN.md) (Android release) and [RELEASING.md](./RELEASING.md).

This document is written to be handed to the harness later: phases, issues, acceptance criteria, verification, and —
in section 7 — the changes the harness and its environment need before such a plan can be executed.

---

## 1. Goal and agreed scope

Ship the same learning app as a one-time paid iOS app, built and signed in CI, so that the owner's only remaining step
is review-free: verify the TestFlight build, press **Submit for Review**, later press **Release**.

Owner decisions already taken (2026-11-03):

| Decision | Value |
|---|---|
| App Store category framing | **Education** (not Kids Category) |
| Price | **Paid once** (like Android) |
| Native capabilities | **all four**: native speech, progress + parent report, local reminders, haptics |
| Harness role | implements everything except Apple paperwork and review submission |

Scope boundaries, inherited from the Android plan and still valid:

- One shared application for three channels: website, Android, iOS. `static/` stays the single source.
- The app contains all exercises, vocabulary, fonts, images and legal notices; core practice works on first launch with
  no network, no account, no backend.
- No bundled recordings, no speech model, no required voice download. Device TTS only; if no suitable voice exists, the
  app says so and the exercise continues without audio.
- Nothing secret is ever committed.

Out of scope for v1: Apple Pencil/handwriting, widgets, Live Activities, iCloud sync, in-app purchases, App Store
subscription.

### 1.0 Languages: the app is already bilingual, the *listing* is not

This is a distinction the first draft of this document got wrong. German **and** English already ship inside the app:
`static/i18n.mjs` holds both dictionaries, `index.html` has a DE/EN switch, the content is in `sentences/de.json` and
`sentences/en.json`, and the privacy link already resolves per language
(`datenschutz-en.html` for English). Nothing about iOS removes that — the bundle carries both.

What is German-only in v1 is the **App Store listing**: description, keywords, screenshots and the review notes. The
product is German reading material — German letters, `Silbenmuster`, German vocabulary, the order in which German
schools introduce letters. An English listing would advertise that to an audience that cannot use it, and every extra
locale needs its own description, keyword set and screenshot set to be worth having. Adding a locale later costs no new
binary: it is App Store Connect metadata only.

One consequence that must not be forgotten, and is now part of `ios-shell`: `Info.plist` needs
`CFBundleLocalizations = [de, en]` (plus `CFBundleDevelopmentRegion`). Without it iOS reports the app as German-only, the
per-app language setting never offers English, and a reviewer may not see the English UI at all.

### 1.1 Toolchain state, measured on 2026-11-03

| Component | Version |
|---|---|
| macOS | 26.6.2 |
| Xcode | 27.2 (27B52), developer dir `/Applications/Xcode.app/Contents/Developer` |
| iOS SDK / simulator runtime | 27.2 (`iphoneos27.2`, `iphonesimulator27.2`), devices available |
| CocoaPods | 1.17.0 |
| Node / npm | 24.14.1 / 11.11.0 on the host, 22 in the worker image |
| Codesigning identities | none yet (Xcode → Settings → Accounts not set up) |

Two results from building a throwaway shell with this exact toolchain. Both are plan-changing:

1. **Capacitor 6.2.1 (today's pin) no longer builds under Xcode 27.** Its template sets
   `IPHONEOS_DEPLOYMENT_TARGET = 13.0`, and Xcode 27 supports 15.0 and later only. It builds after three edits
   (`Podfile` platform, the app target's four build settings, and a `post_install` hook forcing the Capacitor pods to
   15.0, because the podspec still declares 13.0). `BUILD SUCCEEDED` was confirmed with those edits.
2. **Capacitor 6.2.1 no longer runs on current iOS even when built.** Its `Info.plist` has no
   `UIApplicationSceneManifest`; an app linked against the iOS 26+ SDK must adopt the UIScene lifecycle, and without it the
   process is terminated right after launch — no crash report, just a silent exit. Reproduced: install, launch, home
   screen.
3. **Capacitor 8.6.0 works with this toolchain unchanged.** Generated project: deployment target 15.0, SPM instead of
   CocoaPods, `UIApplicationSceneManifest` present. Built and launched in the simulator without edits.

Consequence: **the iOS release requires a Capacitor 6 → 8 upgrade first**, and that upgrade is shared with the Android
channel. Phase I0 below exists for exactly that reason, and every other phase depends on it.

---

## 2. Why this is not a wrapper (Guideline 4.2)

App Review rejects two shapes: (a) an app that loads a remote URL, and (b) an app whose feature set is identical to the
public website. This project avoids (a) by construction — bundled assets, no backend. It must also avoid (b), and that is
the purpose of the native spine.

Each capability below is impossible in Safari/WKWebView, which is exactly the argument that decides 4.2:

| Capability | What the website cannot do |
|---|---|
| **Native speech bridge** | Enumerate installed German voices, set rate and pitch, keep speaking **with the silent switch on** (audio session `playback`), duck other audio, resume after a call |
| **On-device progress + parent report** | Persistent local progress store, export a report as CSV into Files/Mail through the share sheet, restore from backup |
| **Local practice reminders** | Scheduled local notifications without any server or push infrastructure |
| **Grading haptics** | Distinct tactile feedback for correct/incorrect, suppressed under "Reduce Motion" |

Review defence (issue 9) turns these into the artefacts a reviewer reads: App Review Notes naming the four capabilities,
an airplane-mode demo script, and screenshots taken offline.

Residual risk, stated honestly: the app's *content* is the same as the website's. The spine is what makes the App Store
version a different product rather than a packaging of the other one.

---

## 3. Architecture

```text
static/  (shared source: index.html, *.mjs, sentences/, books/, fonts/, images/)
   |
   +--> website deployment          lesen.derschweigert.de            (unchanged)
   |
   +--> scripts/copy-assets.mjs --> www/ --> cap sync android --> .aab
   |                                    \--> cap sync ios     --> .ipa
   |
   +--> platform adapters (new)
            web     : Web Speech API, localStorage        (today's behaviour, unchanged)
            android : native speech, notifications, haptics, filesystem/share
            ios     : same adapter contract, iOS plugin implementations
```

Rules:

- `static/` keeps working for the website. Every adapter has a web implementation that preserves current behaviour.
- Native capability is reached only through the adapter contract; no UI code calls a Capacitor plugin directly.
- The iOS shell is generated and maintained by Capacitor. **No hand-edited `project.pbxproj`.** Plugins are added by
  `npm install` + `cap sync`, which does the native wiring. Capacitor 8 integrates plugins through **Swift Package
  Manager** (`CapApp-SPM`, `Package.swift`) — there is no Podfile and no `pod install`, which also removes that step from CI.
- Signing material lives only in GitHub secrets. `sites/lesen/ios/App/App/Info.plist` and `PrivacyInfo.xcprivacy` are
  committed; certificates, profiles and API keys never are.

Verification model, and the constraint behind it:

| Layer | Runs where | What it proves |
|---|---|---|
| Unit tests (`node --test`) | worker sandbox (Linux container) | adapter contract, storage migration, report generation, no remote-URL regression |
| Static iOS shell check | worker sandbox (new, see 7.2) | plists parse, privacy manifest present, offline-only bundle |
| `npm ci` + `cap sync` | worker sandbox for web/JS only | dependency lock consistency |
| **Build, sign, `.ipa`, TestFlight upload** | **GitHub Actions `macos-14`** | the app actually builds and signs |
| Device sanity (speech with silent switch, notifications, haptics) | human, one TestFlight build per release | behaviour that no automated check can see |
| Local build (Simulator, or a real device with a free Apple ID) | host Mac, once Xcode is set up | a *development aid*: fastest feedback on the shell and the plugin wiring. Not an authority — it is neither reproducible nor a signed release |

iOS cannot be built or signed in the worker sandbox: it is a Debian container, and CocoaPods/Xcode are macOS-only. The
CI workflow (issue 8) is therefore the real gate, and section 7.4 covers what the harness must do to treat it as evidence.

---

## 4. Phases and issues

Ten issues in four phases. Issue ids carry an `ios-` prefix so their branches (`harness/ios-…`) can never collide with
another plan's branches in the same repository.

### Phase I0 — Capacitor upgrade (prerequisite, shared with Android)

| Issue | Scope | Acceptance |
|---|---|---|
| `ios-capacitor-8` | `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios` from 6.2.1 to 8.x; iOS uses SPM, Android project resynced and built; Node engine raised to >=20 (worker image already has 22) | `npm ci` reproduces; `cap sync android` builds the `.aab`; `cap add ios` + simulator build and launch succeed; website untouched |

Phase I0 must land before I1–I4: on the current pin the iOS app cannot start at all, and an Android regression here would
block two channels at once. Keep the upgrade in its own phase so a single revert is possible.

### Phase I1 — Shared core (keeps website and Android green)

| Issue | Scope | Acceptance |
|---|---|---|
| `ios-adapter-contract` | One interface for `speech`, `progress`, `reminders`, `haptics` in `static/`; web implementations move today's behaviour behind it | Website behaves identically; existing tests pass unchanged; adapters are unit-tested with fakes |
| `ios-storage-v3` | IndexedDB-backed progress store with migration from the `localStorage` schema v2 in `storage.mjs`; export/restore document | v2 data migrates without loss; unknown versions read as empty; round-trip restore test |
| `ios-parent-report` | On-device summary of attempts, accuracy and practice time; CSV export through Filesystem + Share | Report bytes match a golden fixture; export needs no network |

### Phase I2 — iOS shell

| Issue | Scope | Acceptance |
|---|---|---|
| `ios-shell` | `cap add ios`, `capacitor.config.json` iOS section, `Info.plist` strings, `CFBundleLocalizations = [de, en]`, app icons, universal (iPhone + iPad) layout | `www/` bundles with no `server.url`; icons generated by `@capacitor/assets`; layout passes the existing visual checks; the DE/EN switch and the language-matched privacy page work in the simulator |
| `ios-privacy-manifest` | `PrivacyInfo.xcprivacy` with required-reason API declarations, matched to actual behaviour (on-device only) | Manifest parses; every declared reason is justified in a comment; no tracking domains |

### Phase I3 — Native spine

| Issue | Scope | Acceptance |
|---|---|---|
| `ios-speech-native` | `@capacitor-community/text-to-speech` integration: German voice selection, rate/pitch, audio session `playback`, graceful degraded path | Silent-switch behaviour documented and verified on device; no German voice → explicit message, exercise continues |
| `ios-reminders` | `@capacitor/local-notifications` practice reminders, behind a parental gate, default off | Permission denied → no prompt loop; reminders survive restart; gate cannot be bypassed by a child |
| `ios-haptics` | `@capacitor/haptics` on grading, honouring "Reduce Motion" | No haptics when Reduce Motion is on; distinct patterns for correct/incorrect |

### Phase I4 — Release and review

| Issue | Scope | Acceptance |
|---|---|---|
| `ios-release-workflow` | `.github/workflows/ios-release.yml`: `workflow_dispatch` with version inputs, `macos-14`, signing from secrets, `.ipa` artifact, automatic TestFlight upload | Green run produces a signed `.ipa` and a TestFlight build without any local Xcode |
| `ios-review-package` | App Review Notes naming the four capabilities, airplane-mode demo script, offline screenshots, `RELEASING.md` iOS section | A reviewer can follow the script without prior knowledge; every claim in the notes is true of the build |

Sequencing notes:

- I1 before I2: the adapter contract must exist before the shell wires iOS implementations.
- I2 before I3: plugins need a shell and a bundle identifier.
- I4 last, except `RELEASING.md`, which can be drafted as soon as the secrets exist.

Word-level highlight while reading aloud (the `willSpeakRangeOfSpeechString` callback) is **not** in v1: the community
plugin does not expose it. If it becomes important, it needs a small hand-written Swift bridge, which is owner work
outside the harness (section 7.7).

---

## 5. Owner checklist (the only part that cannot be delegated)

One-time, before the plan can be verified end to end:

1. **Apple Developer Program** membership (individual or organisation; an organisation needs a D-U-N-S number). The seller
   name is legally binding and is what parents see.
2. **App Store Connect app record** created, with the bundle identifier — reuse `de.derschweigert.buchstabenzeit` or use a
   distinct iOS id (if you reuse it, register it for iOS in the developer portal).
0. **Xcode is set up** (done 2026-11-03): `xcode-select -s`, license accepted, `-runFirstLaunch`, iOS 27.2 runtime
   installed. Add your Apple ID under Xcode → Settings → Accounts — that is what creates a development certificate and
   makes a free 7-day device build possible. CocoaPods is installed but **not needed**: Capacitor 8 uses SPM.
3. **Signing**, one of two shapes, stored as GitHub secrets (both can be produced locally from Xcode — no portal export
   needed):
   - distribution certificate (`.p12` + password) and an App Store provisioning profile (`.mobileprovision`), or
   - an **App Store Connect API key** (`.p8`, Key ID, Issuer ID) with `-allowProvisioningUpdates`.
4. **Agreements**: Paid Applications agreement, banking and tax information, price tier.
5. **Family Sharing**: decide on/off (one checkbox; matches a one-purchase-per-family model).
6. **Metadata you own**: privacy policy URL, support URL, age rating questionnaire, App Privacy answers, screenshots
   (6.9" and 6.5" iPhone, 13" iPad if universal).
7. **Device sanity pass** on a TestFlight build per release: speech with the silent switch on, notifications, haptics.

---

## 6. Definition of done

- `ios-release.yml` produces a signed `.ipa` and a TestFlight build from a known-good revision, with no local Xcode.
- The four native capabilities work on a real device and are named in the App Review Notes.
- The website and the Android app are unchanged in behaviour (adapter web path is the old code path).
- `RELEASING.md` documents the secrets, the release steps, and what to do when a review is rejected.
- Every new path is inside the phase allowlist; no issue ever needed a policy exception at run time.

---

## 7. Harness and environment extensions

This is what `tools/harness/` and the worker environment need **before** an iOS plan can be executed. Nothing here is
implemented yet. Each item names the file that changes and the test that must exist.

### 7.1 Escalation policy: narrow, explicit entries

`tools/harness/plans.py` (`DEFAULT_POLICY["escalation_paths"]`) refuses any changed path that is not listed when it looks
like signing or tooling material. iOS needs these entries:

```text
sites/lesen/ios/App/App/Info.plist
sites/lesen/ios/App/App/PrivacyInfo.xcprivacy
*.entitlements
*.xcodeproj/project.pbxproj
*.p12
*.mobileprovision
*.p8
*.cer
```

Deliberately **not** escalated, because Capacitor's `cap sync` rewrites them and the harness must be able to work there:
`sites/lesen/ios/App/App/**/*.swift`, `sites/lesen/ios/App/CapApp-SPM/Package.swift`, `Package.resolved`. Broadly
escalating `sites/lesen/ios/**` would make the plan unexecutable. (`Podfile`/`*.xcworkspace` entries are unnecessary now
that Capacitor 8 uses SPM; keep them out unless the project is ever downgraded.)

Tests: extend the existing escalation-matching tests with an iOS fixture asserting that `sites/lesen/ios/App/App/AppDelegate.swift`
is allowed while `sites/lesen/ios/App/App/App.entitlements` is escalated.

### 7.2 New trusted smoke rule: the iOS shell must stay offline

`tools/harness/smoke.json` plus a new `tools/harness/worker/smoke/ios_shell.sh` (Python stdlib only, no downloads):

- `capacitor.config.json` parses, has `appId`, `webDir`, and **no `server.url`** (a remote URL is exactly the review
  rejection this plan exists to avoid);
- `ios/App/App/Info.plist` and `PrivacyInfo.xcprivacy` parse via `plistlib`;
- the privacy manifest declares `NSPrivacyAccessedAPITypes` and every entry carries a reason code;
- the bundled `www/` contains no `http://` or `https://` reference to a first-party host (i18n and docs links are
  allowlisted in the rule, so the check stays deterministic);
- every file the copy step expects exists.

Why this belongs in the harness and not in the product: it is a *trusted* check on the shape of the app, it costs no
network, and it fails on the same class of mistake a reviewer would find. Pattern: the Godot rule added on 2026-11-02.

Cost: the worker image must be rebuilt to include the script, which invalidates the Tier A attestation — rebuild, then
`harness isolation verify` (about two minutes, already scripted).

### 7.3 Worker image: what it does *not* need

Explicitly no new downloads are needed for the JS/config work:

- Node 22 and npm are already in the image; `npm ci` for `sites/lesen` pulls from the registry (egress is unrestricted in
  Tier A). Capacitor 8 resolves plugins through SPM, so the container does not need CocoaPods, Ruby or a pod cache — and
  CI on the macOS runner does not run `pod install` either, which keeps the release pipeline short.
- `plistlib`, `zipfile`, `json` are stdlib — the smoke check needs nothing.
- **Xcode, CocoaPods, `xcrun`, SwiftLint: not added, not addable.** They are macOS-only and the sandbox is Debian. The
  image must never pretend to verify an iOS build; the CI workflow does that.
- Xcode now exists on the host machine (installed 2026-11-03). That does not change this section: a local build is a
  development aid on the host, never harness evidence, because the sandbox cannot reproduce it and it is not a signed
  release.

One real cost to accept: a fresh container per attempt means `npm ci` runs on every check job (`node_modules` is not
committed). Around a minute per attempt, no cache. If that becomes painful, the fix is a pre-populated npm cache in the
image, which is a separate decision because it makes the image rebuild on dependency changes.

### 7.4 Verification evidence: CI as the gate

Today the harness merges a worker pull request with the head SHA pinned (`publisher.merge` →
`client.merge_pr(pr, head_rev)`), so **GitHub** enforces whatever the *run branch* requires. The harness itself only
verifies branch protection on the **base** branch (`merge_protection(self.base)`); the code that refuses a merge when the
branch rules provide no required checks at all (`completion_evidence`, `github.py`) runs on the promotion path.

So a macOS build becomes a hard gate only under one of two conditions, and one of them must be chosen deliberately:

- **Run-branch rule:** the run branch `harness/run/<plan-id>` requires the iOS check for pull requests into it, and
  GitHub then blocks the merge of an unbuilt app. No harness change, but a repository settings dependency that must be
  proven, not assumed.
- **Harness-side rule:** the scheduler reads the worker pull request's check runs before merging and refuses when the
  named check is absent or not green. This is a harness change (a check-run read in the merge path plus tests) and it is
  the more honest option, because it fails closed regardless of how the branch is configured.

Three things must be verified either way, before the iOS plan is approved:

- that the run branch actually requires checks for PRs into it, and what happens today when it does not;
- that a queued macOS job (waiting for a runner) can never be read as green;
- that the wait budget around a merge tolerates a 10–20 minute iOS build instead of treating slowness as failure.

### 7.5 Evidence shape for a device-only capability

Speech with the silent switch on, notification scheduling and haptics cannot be verified by any automated check. The
harness must not pretend otherwise. The plan therefore uses:

- an automated check for *what can be checked* (config, plists, offline bundle, JS behaviour with a fake speech adapter);
- a **manual test task** for the device behaviour (`humantasks` already supports `kind="manual_test"` with
  `evidence`/`tester` fields), raised once per release and visible in `status` and the status page.

No new harness mechanism is required — but the plan must declare the manual task in the phase's exit criteria, or the
phase will validate on config alone and claim more than it proved.

### 7.6 Documentation the harness carries

- `tools/harness/README.md`: a line in the smoke-rule section naming the iOS rule, and one in Troubleshooting for a failed
  plist/offline check.
- `docs/harness/decisions.md`: why the sandbox verifies the *shape* of an iOS app but never builds one, and why the macOS
  workflow is the only build authority.
- The status page (added 2026-11-03) needs no change: it is plan-agnostic.

### 7.7 What must stay outside the harness

- Apple paperwork, secrets, screenshots, review submission (section 5).
- Any hand-written Swift inside the Xcode project (e.g. word-range highlighting). That file is escalated by design, so a
  worker is refused; it is owner work followed by a normal commit.
- Any attempt to automate App Store Connect beyond what CI does with an API key.

### 7.8 Checklist before requesting approval of an iOS plan

1. `plans.py` escalation entries added, matching tests green.
2. `worker/smoke/ios_shell.sh` + `smoke.json` rule, image rebuilt, Tier A attestation re-verified, rule proven to pass a
   valid shell and fail a bundle with `server.url`.
3. 7.4 verified against the real repository (run-branch protection and required checks).
4. Documented in README and decisions.md.
5. Owner checklist section 5 complete enough that a CI run can reach TestFlight.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **Guideline 4.2** rejection | The four native capabilities, plus review notes that name them and a demo script |
| Plugin gaps (word highlight, audio session edge cases on newer iOS) | v1 ships without word highlight; audio behaviour verified on device before submission |
| macOS runner minutes (≈10× Linux) | one workflow, manual dispatch only, never on PRs |
| Signing secrets rotation/expiry | profile expiry date noted in `RELEASING.md`; upload failure names the secret |
| Paid-app expectations (VAT, refunds, Family Sharing) | handled by Apple; decide Family Sharing in section 5 |
| DSGVO/child-directed expectations with an Education label | no analytics or ad SDKs at all; speech and progress stay on device; privacy answers match behaviour |
| Two channels drifting apart | one shared `static/`, adapter contract enforced by tests, web path is the old behaviour |
| **Capacitor 6 cannot run on current iOS at all** | upgrade to Capacitor 8 in phase I0 first (already verified to build and run with Xcode 27); the upgrade also touches Android, so it is its own phase with its own acceptance criteria |

## 9. Open questions for the next session

1. Reuse the Android bundle id or register a distinct iOS id?
2. Family Sharing on or off?
3. Universal (iPhone + iPad) from day one, or iPhone-only with iPad scaled?
4. Price tier, and whether the website keeps a free subset (the paid-app value proposition)?
5. Is the parent report (CSV) enough, or should it be a shareable PDF?
6. Does the App Store listing stay German-only for v1 (the app itself is bilingual either way), or is an English listing
   wanted from the start? The second costs a description, a keyword set and a second screenshot set, and no code.

---

## Appendix A — secrets and workflow shape

Secrets (names are proposals, mirroring the Android keystore pattern):

```text
IOS_CERTIFICATE_P12_BASE64      # distribution certificate
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64 # App Store profile
IOS_TEAM_ID
# or, instead of the three above:
IOS_ASC_KEY_P8_BASE64           # App Store Connect API key
IOS_ASC_KEY_ID
IOS_ASC_ISSUER_ID
```

Workflow skeleton (issue 9 fills in the details):

```yaml
name: iOS release (Buchstabenzeit)
on:
  workflow_dispatch:
    inputs:
      versionName: { required: true }
      versionCode: { required: true, type: number }
jobs:
  build:
    runs-on: macos-14
    steps:
      # checkout -> setup node -> npm ci -> cap sync ios
      # import signing material from secrets
      # xcodebuild archive + exportArchive -> App.ipa
      # upload artifact -> (optional) xcrun altool --upload-app to TestFlight
```

## Appendix B — what the harness will refuse

For the record, so the plan is not surprised at run time:

- any change under `sites/lesen/ios/App/App/Info.plist`, `*.entitlements`, `*.pbxproj`, `*.p12`, `*.mobileprovision`,
  `*.p8` → escalates to the owner;
- a diff larger than the plan's `diff_size_cap` (800 added lines) → routed to the sizing analysis, which proposes a split;
- a phase with no reachable exit criteria → pauses instead of claiming success;
- a merge into the run branch without the green check the plan names → refused, once item 7.4 makes that requirement
  real (today it depends on repository settings).
