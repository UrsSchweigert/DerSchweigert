# Releasing Arithmo Slayer (Android shell)

This document covers the committed Android shell under `sites/ffm/mobile/android/`
and the steps that turn a known-good revision into a valid, versioned, signed
Android App Bundle (`.aab`) for Google Play. The website (`ffm.derschweigert.de`)
deploys separately from `sites/ffm/static/` and is unaffected by this process.

> **External release gate.** Producing a signed `.aab`, completing the Play
> Console internal-track install/upgrade check and publishing are manual owner
> actions. The offline tests, `copy-assets`, and the M2 native workflow neither
> perform nor claim them. Nothing in this document is evidence until the
> revision is filled in.

All commands run from `sites/ffm/mobile/`. Nothing secret is ever committed.

## Prerequisites (local)

- Node.js 22+ and npm (Capacitor 8).
- JDK 21 (e.g. `brew install openjdk@21`).
- Android SDK command-line tools with `platform-tools`, `platforms;android-36`
  and `build-tools;36.0.0`, plus `android/local.properties` pointing at the SDK
  (`sdk.dir=/path/to/Android/sdk`). `local.properties` is gitignored.
- The native project is maintainer-owned and generated with the real Capacitor
  tooling. Run `npx cap sync android` after changing dependencies; never
  regenerate or hand-write `android/`.

## Asset sync

`www/` is build output: git-ignored, cleaned on every run and never edited by
hand. `sites/ffm/static/` stays the single source for game code and assets.

```sh
npm ci                       # locked dependency install
npm run copy-assets          # rebuild www/ from ../static plus the app overlay
node scripts/bundle-check.mjs # offline bundle, 60 levels, no remote first-party URL
npm run sync                 # copy-assets + cap sync android
```

`copy-assets` also generates `www/game/level-data.js` from the private
curriculum and strips the web account/checkout markup. The bundle check fails on
a missing runtime file, an incomplete level set, a first-party remote URL or any
call to the FFM API.

## Tests

```sh
npm test                     # node --test tests/*.test.mjs
```

`tests/android-shell.test.mjs` asserts the committed Android shell offline:
application id and namespace, app label, `android:allowBackup="true"` with no
backup rule files, exactly one exported launcher activity, the absence of any
app-declared permission, the adaptive icon and splash wiring, and the version
defaults. It fails if the identity, backup or permission posture regresses.

These are static checks. They cannot compile the app, cannot see the merged
manifest and cannot prove device behaviour; the M2 workflow
`.github/workflows/ffm-native.yml` builds the Android debug APK on the run
branch and is the only native compilation evidence.

## Versioning

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

## Permissions and the merged manifest

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

## Product and store setup checklist

- Product id `arithmoslayer_full_unlock`, one **non-consumable** (one-time
  permanent unlock of levels 3-60). No subscription, no consumable, no
  server-side verification: the entitlement is checked on device and cached.
- Price set by the owner; the app shows the store's localised price and never a
  hard-coded one.
- Paid Apps agreement signed, merchant account active.
- Licence testers / sandbox accounts added for the internal track.
- Store listing: Education category, children in the audience, DE and EN text,
  screenshots, the bundled privacy notice URL or text.
- Data safety: "Data not collected", no tracking, no ads, no analytics.
- Content rating questionnaire, target audience declaration, and the parental
  gate noted where the questionnaire asks about purchases.
- Physical-device checks and review submission are owner actions.

## Sandbox procedure

Run on the internal testing track with a licence-tester account, on a physical
device with a working store:

1. Fresh install, confirm levels 1-2 play offline and level 3+ shows the paywall.
2. Purchase `arithmoslayer_full_unlock` through the parental gate; confirm the
   store sheet shows the localised price and the unlock survives a restart and
   an offline launch.
3. Restore on a fresh install (same account) and confirm levels 3-60 unlock with
   no second charge.
4. Pending / Ask-to-Buy: confirm the app reports pending and grants the unlock
   only after the approval arrives.
5. Cancelled purchase: confirm no unlock, no error state stuck on screen.
6. Refund/revocation: refund in the Play Console, relaunch online, confirm the
   entitlement is revoked and the paywall returns.

## Internal track install

1. Choose a known-good revision and check it out.
2. `npm ci && npm test`.
3. Bump `versionCode`/`versionName` (see Versioning).
4. `npm run build:release` — the bundle lands at
   `android/app/build/outputs/bundle/release/app-release.aab`.
5. `jarsigner -verify -verbose -certs <aab>` to confirm it is signed.
6. Upload to the Play Console internal testing track and install from Play.
7. Test an **upgrade** over the previous build, not only a clean install:
   progress and the unlock must survive.

## App Review notes

- The app is fully offline. The only network use is Google Play Billing's own
  purchase and restore flow.
- There are no accounts, no login, no public leaderboard, no ads, no analytics
  and no data collection.
- One non-consumable in-app purchase (`arithmoslayer_full_unlock`) unlocks
  levels 3-60. "Restore purchase" is visible on the paywall and title screen.
- A parental gate (a written-out multiplication) guards the purchase, the
  restore and every external link, because the audience includes children.
- Progress is stored on device and included in Android Auto Backup; there is no
  cloud sync and no reset button.

## Manual gate checklist

Each row stays open until the revision and the observed result are recorded.
Native compilation and store behaviour cannot be claimed from a passing
JavaScript test.

| Gate | Revision | Result | Evidence |
| --- | --- | --- | --- |
| M2 native build (debug APK) green on the run branch | | pending | |
| Merged release manifest shows only BILLING, INTERNET, ACCESS_NETWORK_STATE | | pending | |
| Signed `.aab` produced and `jarsigner` verified | | pending | |
| Internal testing install from Play | | pending | |
| Upgrade install keeps progress and unlock | | pending | |
| Sandbox purchase and offline launch after purchase | | pending | |
| Restore purchase on a fresh install | | pending | |
| Pending / Ask-to-Buy purchase | | pending | |
| Cancelled purchase | | pending | |
| Refund / revocation | | pending | |
| Android Back behaviour (pause → confirm → exit) | | pending | |
| Interruption (call/background) pauses game and music | | pending | |
| Safe areas on a notched device | | pending | |

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
- **Version override (open owner action).** `android/app/build.gradle` hardcodes
  `versionCode 1` / `versionName "1.0"`. Adding the `bzVersionCode` /
  `bzVersionName` resolution shown under Versioning is a native edit the owner
  must make; until then every release edits the native file by hand.
- **Merged-manifest permission check.** Confirm BILLING, INTERNET and
  ACCESS_NETWORK_STATE arrive from Play Billing and that nothing else is
  declared; only the packaged manifest can show this.
- **Store setup and publication.** Play Console app, product, price, listings,
  data safety, content rating, licence testers, physical-device checks, review
  submission and publication.
- **M4 music tracks.** The owner commits the selected tracks with author and
  licence; until then the rotation runs over the existing track.
