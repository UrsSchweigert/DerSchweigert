# Arithmo Slayer mobile shell

Capacitor 8 shell that bundles the web game from `../static` into `www/` for the Android and iOS apps.
`../static` stays the single source for game code and assets and keeps deploying to the website; `www/` is
build output, git-ignored and never edited by hand.

```sh
npm run copy-assets                 # build www/ from ../static plus the app overlay
node scripts/bundle-check.mjs       # verify www/ is complete and offline-only
npm test                            # node --test tests/*.test.mjs
```

`copy-assets` first cleans `www/` and copies `../static` without development-only and web-only files
(`source-assets/`, `calibrate.*`, `export-sprites.html`, `_dragon_test.html`, `demo.html`, tests, `game/api.js`,
`game/access-flow.js`, `game/cancel-request.js`, `game/withdrawal-request.js`, `cancel.html`, `widerruf.html`). It
then overlays the app-only modules from `game/` onto
`www/game`, so `game/platform-adapter.js` replaces the web adapter of the same name. `www/` is reproducible: the
same inputs always produce the same bundle and a stale file from an earlier build is removed.

After the copy it generates `www/game/level-data.js` from the private curriculum in `../app/level_data.json`
(all 60 levels, including `baseline_score`). That module exists only in `www/`; the private curriculum is never
written into `../static`, which deploys to the website. It also drops the web-only visitor-tracking inline script
from `index.html`, because the app is offline and must not call the FFM API, and every DOM region `index.html`
marks with `<!-- app-omit:start -->` / `<!-- app-omit:end -->` comments: the login/register and account modals, the
checkout and auth-status modals, the top-bar account buttons, the splash login row, the leaderboard's
complete-profile prompt and the web-only cancellation and withdrawal links. The website keeps all of that markup;
only the app copy strips it.

`bundle-check` fails when a runtime file is missing, when the bundled level configuration is not the full 60
levels, when any file references a remote first-party (`derschweigert.de`) URL, or when bundled code calls the FFM
API (`fetch` to `/api`, XHR or beacon), or when the app shell still carries account/checkout markup or links the
web-only cancellation/withdrawal pages (`FORBIDDEN_UI_IDS` in `scripts/bundle-check.mjs`). Approved navigational
legal links in `terms.html`/`terms.en.html` are the only first-party URLs allowed; they are text only and never
loaded.

Background music follows `game/tracks.json`: file, title, author, licence, optional `source` URL and optional
`stage` tag. The web build ships the one existing track; the app overlay replaces that manifest with
`mobile/game/tracks.json`, which is where the owner's M4 tracks are added. `game/music-manifest.js` supplies the
licence-page credits, and `tests/track-rotation.test.mjs` fails if a manifest file has no credit.

Game code reaches the outside world only through `game/platform.js`. The web build resolves
`static/game/platform-adapter.js`, which delegates to `api.js` and `access-flow.js`; the app build ships the
local-only `game/platform-adapter.js` from this directory instead, so `main.js` runs without the web API modules
(`tests/platform-app.test.mjs` asserts both halves).

Local progress lives in `game/progress-store.js`: the per-level best score, the timestamped score history and the
completed levels are one versioned JSON document per record in Capacitor Preferences, so the OS includes them in
device backups (Android SharedPreferences, iOS NSUserDefaults). A corrupt document or one from an unknown schema
version reads as empty instead of crashing. `BACKUP.md` records that backup model, how to verify a restore, and the
native flags the shell phase must keep; `tests/backup.test.mjs` asserts nothing excludes progress from backup.

`main.js` branches on `platform.getAccountAvailability()`: the app adapter reports `'none'`, so the title screen
hides the web leaderboard and renders the local personal-development panel (per-level best, the existing
score-history chart and a levels-completed overview) from that store. The web adapter reports `'optional'` and keeps
the server leaderboard unchanged.

`game/parental-gate.js` is the bilingual adult check for purchases, restores and links that leave the app. It asks
for the product of two operands spelled out in words between 6 and 12, which the free levels' addition up to 12
cannot solve, and exposes an async `gate({ ui, random, locale, action })` that resolves true only for the exact
product. `buildGateMarkup()` returns the accessible dialog (role, labels, numeric input, no answer); the UI is
injected, so the module has no DOM dependency and `tests/parental-gate.test.mjs` drives it with a fake UI.

`game/purchase.js` wraps the MPL-2.0 `@capgo/native-purchases` plugin (StoreKit 2 and Google Play Billing) for the
one-time `arithmoslayer_full_unlock` product. `queryProduct()` returns the store's localised price, `purchase()`
and `restore()` run the parental gate first, and every store result maps to a fixed outcome: success (after
acknowledging/finishing the transaction when the store asks for it), cancelled, pending/Ask-to-Buy, already-owned
or error. There is no backend and no third-party purchase service; `THIRD-PARTY-LICENSES.md` records the plugin
licence. `tests/purchase.test.mjs` drives the module with a fake plugin and a fake gate, while
`tests/restore.test.mjs` runs the real adapter, entitlement cache and paywall against a fake Capacitor
scope: a fresh-install restore unlocks levels 3-60, and a nothing-to-restore result, a store error and a
denied parental gate leave the cache and the levels untouched.

`game/lifecycle.js` is the app lifecycle seam. `main.js` imports it only in the app build (inside the
`platform.isApp` branch) and wires a small game facade. The module listens to `@capacitor/app`'s
`appStateChange` and `backButton` events: it pauses gameplay and BGM when the app leaves the foreground,
resumes only when that pause was automatic (a pause the player chose stays), maps Android Back to
pause → back out of the quit confirmation → exit, and drives `@capacitor-community/keep-awake` so the screen
stays awake only while a level is running. Orientation follows the device — the native shells lock nothing
and the responsive 16:9 canvas plus the `env(safe-area-inset-*)` padding in `static/styles.css` match the web
layout in portrait and landscape. `tests/lifecycle.test.mjs` drives the module with fake App, KeepAwake and
game objects. Three behaviours need a real device and stay manual gates, listed in `PENDING_MANUAL_GATES`:
the iOS silent switch, audio interruptions from calls or other apps, and safe areas on notched devices.

The native projects (`android/`, `ios/`) were generated by the maintainer with the real Capacitor tooling.
Tests assert the app identity (`de.derschweigert.arithmoslayer`, `Arithmo Slayer`), `webDir` `www`, the absence
of `server.url`, one Capacitor 8 version line, the development-file exclusions of `copy-assets`, and the native
store metadata. `tests/android-shell.test.mjs` asserts the Android shell offline: the
`de.derschweigert.arithmoslayer` identity in `build.gradle` and `strings.xml`, `android:allowBackup="true"` with no
backup rule file, exactly one exported launcher activity, no app-declared permission (Play Billing merges `BILLING`
plus its network permissions), the adaptive icon and splash wiring, and the `versionCode`/`versionName` defaults.
`tests/ios-shell.test.mjs` asserts the iOS half in detail: bundle identity and version keys, the `de`/`en`
localizations, the encryption exemption, the icon and launch screen wiring, and the privacy manifest (no tracking,
no collected data, only the `CA92.1` user-defaults reason) in the app target's Resources phase. A failing test here
is a report about the committed shell, not an invitation to edit it. `RELEASING.md` records the version scheme, the
merged-manifest permission check, the signing-secret names, the sandbox and internal-track procedure, the App Review
notes, the release handover and the manual gate checklist (including the iOS silent switch/audio session gate); every
native or owner gap is an open action there, not a native edit from a worker branch.

## Escalation: maintainer-owned files

These paths are owner-merged. Do not edit them from a worker branch; stop and escalate the exact change and its
reason to the maintainer instead:

- `package.json`, `package-lock.json` — dependency additions, version bumps, Capacitor major upgrades, scripts.
  This includes any new Capacitor plugin (purchases, preferences, keep-awake) and the `npm install` that follows.
- `android/` — Gradle files, `AndroidManifest.xml`, resources, `versionCode`/`versionName`, permissions, backup rules.
- `ios/` — `Info.plist`, `project.pbxproj`, `PrivacyInfo.xcprivacy`, entitlements, capabilities, localisations.
- `capacitor.config.json` — `appId`, `appName`, `webDir`, `server` settings and native plugin configuration; an
  identity change also requires regenerating both native projects.
- Signing material and store credentials (keystores, provisioning profiles, certificates, service credentials).

App-only runtime code and its tests belong in this directory (for example `app/` and `tests/`), and the copy
pipeline is extended there by the bundle work rather than by hand-editing `www/` or the native projects.
