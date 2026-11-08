# Releasing Arithmo Slayer

This is the release handover for the Capacitor shell in `sites/ffm/mobile`. The
Android project lives in `android/`, the iOS project in `ios/`, and both are
generated and maintained by the owner with the real Capacitor tooling. The
website (`ffm.derschweigert.de`) deploys separately from `sites/ffm/static/` and
is unaffected by this process. Nothing in this repository produces a signed
build, installs through TestFlight or the Play internal track, or submits to a
store; those stay owner actions and are listed as open below.

> **External release gate.** Producing a signed `.aab` / `.ipa`, completing the
> Play Console internal-track install/upgrade check, the TestFlight install and
> publishing are manual owner actions. The offline tests, `copy-assets`, and the
> M2 native workflow neither perform nor claim them. Nothing in this document is
> evidence until the revision is filled in.

All commands run from `sites/ffm/mobile/`. Nothing secret is ever committed.

## What the committed shells prove, and what they do not

`node --test tests/*.test.mjs` runs offline. `tests/android-shell.test.mjs` and
`tests/ios-shell.test.mjs` assert the committed native shells only:

- `tests/android-shell.test.mjs` — application id and namespace, the app label,
  `android:allowBackup="true"` with no backup rule files, exactly one exported
  launcher activity, no app-declared permission, the adaptive icon and splash
  wiring, and the version defaults.
- `tests/ios-shell.test.mjs` — `CFBundleDisplayName` `Arithmo Slayer`,
  `CFBundleLocalizations` exactly `de` and `en`,
  `ITSAppUsesNonExemptEncryption` false, the version keys bound to
  `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`, the
  `de.derschweigert.arithmoslayer` bundle id in Debug and Release, the app icon
  and launch screen wiring, and the privacy manifest (no tracking, no tracking
  domains, no collected data, only `CA92.1` user-defaults access) compiled into
  the app target's Resources phase.

That is static evidence. Native compilation is the M2 owner job in
`.github/workflows/ffm-native.yml` (`./gradlew assembleDebug` and `xcodebuild
... CODE_SIGNING_ALLOWED=NO`); it is never claimed from a static check. A green
static suite is a prerequisite, not device, signing, or store evidence.

## Prerequisites (local)

- Node.js 22+ and npm (Capacitor 8).
- **Android**: JDK 21 (e.g. `brew install openjdk@21`) and the Android SDK
  command-line tools with `platform-tools`, `platforms;android-36` and
  `build-tools;36.0.0`, plus `android/local.properties` pointing at the SDK
  (`sdk.dir=/path/to/Android/sdk`). `local.properties` is gitignored.
- **iOS**: macOS with Xcode and the iOS simulator runtime. The committed `ios/`
  project is an SPM package; `./node_modules/.bin/cap sync ios` regenerates it
  from `capacitor.config.json` and the installed plugins.
- The native projects are maintainer-owned and generated with the real Capacitor
  tooling. Run `npx cap sync android` / `npx cap sync ios` after changing
  dependencies; never regenerate or hand-write `android/` or `ios/`.

## Asset sync

`www/` is build output: git-ignored, cleaned on every run and never edited by
hand. `sites/ffm/static/` stays the single source for game code and assets.

```sh
npm ci                       # locked dependency install
npm run copy-assets          # rebuild www/ from ../static plus the app overlay
node scripts/bundle-check.mjs # offline bundle, 60 levels, no remote first-party URL
npm run sync                 # copy-assets + cap sync android
```

On a Mac with Xcode, `./node_modules/.bin/cap sync ios` regenerates the SPM
project from `capacitor.config.json` and the installed plugins. The committed
`ios/` project is the owner's output; do not hand-edit it from a worker branch.

The Xcode App target also copies and verifies the offline bundle and runs
`cap sync ios` automatically before its resources are built, including for
local archives. Node.js 22+ must be visible to Xcode; standard Homebrew paths
are included. Run `npm ci` on a fresh checkout or after dependency changes.
After changing Capacitor plugins or native dependencies, run `npm run copy-assets`
and `npx cap sync ios` before opening/building the project, since Xcode resolves
Swift packages before target build phases run. Missing or inconsistent
dependencies and failed preparation stop the build.

`copy-assets` also generates `www/game/level-data.js` from the private
curriculum and strips the web account/checkout markup. The bundle check fails on
a missing runtime file, an incomplete level set, a first-party remote URL or any
call to the FFM API.

## GitHub build artifacts

`.github/workflows/ffm-build-artifacts.yml` runs only on manual dispatch or a
`ffm-v*` tag, not on every merge. It uploads `ffm-debug-apk` (an installable
Android debug APK, not a Play release) and `ffm-ios-xcode-project`
(`ffm-ios-project.tar.gz`). The latter is verified by compiling unsigned and
then archiving the extracted project unsigned with package downloads disabled.
Neither artifact job signs a distribution release, uploads to a store or needs
an Apple team or signing secrets.

The tarball retains the `sites/ffm/mobile/ios/App/App.xcodeproj` layout, all
mobile npm dependencies (including CLI/dev and transitive dependencies), source
static assets, the private curriculum, app overlay, legal pages, manifests,
build scripts, optional mobile `assets/` and `tools/ios/prepare-capacitor.sh`.
It also includes the resolved Swift package cache: npm dependencies alone
do not include Capacitor's remote
Swift package. Do not move just the Xcode project out of this tree.

On a Mac with compatible Xcode/iOS SDKs and Node.js 22+ and npm visible to Xcode,
extract into a new directory and archive offline without reinstalling npm:

```sh
tar -xzf ffm-ios-project.tar.gz
artifact_root="$PWD"
cd sites/ffm/mobile
node scripts/stage-ios-project.mjs --relocate "$artifact_root"
npm ls --all --omit=optional --parseable
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS' \
  -clonedSourcePackagesDirPath "$artifact_root/swift-packages" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile -skipPackageUpdates \
  -archivePath "$artifact_root/ArithmoSlayer-unsigned.xcarchive" \
  CODE_SIGNING_ALLOWED=NO archive
```

The reusable `node scripts/stage-ios-project.mjs /path/to/resolved/SourcePackages`
stages the same inputs in a fresh `.ffm-ios-stage-*` directory at the repository
root; run asset preparation and `cap sync ios`, and resolve/build Swift packages
before staging. The offline route above uses the included cache explicitly;
ordinary Xcode GUI package resolution may still request the network. Signing,
TestFlight and store distribution remain separate owner actions.

## Tests

```sh
npm test                     # node --test tests/*.test.mjs
```

`tests/android-shell.test.mjs` asserts the committed Android shell offline:
application id and namespace, app label, `android:allowBackup="true"` with no
backup rule files, exactly one exported launcher activity, the absence of any
app-declared permission, the adaptive icon and splash wiring, and the version
defaults. `tests/ios-shell.test.mjs` asserts the committed iOS shell: bundle
identity and version keys, the `de`/`en` localizations, the encryption
exemption, the icon and launch screen wiring, and the privacy manifest in the
app target's Resources phase. Both fail if the identity, backup/permission
posture, localizations or the privacy manifest regress.

These are static checks. They cannot compile the app, cannot see the merged
manifest and cannot prove device behaviour; the M2 workflow
`.github/workflows/ffm-native.yml` builds the Android debug APK and the iOS
simulator app on the run branch and is the only native compilation evidence.

## Versioning

### Android

Two values identify every upload:

- `versionCode` — a positive integer that must **strictly increase** for every
  Play upload, including internal-track uploads. Never reuse one.
- `versionName` — the human-readable version shown to testers and players, in
  `major.minor` form.

Both default to `1` / `1.0`. The committed shell hardcodes them in
`android/app/build.gradle`:

```gradle
versionCode 1
versionName "1.0"
```

Bumping them therefore needs a native edit today, which is an **open owner
action** (see below). The Buchstabenzeit packaging pattern is the target: the
release build resolves the values per release without editing `build.gradle`
(`sites/lesen/android/app/build.gradle`):

```gradle
def resolvedVersionCode = (project.findProperty('bzVersionCode')
    ?: System.getenv('BZ_VERSION_CODE') ?: '1').toString().toInteger()
def resolvedVersionName = (project.findProperty('bzVersionName')
    ?: System.getenv('BZ_VERSION_NAME') ?: '1.0').toString()
```

so a release runs `./gradlew bundleRelease -PbzVersionCode=2 -PbzVersionName=1.1`
or `BZ_VERSION_CODE=2 BZ_VERSION_NAME=1.1 npm run build:release`. Adapting that
block to this project (same `bzVersionCode`/`bzVersionName` property names and
`BZ_VERSION_CODE`/`BZ_VERSION_NAME` environment variables) is the owner change.

`android/variables.gradle` is the Buchstabenzeit pattern already in use for the
SDK and AndroidX versions (`sites/lesen/android/variables.gradle` is the
reference); keep SDK levels there, not inline in `build.gradle`.

Record each upload below. A row without a git revision is not evidence.

### Release record

| Date | Revision | versionName | versionCode | targetSdk | Track | Notes |
| --- | --- | ---: | ---: | ---: | --- | --- |
| | | | | | | |

### iOS

`ios/App/App.xcodeproj/project.pbxproj` holds one scheme for both
configurations: `MARKETING_VERSION` (`CFBundleShortVersionString`, currently
`1.0`) and `CURRENT_PROJECT_VERSION` (`CFBundleVersion`, currently `1`). Bump
`MARKETING_VERSION` for a user-visible release and always increase
`CURRENT_PROJECT_VERSION` for every upload, including re-uploads of the same
marketing version. The plist reads both values, so no version literal is
duplicated there.

## Permissions and the merged manifest (Android)

The app declares **no permission of its own**: the game is bundled and plays
offline, and there is no account, analytics, ads or FFM API access. Google Play
Billing merges `com.android.vending.BILLING`, `INTERNET` and
`ACCESS_NETWORK_STATE` into the packaged manifest through
`@capgo/native-purchases`. Adding `INTERNET` (or any other permission) by hand
would duplicate the library and ship a permission the game never uses.

The merged manifest is the only place these permissions become visible, so
verify it in the release build, not from the source manifest:

```sh
./gradlew :app:processReleaseManifest
grep -E 'uses-permission' android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml
```

Expected: exactly `BILLING`, `INTERNET` and `ACCESS_NETWORK_STATE`, with no
permission the app does not use. This check is a **manual gate** below.

## Signing secrets

The committed shell has no `signingConfigs`, so a release build is unsigned and
cannot be uploaded. Release signing belongs to the M3 workflow (owner-owned).
When it is added, keep the Buchstabenzeit naming so CI secrets stay uniform and
never commit a keystore:

- `FFM_KEYSTORE_FILE` — path to the upload keystore (`*.jks`).
- `FFM_KEYSTORE_PASSWORD` — keystore password.
- `FFM_KEY_ALIAS` — key alias.
- `FFM_KEY_PASSWORD` — key password.

A local `android/keystore.properties` (git-ignored) may hold the same values.
If no keystore is configured, the release build must fail loudly instead of
producing a silently unsigned bundle.

## Product and store setup checklist (owner)

- Product id `arithmoslayer_full_unlock`, one **non-consumable** (one-time
  permanent unlock of levels 3-60). No subscription, no consumable, no
  server-side verification: the entitlement is checked on device and cached.
- Price set by the owner; the app shows the store's localised price and never a
  hard-coded one.
- **Play Console**: Paid Apps agreement signed, merchant account active,
  licence testers / sandbox accounts added for the internal track.
- **App Store Connect**: create `arithmoslayer_full_unlock` with localised
  metadata and a price tier, and enable the **In-App Purchase capability** on
  the App target before the first sandbox test.
- Store listing: Education category, children in the audience, DE and EN text,
  screenshots, the bundled privacy notice URL or text.
- Data safety: "Data not collected", no tracking, no ads, no analytics.
- Privacy answers must match `PrivacyInfo.xcprivacy`: no tracking, no data
  collection, `CA92.1` user-defaults access only.
- `ITSAppUsesNonExemptEncryption` is false because the app ships no custom
  cryptography; confirm this at submission.
- Content rating questionnaire, target audience declaration, and the parental
  gate noted where the questionnaire asks about purchases.
- Physical-device checks and review submission are owner actions.

## Sandbox procedure (owner)

Run on the internal track (Play) or with a sandbox Apple ID (App Store
Connect), on a physical device with a working store:

1. Fresh install, confirm levels 1-2 play offline and level 3+ shows the paywall.
2. Purchase `arithmoslayer_full_unlock` through the parental gate; confirm the
   store sheet shows the localised price and the unlock survives a restart and
   an offline launch.
3. Restore on a fresh install (same account) and confirm levels 3-60 unlock with
   no second charge.
4. Pending / Ask-to-Buy: confirm the app reports pending and grants the unlock
   only after the approval arrives.
5. Cancelled purchase: confirm no unlock, no error state stuck on screen.
6. Refund/revocation: refund in the store console, relaunch online, confirm the
   entitlement is revoked and the paywall returns.
7. Repeat a purchase and confirm the store reports "already owned" rather than
   charging twice; cancel and deny the parental gate and confirm nothing
   unlocks.

## Internal track install (Android)

1. Choose a known-good revision and check it out.
2. `npm ci && npm test`.
3. Bump `versionCode`/`versionName` (see Versioning).
4. `npm run build:release` — the bundle lands at
   `android/app/build/outputs/bundle/release/app-release.aab`.
5. `jarsigner -verify -verbose -certs <aab>` to confirm it is signed.
6. Upload to the Play Console internal testing track and install from Play.
7. Test an **upgrade** over the previous build, not only a clean install:
   progress and the unlock must survive.

## TestFlight install (iOS owner)

Producing the archive, signing it with the owner's team and provisioning
profile, uploading it to App Store Connect and installing it through TestFlight
are owner actions. No signing material or Apple credentials are committed, and
no workflow in this repository performs the upload. Record the Xcode version and
the uploaded build number in the release record.

## App Review notes

- The app is fully offline. The only network use is the store's own purchase
  and restore flow (Google Play Billing or StoreKit).
- There are no accounts, no login, no public leaderboard, no ads, no analytics
  and no data collection.
- One non-consumable in-app purchase (`arithmoslayer_full_unlock`) unlocks
  levels 3-60. "Restore purchase" is visible on the paywall and title screen.
- A parental gate (a written-out multiplication) guards the purchase, the
  restore and every external link, because the audience includes children.
- Progress is stored on device and included in OS backup (Android Auto Backup /
  iCloud); there is no cloud sync and no reset button.

## Manual gate checklist

Each row stays open until the `<revision>` placeholder is replaced with the
git revision the check ran against and the observed result is recorded.
Native compilation and store behaviour cannot be claimed from a passing
JavaScript test.

| Gate | Where | Evidence | Revision | State |
| --- | --- | --- | --- | --- |
| M2 native build (debug APK + iOS simulator) green on the run branch | CI | | `<revision>` | open |
| Merged release manifest shows only BILLING, INTERNET, ACCESS_NETWORK_STATE | release build | | `<revision>` | open |
| Signed `.aab` produced and `jarsigner` verified | local | | `<revision>` | open |
| Internal testing install from Play | Play | | `<revision>` | open |
| Upgrade install keeps progress and unlock | device | | `<revision>` | open |
| Sandbox purchase through the parental gate | device | | `<revision>` | open |
| Offline launch after purchase keeps the unlock | device | | `<revision>` | open |
| Restore purchase on a fresh install | device | | `<revision>` | open |
| Pending / Ask-to-Buy purchase | device | | `<revision>` | open |
| Cancelled purchase | device | | `<revision>` | open |
| Refund / revocation | store console | | `<revision>` | open |
| Android Back behaviour (pause → confirm → exit) | Android | | `<revision>` | open |
| Interruption (call/background) pauses game and music | Android | | `<revision>` | open |
| iOS silent switch silences BGM and effects, and unmuting restores them without a restart | iPhone | | `<revision>` | open |
| Audio interruption (call, other app) pauses and resumes gameplay and BGM exactly once | iPhone, Android | | `<revision>` | open |
| Controls clear notches, rounded corners and gesture bars in both orientations | notched phone | | `<revision>` | open |
| App icon and launch screen match the artwork on the home screen and at launch | iPhone | | `<revision>` | open |
| German and English system languages both show translated UI and legal pages | iPhone | | `<revision>` | open |
| In-App Purchase capability is enabled and a sandbox purchase succeeds | App Store Connect + device | | `<revision>` | open |

The iOS silent switch, the interruption and the safe-area gates are the
`PENDING_MANUAL_GATES` exported by `game/lifecycle.js`;
`tests/lifecycle.test.mjs` only asserts that list stays documented and never
proves the behaviour.

## iOS audio session and the silent switch

The web game follows the device's ring/silent switch, exactly as it does in
Safari: with the switch on silent, background music and effects are muted, and
flipping it back restores them. The committed `AppDelegate.swift` and
`SceneDelegate.swift` never set an `AVAudioSession` category, so iOS keeps the
default `AVAudioSessionCategorySoloAmbient`, which honours the switch. Do not
add `AVAudioSessionCategoryPlayback` without an owner decision: it makes the
game audible while the phone is silenced and breaks the web intent. If an
explicit category is ever needed, `AVAudioSessionCategoryAmbient` is the one
that keeps the switch authoritative. This remains a device gate — the static
tests only read the committed files.

## Open owner actions

These are outside worker authorization (protected paths, native files or owner
accounts) and stay open until the evidence above exists.

- **M1 smoke rule.** Add a `tools/harness/smoke.json` entry that runs an offline
  shell check for `sites/ffm/mobile` (the `ios_shell.sh` equivalent), rebuild
  the worker image and re-verify the Tier A attestation.
- **M2 native CI.** `.github/workflows/ffm-native.yml` is committed and builds
  the Android debug APK plus the iOS simulator app. Making it required on the
  run branch and recording a green run for this revision is the owner action.
- **M3 release workflows.** Signed `.aab` and signed `.ipa`/TestFlight builds,
  triggered independently of the website deploy, plus the `signingConfigs` and
  the signing secrets named above.
- **Version override (Android, open owner action).** `android/app/build.gradle`
  hardcodes `versionCode 1` / `versionName "1.0"`. Adding the `bzVersionCode` /
  `bzVersionName` resolution shown under Versioning is a native edit the owner
  must make; until then every release edits the native file by hand.
- **Merged-manifest permission check.** Confirm BILLING, INTERNET and
  ACCESS_NETWORK_STATE arrive from Play Billing and that nothing else is
  declared; only the packaged manifest can show this.
- **In-App Purchase capability (iOS).** It is not declared in the committed
  `project.pbxproj` (`TargetAttributes` has no `com.apple.InAppPurchase`
  entry). Enable the capability in Xcode for the App target; `project.pbxproj`
  is owner-merged, so a worker records this instead of editing it.
- **iOS signing.** Team, bundle id registration for
  `de.derschweigert.arithmoslayer`, provisioning and distribution certificates,
  plus the App Store Connect app record. No signing secrets are defined for
  this app yet; the owner decides their names and storage.
- **Audio session.** Keep the default category, or record an owner decision for
  an explicit one (see above).
- **Native compilation.** The M2 macOS job is owner-run and only reports the
  unsigned simulator build.
- **M4 music tracks.** The owner commits the selected tracks with author and
  licence; until then the rotation runs over the existing track.
- **Store setup and publication.** Play Console and App Store Connect app
  records, product, price, listings, data safety, content rating, licence
  testers, physical-device checks, review submission and publication.
