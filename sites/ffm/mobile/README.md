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
`game/access-flow.js`, `game/cancel-request.js`, `game/withdrawal-request.js`, `cancel.html`, `widerruf.html`, the
website's own legal pages `datenschutz*.html`, `impressum*.html` and `terms*.html`). It
then overlays the app-only modules from `game/` onto
`www/game`, so `game/platform-adapter.js` replaces the web adapter of the same name. `www/` is reproducible: the
same inputs always produce the same bundle and a stale file from an earlier build is removed.

After the copy it generates `www/game/level-data.js` from the private curriculum in `../app/level_data.json`
(all 60 levels, including `baseline_score`). That module exists only in `www/`; the private curriculum is never
written into `../static`, which deploys to the website. It also drops the web-only visitor-tracking inline script
from `index.html`, because the app is offline and must not call the FFM API, and every DOM region `index.html`
marks with `<!-- app-omit:start -->` / `<!-- app-omit:end -->` comments: the login/register and account modals, the
checkout and auth-status modals, the top-bar account buttons, the splash login row, the leaderboard's
complete-profile prompt, the web consent banner and the whole web legal footer (cancellation, withdrawal, imprint,
website privacy, website terms). The website keeps all of that markup; only the app copy strips it. The title
screen keeps the empty `.splash-legal-links` container, which `game/legal.js` fills at runtime with the bundled
`legal/*.html` pages in the active language.

`bundle-check` fails when a runtime file is missing, when the bundled level configuration is not the full 60
levels, when any file references a remote first-party (`derschweigert.de`) URL, when bundled code calls the FFM
API (`fetch` to `/api`, XHR or beacon), when the app shell still carries account/checkout markup, when a website
legal page (`datenschutz*`, `impressum*`, `terms*`) reappears at the bundle root, or when the app shell links one
(`FORBIDDEN_UI_IDS`, `FORBIDDEN_FILES` and `FORBIDDEN_NAV_RE` in `scripts/bundle-check.mjs`). Every bundled
`legal/` page, in both languages, is a required file, so a legal link the app renders can never point at a page
the bundle dropped.

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
Story scenes always play in a landscape box: a portrait-held device gets the
diorama laid out in the swapped (landscape) box and rotated 90°, so the paper
theatre fills the screen and the player turns the phone. Gameplay itself is
unaffected.

`appStateChange` and `backButton` events: it pauses gameplay and BGM when the app leaves the foreground,
resumes only when that pause was automatic (a pause the player chose stays), maps Android Back to
pause → back out of the quit confirmation → exit, and drives `@capacitor-community/keep-awake` so the screen
stays awake only while a level is running. Orientation follows the device — the native shells lock nothing
and both iOS build configurations target iPhone and iPad. The uncropped 800×450 scene maximizes remaining
space: scene left/answers right in landscape, scene above/answers below in portrait. All 5 or 10 arithmetic
answers remain simultaneously visible with at least 44×44 CSS-pixel targets. `viewport-layout.js` follows
`visualViewport` resize/scroll (including keyboards) and four-edge safe-area CSS without restarting, pausing,
or saving gameplay. Title, family, progress, gate, paywall, pause and result screens are framed
stages: every title page except Play is one menu sheet that fills the band when its content needs
the room and shrinks to a centred card when it does not, and the sheet scrolls so a long list
reaches its pagination instead of clipping. In a short landscape band the legal-links stage switches
to two columns so all five chips stay whole. Legal documents keep their own scrolling and full content.
Title mode rows share the available height above navigation, with at least 44px touch targets and a 6px
navigation gap. Compact portrait screens omit the decorative introduction to preserve those controls;
player and mode-selection text stays white with dark shadows over the sharp artwork.
This includes 375x667 iPhone SE layouts with saved progress. Player-name forms retain their input
element across window/visual-viewport resizes so opening the software keyboard does not discard focus
or the draft. Name and parental-gate inputs use 16px text to avoid iOS focus zoom. Score history shows
an explicit empty state or a labelled score scale and best-score summary, including the first result.
`tests/lifecycle.test.mjs` drives the module with fake App, KeepAwake and
game objects. Three behaviours need a real device and stay manual gates, listed in `PENDING_MANUAL_GATES`:
the iOS silent switch, audio interruptions from calls or other apps, and safe areas on notched devices.
Keyboard staging, all ordinary-screen actions, long DE/EN labels, both phone orientations and tablet rotation
also need physical-device verification; JS geometry/static shell checks are not native build or device evidence.

Local family profiles are the app default. Each profile has separate names, scores and cleared-level
checkpoints, and switching is allowed only on the title screen. This unlaunched app has no legacy-profile
migration. Every cleared level is saved locally automatically, including level 60, and title progress refreshes
when returning. An incomplete current level is not banked; replaying does not erase an existing checkpoint.
Storage/load errors are visible in profile or progress status rather than silently appearing as lost progress.

Play continues at the active player's first unfinished arithmetic level, even when earlier replays leave gaps.
The Levels stage also offers only that player's cleared levels for replay; clearing all 60 defaults to replaying
level 1 rather than requesting level 61. Difficulty still comes from the Play cards, purchases remain device-wide,
and native continuation/replay begins at score zero without server-style baseline points. Defeat retry restores
the selected difficulty's hearts and timer while keeping the level-start score checkpoint; Shapes retries restore
their nine hearts. Completing the campaign uses victory messaging, not defeat audio.

The active question, hearts, timer, combo and score have readable DOM readouts independent of canvas scaling,
with a visible Pause button. Title/progress/pause identify the active family player. Answer buttons accept pointer,
click, Enter and Space activation without submitting twice; holding to heal remains compatible with another touch.
Level 11 introduces ten choices using level 10's familiar arithmetic before level 12 increases the range.
Short landscape screens omit the introductory sentence and ellipsize long names on Play; the family screen
keeps the full name and all profile actions.

Gameplay reports defeated encounters (not answered or mastered questions), upcoming combo spells using the
actual 6/11/21 thresholds, and the dragon's 80% chance. Mistake corrections and timeout feedback remain in
the readable question area. Shapes counts agree across the canvas, DOM and answers for the full 1-10 range.
Healing progress describes the left quarter of the playfield; recovery still takes nine seconds and is interrupted
by injury. Experimental recovery is separate from ordinary hold-to-heal.

The gameplay header keeps one height for the whole level. `#gameplay-feedback` reserves its reveal line
(`min-height: 20px`, hidden with `visibility` rather than removed) and `#active-question` reserves the two-row
Shapes header (`data-two-row-question` on `#gameplay-chrome`, 52px on Shapes levels) between problems and during
the reveal. `viewport-layout.js` lays the scene out from the measured header height, so a collapsing question row
or a growing reveal line used to rescale the playfield and the answer grid after every wrong answer.

Arithmetic results include correct first answers out of questions attempted and best consecutive-correct streak.
A requeued copy is not a new first attempt; corrected answers, mistakes and timeouts are tracked separately.
Native cleared-level summaries are saved atomically with that player's score and completion receipt, and compared
only with the same player's previous clear of the same level and difficulty. Existing records without summaries
keep their progress; they do not receive fabricated statistics. These accomplishments are personal arcade goals,
not mastery certification. Web summaries are transient and do not change the score API.

Pause, healing-tip and result overlays isolate the background and manage keyboard focus. Native quit offers one
Return to Title action and explains that cleared progress stays saved while the unfinished attempt is not banked.
The contextual help dialog warns above its manual link that the full manual is a separate page and ends the running
level whenever help was opened during a run (play, practice or pause); title-screen help carries no such warning.
Discarding a score and deleting a player use the red danger tier, saving and resuming use the brass primary tier.

### Optional practice and introductions

Practice uses authorized level content without banking scores, clearing campaign
levels or changing unlocks. Targeted practice revisits up to five distinct recent
mistakes without a timer. Short, assisted, elite and recovery trials stop after ten
encounters; assisted practice is untimed. Elite trials use at least three enemy HP
and restart the timer for each new question. Recovery trials grant one heart after
five distinct correct replies (corrected retries count once), at most two hearts
per attempt; full-health credit is discarded rather than banked. Spell kills never
count as correct replies or recovery credit. Finite Shapes practice resolves ten
questions and finishes only after the final correction has been shown; Endless
Shapes remains available.

Descriptive practice badges are stored per family player with atomic, retryable
session receipts. They do not certify mastery, create currency or alter campaign
history. See [BACKUP.md](BACKUP.md) for their persistence contract and
[the system documentation](../README.md#experimental-practice-and-score-comparability)
for the required score-version boundary before any trial is promoted.

Optional untimed worked examples introduce subtraction, multiplication and division
at levels 5, 25 and 34 after authorization, with Continue/Skip and no score writes.
Canonical product/dividend ranges remain unchanged; the generator supports explicit
`maxProduct`/`maxDividend` constraints for a separately reviewed curriculum change.

### Visual and audio validation boundary

The shared interface uses dusk-forest, ivory and brass colors with reduced-motion
support. Title stages use redesigned, text-free fantasy artwork without blur.
Landscape uses a dedicated wide composition; portrait uses a centered crop and
additional inner padding. Other
overlays and the portrait answer section use darkened, blurred versions. Mode
choices are a vertical stack of oblong rows; player controls share the brass/forest
palette, and pause/audio labels and actions are consistently centered. Decorative
layers cannot intercept controls. Interface words remain intact; sentences may wrap
at spaces, and compact navigation uses a proportional font to fit complete labels.
Menu typography is one scale, defined once in `styles.css`
(`--text-button`, `--text-body`, `--text-option`, `--text-heading`): every menu button
uses the title-page tab size and `system-ui`, every explanation and status line uses the
difficulty-explanation size ("15 seconds · 7 hearts", 12px monospace, muted ivory), and
option names and screen headings are the only larger steps. Bold and ivory are reserved
for headings, the selected tab and the one primary action, so no menu screen mixes five
near-identical text sizes or uses pure white for body copy.

Both website and app show the selected starting level as hand-drawn, illuminated
SVG numerals in the title's upper-left corner, with a localized accessible label.
The Practice tab (German: Training) opens "Practice sessions" / "Übungseinheiten" as a submenu: its summary
carries the tab's own heading style and a Back button (plus Escape) closes it and returns focus to the summary.
The open submenu *is* the page: the sheet scrolls, so Start practice and Back stay reachable even on a 640px-tall
phone, and portrait stacks each selector label above its control while landscape keeps label and control side by side.
Long passages in dialogs and panels are left-aligned with an 8px side inset and 8px of air before the action
that ends them; only the welcome text, headings and one-line labels stay centred. Every menu label stays inside
its button: words break only as a last resort and the tab row wraps onto a second line instead of clipping.
The tab explains the selected training mode beside its selector and names the
selected level's arithmetic in one line ("Level 15: addition and subtraction, results up to 20 · 10 answer
choices"), read from the same authorized level config the session runs on, so it cannot drift from the
curriculum; a locked level says so instead of inventing a summary. Disclosure labels ("Practice sessions",
"Audio settings") are centred in their bars. In the app,
player-name editing and deletion hide purchase/notice content until the stage
closes. Terms navigation and manual navigation use stacked forest/brass buttons;
the manual offers a game-return action above its contents and at the bottom.
The title uses large generated lettering art with an accessible heading and image
label, centered independently of utility buttons. Other headings use the original
monospace font. The introduction welcomes young and old to mental-math training;
it has no tall background panel, and padded, short text lines leave the artwork
visible. A round replay control at the start of the title bar, left of Login, plays
the prologue again.
Shared four-edge inset variables default to native
safe-area values and allow explicit notch/status-bar geometry fixtures.
Pause offers Back to game, audio settings offer Back to pause, and
quit confirmation retains its Back action. Pause actions and the audio disclosure
share one 560px column and one 44px control height, so hiding the save button
(guests, practice, shapes) never leaves an empty grid cell.
Android Back closes audio settings
before resuming gameplay. Returning to untimed practice restores answer input.
Gameplay keeps 22px questions, 16px numeric HUD and 18px answers; answer
column sizing measures text so five-digit choices retain at least 44px targets.
In portrait the header shows the countdown as text only ("Time 12s"): the app's
timer stripe is hidden there, since the play area starts right under the chrome.
Landscape keeps the stripe.
The native bundle is validated in simulated phone/tablet portrait and landscape
viewports, but this is not physical-device touch or safe-area evidence.

Effects share an adjustable, muted gain bus with conservative headroom. Correct,
wrong, timeout, actual healing and campaign-victory events have distinct cues;
wrong/timeout feedback does not also stack the hurt cue. Device-wide audio
preferences (effects, music, mute) persist separately from family progress. In
the app shell bundled music is fetched once from the bundle origin and played
from same-origin blob URLs so it can share the Web Audio gain path; the music
slider accepts a gain before first playback and applies it to the routed track.
One title speaker menu contains music, effects and mute controls; the UI states
the limitation only when routing is unavailable. See [MUSIC.md](MUSIC.md)
for the routing path and the physical-device listening gates. No new songs or
hero/weapon art are included.

#### Physical-device audio gates

Automated tests use fake media elements and Web Audio contexts, so they prove
the gain graph, persistence and UI wiring only. Before claiming native audible
output, record the revision under test and verify all of these on a physical
iOS and Android device:

- Bundled music and effects are audible through the speaker and headphones.
- The app music slider changes live gain at 0, 0.2 and 1 while a track plays,
  and the effects slider changes the next effect cue.
- The iOS silent switch silences music and effects; unmuting restores them.
- A call or alarm interruption pauses music and gameplay, and returning resumes
  both exactly once with mute and gain preserved.
- Background/foreground transitions do not duplicate playback.

Revision to test: `<revision>` — replace with the commit SHA (and device/OS
build) that passed these gates. Any native audio-session change needed to pass
them is owner-reviewed: this branch changes no `android/`, `ios/`,
`build.gradle`, `AndroidManifest.xml`, `Info.plist` or `capacitor.config.json`.

Shared wiring calls `initViewportLayout({win,doc})` once; its `{refresh,destroy}` API is layout-only. Title
navigation buttons use `data-title-target`, and parent wiring toggles `hidden` on matching `data-title-page`
stages (`play`, `progress`, `history`, `family`, `leaderboard`, `levels`, `legal`). `#local-profiles` is initially hidden and
contains `#profile-root`; the website keeps family controls hidden. Practice uses `#personal-development-error`
and `#personal-best-prev`, `#personal-best-page`, `#personal-best-next` (three records per page); leaderboard
has matching `#leaderboard-prev/page/next` controls. `#personal-history-toggle` opens the separate history
stage (chart and completed overview), leaving three best rows visible even on tiny landscape screens.
Full chart/history content must be staged/paginated by
shared wiring, never truncated to fit. All arithmetic answer choices remain on one screen.

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
native or owner gap is an open action there, not a native edit from a worker branch. `tests/releasing.test.mjs`
asserts that handover: the required sections and commands, the signing-secret names, the product id and store
checklist, one open revision-placeholder row per manual gate, and M1-M4 plus the owner store actions as open.

## Xcode and Xcode Cloud

Open `ios/App/App.xcodeproj` and select the shared **App** scheme. Local Run and
Archive already prepare and verify assets automatically via `tools/ios/prepare-capacitor.sh`.
On a fresh checkout, run `npm ci`, `npm run copy-assets`, and
`./node_modules/.bin/cap sync ios` before opening Xcode, so package resolution has its inputs.

For Xcode Cloud, create a workflow in Xcode's **Product > Xcode Cloud > Create Workflow**:
choose this repository, `ios/App/App.xcodeproj` under `sites/ffm/mobile`, and the shared
**App** scheme. The committed `ios/App/ci_scripts/ci_post_clone.sh` restores locked npm
dependencies, prepares and verifies the offline bundle, syncs native plugins, and runs
mobile tests before Xcode resolves packages. It uses Node.js 22+ or installs Homebrew's
`node@22` on the Cloud runner if needed. Preparation failures stop the build.

Configure branch triggers, signing team, App Store Connect association and optional
TestFlight distribution in Apple's UI. Those account settings are not repository files
and are not automatically provisioned here. No store upload runs from GitHub Actions.

The **Arithmo Slayer: build artifacts** GitHub workflow supports manual runs and `arithmoslayer-v*`
tags. See `RELEASING.md` for artifact contents and how to open the prepared Xcode project.
After extracting the Xcode artifact, keep its directory layout and run
`node scripts/stage-ios-project.mjs --relocate /absolute/path/to/extracted-artifact`
from its `sites/ffm/mobile` directory to rebase the included Swift package cache.
The documented unsigned archive command uses that cache without package downloads;
opening the project in Xcode normally may still use the network.

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
