# Arithmo Slayer: Android + iOS app (port of the web game)

Status: investigation input only; implementation, release and publication are not approved
Date: 2026-11-04
Source: owner request 2026-11-04 and the feasibility assessment of the same day

Port the existing web math game `sites/ffm` (Arithmo Slayer, `ffm.derschweigert.de`) to Android and iOS as it is
today. This is **not** a reimagining: the gameplay, the 60 levels, art, sound, difficulty and bilingual DE/EN text stay
exactly as in the web game. It is unrelated to the Godot project `apps/arithmoslayer/` and shares no code with it.

What differs from the web version:

- The app is **free**. Levels 1-2 are playable without payment. One **permanent, one-time in-app purchase** unlocks
  levels 3-60 forever (non-consumable; no subscription).
- There are **no accounts, no login, no public leaderboard and no server**. The app shows only the player's **own
  development**: per-level best score, a score-history chart over time, and a levels-completed progress overview.
- Everything works offline on first launch. The only network use is the platform store's own purchase/restore flow.

Owner decisions recorded 2026-11-04 (do not reopen them in the plan):

| Decision | Choice |
|---|---|
| Platforms | Android and iOS in this run |
| App identity | `appId` `de.derschweigert.arithmoslayer`, display name `Arithmo Slayer` |
| Purchase mechanism | An open-source Capacitor in-app-purchase plugin over StoreKit 2 and Google Play Billing, entitlement checked on device, no backend, no third-party purchase service. Choose a maintained, permissively licensed plugin compatible with Capacitor 8 and record the choice and its licence. |
| Level data | Accepted: the full 60-level configuration ships inside the app bundle. It is generated at packaging time from `sites/ffm/app/level_data.json` and must never be written into `sites/ffm/static/`, which is deployed to the web. |
| Store positioning | Education category, children in the audience. A parental gate guards the purchase, restore, and every external link. No analytics, no ads, no tracking, no data collection. |
| Personal development | Per-level best score; score-history chart (reuse the web chart); levels-completed overview; survives via OS backup (Android Auto Backup, iOS device/iCloud backup). No reset button. |
| Models | DeepSeek only; overseer enabled |
| Background music | Rotate between several licence-compatible chiptune tracks instead of the single looping track. The owner selects and commits the tracks; workers never download or choose music. |

## Maintainer-owned prerequisites (outside worker authorization)

These touch protected paths (`tools/harness/`, `.github/workflows/`) or owner accounts. Workers must not attempt them;
the investigation report and the release handover keep each one visible until it has evidence.

- M1 Smoke rule: add a `tools/harness/smoke.json` entry running the existing `ios_shell.sh` (or an equivalent offline
  shell check) for `sites/ffm/mobile`, rebuild the worker image and re-verify the Tier A attestation.
- M2 Native CI: a protected workflow (pattern: `lesen-native.yml`) that builds the Android debug APK and the iOS
  simulator app for `sites/ffm/mobile/` on pull requests touching it, and is required on the run branch.
- M3 Release workflows: signed `.aab` and signed `.ipa`/TestFlight, triggered independently of the website deploy.
- M4 Music tracks: the owner commits the selected tracks (with source URL, author and licence per track in a
  `LICENSES`/manifest file next to them) before phase P4. Until then the rotation runs over the existing
  `background-music.mp3` alone.
- Owner store setup: Play Console and App Store Connect apps, the non-consumable product (suggested id
  `arithmoslayer_full_unlock`), price, Paid Apps agreement, sandbox/licence testers, store listings, privacy labels
  ("Data not collected"), content rating, signing credentials, physical-device checks, review submission and
  publication. No approval of a worker plan constitutes publication approval.

### Already provided by the maintainer scaffold

The native shell exists before the run, generated with the real Capacitor tooling; workers extend it, never
regenerate or hand-write it:

- `sites/ffm/mobile/`: `package.json`/`package-lock.json` (Capacitor 8.6, Preferences, App, keep-awake, and the
  MPL-2.0 `@capgo/native-purchases` 8.9.6 for StoreKit 2 / Play Billing; no third-party purchase service),
  `capacitor.config.json` (bundled assets, no `server.url`), `scripts/copy-assets.mjs` with the development-file
  exclusions below, and `tests/scaffold.test.mjs`.
- `android/` and `ios/` projects with id `de.derschweigert.arithmoslayer`, name "Arithmo Slayer", generated icons
  and splash, Android Auto Backup on and no app-declared permissions (Play Billing merges its own), iOS
  `CFBundleLocalizations` de/en, `ITSAppUsesNonExemptEncryption` false, iPhone only, and a bundled
  `PrivacyInfo.xcprivacy` (no tracking, UserDefaults reason CA92.1).
- M2 is satisfied by `.github/workflows/ffm-native.yml` (Android debug APK + iOS simulator build, `npm test`).

Native files and `package*.json` are escalation paths; a worker needing a change there stops and escalates.

## Execution and evidence boundaries

- Inspect the current repository first. Reuse the proven Buchstabenzeit packaging pattern in `sites/lesen/`
  (Capacitor 8.6, `copy-assets` into a git-ignored `www/`, `node --test` tests, `RELEASING.md`, privacy manifest),
  adapted rather than copied blindly.
- **The website must not change behaviour.** `sites/ffm/static/` stays the single source for game code and assets.
  Changes there are limited to a small platform seam whose web implementation keeps today's API, auth, billing and
  leaderboard behaviour; the existing `node --test sites/ffm/static/game/*.test.js` and `pytest sites/ffm/tests/`
  suites must stay green. App-only code lives under `sites/ffm/mobile/`.
- The packaged app must contain no Stripe, checkout, billing portal, redeem/promotion code, subscription cancellation,
  withdrawal-request, registration, login, profile, or leaderboard code path or UI, and no request to the FFM API.
  Store rules forbid non-store payment for digital content.
- Exclude development-only files from the bundle (`source-assets/`, `calibrate.*`, `export-sprites.html`,
  `_dragon_test.html`, `demo.html`, tests) and keep the app size reasonable.
- The Linux checker has Node 22 but no Android SDK/JDK or Xcode. Native builds, purchases and device behaviour need
  CI (M2) or an identified, revision-bound manual check. Record unavailable checks as pending; never claim them from
  a passing JavaScript test.
- Purchases cannot be proven with fakes alone. Required manual gates: sandbox purchase, restore on a fresh install,
  Ask-to-Buy/pending purchase, cancelled purchase, refund/revocation, offline launch after purchase, Android Back
  behaviour, audio with the iOS silent switch, interruption (call/background) pausing the game and music, safe areas
  on notched devices, and an update install that keeps progress and unlock.
- Worker issue IDs must carry the prefix `ffmapp-` to avoid other runs' branch names.
- DeepSeek models only, with an independent reviewer, one source writer at a time, bounded corrections, and no new
  paid service.

| ID | Requirement | Phase | Description |
|---|---|---|---|
| **1.1** | **Capacitor project** | P1 | A Capacitor 8 project under `sites/ffm/mobile/` (`package.json`, `capacitor.config.json` with `appId` `de.derschweigert.arithmoslayer`, `webDir` `www`, no `server.url`), mirroring the Buchstabenzeit versions. The website build and deploy are unaffected. |
| **1.2** | **Offline bundle** | P1 | `scripts/copy-assets.mjs` builds `www/` from `sites/ffm/static/` plus app-only modules, excludes development and web-only files, and generates the full 60-level configuration from `sites/ffm/app/level_data.json` into `www/` only. A bundle check fails on any remote first-party URL, any FFM API call, or a missing required file. Core play works in airplane mode. |
| **1.3** | **Platform seam** | P1 | One small interface in `sites/ffm/static/game/` for level access, score recording, personal history, entitlement, and account/leaderboard availability. The web implementation keeps today's behaviour exactly; the app implementation (in `sites/ffm/mobile/`) is local only. No game module calls the API or a native plugin directly. Unit-tested with fakes. |
| **2.1** | **Local progress store** | P2 | Versioned on-device store (Capacitor Preferences or equivalent that the OS backs up) for per-level best score, timestamped score history, and completed levels. Unknown or corrupt data reads as empty without crashing; writes are atomic per record; schema version is migratable. |
| **2.2** | **Personal development screen** | P2 | The title screen's leaderboard area shows, in the app, the player's per-level best, the existing score-history chart fed from local data, and a levels-completed overview, in DE and EN. No public list, no username, no year filter. |
| **2.3** | **OS backup** | P2 | Progress and the unlock cache are included in Android Auto Backup and iOS device/iCloud backup; nothing is excluded unintentionally. Document how to verify a restore. |
| **3.1** | **Unlock purchase** | P3 | Through the chosen open-source plugin: query the non-consumable product, purchase with localised store price, handle success, cancel, pending/Ask-to-Buy, error and already-owned; finish/acknowledge transactions as each store requires. |
| **3.2** | **Entitlement and paywall** | P3 | Levels 3-60 open only with a valid entitlement; levels 1-2 always open. Starting level 3+ without it shows a paywall in place of today's web registration/payment flow. Entitlement is cached for offline play, refreshed from the store on launch/resume when online, and revoked on refund. |
| **3.3** | **Restore purchases** | P3 | A visible "Restore purchase" action (required on iOS) that recovers the unlock on a fresh install or a new device with the same store account. |
| **3.4** | **Parental gate** | P3 | A simple adult check (not solvable by the game's own arithmetic level, e.g. a written-out multiplication or a hold gesture with instructions) before purchase, restore, and every external link. Accessible and bilingual. |
| **4.1** | **App UI adaptation** | P4 | In the app build: remove login, registration, profile, email verification, billing, redeem, cancellation and withdrawal UI and code paths; keep gameplay, pause menu, game over, level select, audio and language switch unchanged. |
| **4.2** | **App lifecycle** | P4 | Pause the game and music when the app goes to background or is interrupted; resume cleanly; Android Back maps to pause / back / exit predictably; screen stays awake during play only; orientation and safe areas match the web layout on phones and tablets. |
| **4.3** | **Legal and about** | P4 | Bundled, language-matched app privacy notice (no data collected; purchases processed by Apple/Google), imprint, terms and licence/attribution notes; reachable from the title screen; external links behind the parental gate. |
| **4.4** | **Music rotation** | P4 | The audio engine plays background music from a track manifest (file, title, author, licence, source URL, optional stage/intensity tag) instead of one hard-coded file: it advances to the next track when one ends (no loop of a single track unless the manifest has one), varies the order per session without immediate repeats, can prefer tracks tagged for the current stage, keeps today's volume and mute behaviour, and preloads only the next track. Credits for every track appear in the bundled licence/attribution notes. Unit-tested with a fake audio element. Whether the website also rotates is decided by the owner; until then the web build keeps today's single track. |
| **5.1** | **Android shell** | P5 | `cap add android` project: package identity, adaptive icon and splash from the existing artwork, `com.android.vending.BILLING`, Auto Backup configuration, no unused permissions, versionCode/versionName scheme. |
| **5.2** | **iOS shell** | P5 | `cap add ios` project (SPM): bundle identity, icons and launch screen, `CFBundleLocalizations` de/en, In-App Purchase capability, audio session that plays with the silent switch only as the web game intends, `PrivacyInfo.xcprivacy` declaring every required-reason API actually used, no tracking domains. |
| **5.3** | **Release handover** | P5 | `sites/ffm/mobile/RELEASING.md`: asset sync, tests, versioning, signing-secret names, product id and store setup checklist, sandbox test procedure, internal track/TestFlight install, App Review notes (parental gate, offline, restore), and the manual gate checklist above with revision placeholders. Lists M1-M3 and owner actions as open until evidenced. |
