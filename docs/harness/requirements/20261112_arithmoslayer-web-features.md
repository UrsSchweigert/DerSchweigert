# Arithmo Slayer: cooldown abilities, haptics, portrait swords, per-level stages (web and both apps)

Status: investigation input only; implementation and deployment are not approved
Date: 2026-11-12
Source: owner request 2026-11-12

**Scope is the web build *and* the Android and iOS apps.** `sites/ffm/static/` is the single source for both: the
site at `ffm.derschweigert.de` deploys it, and `sites/ffm/mobile/scripts/copy-assets.mjs` copies it into the app
bundle apart from an explicit exclusion list (web-only APIs, tests, generation sources). A feature implemented in
`sites/ffm/static/` therefore reaches the website and both apps without a second implementation — that is the reason
the shared modules below are named there and not under `sites/ffm/mobile/`. "apps/web" in the owner's wording means
this static build; the repository has no `apps/web/`.

Owner decisions recorded 2026-11-12 (do not reopen them in the plan):

| Decision | Choice |
|---|---|
| Platforms | Web, Android app and iOS app. Shared game code in `sites/ffm/static/`; app-only seams under `sites/ffm/mobile/`. |
| Ability activation | Manual: three HUD buttons beside/below the playfield. No auto-cast, no keyboard-only path. |
| Ability roster | Wind, storm, earth spikes. |
| Unlock schedule | One ability every 5 levels across the first 15 levels: wind from level 1, storm from level 6, earth spikes from level 11. All three slots are visible from level 1; locked slots are dimmed silhouettes **without artwork**. |
| Base cooldown | 180 s per ability, ticking only while an encounter is running. |
| Presentation | Every unlocked ability needs artwork, a ready glow, a sound and particle effects. |
| Level bonus | Exactly one small bonus per level, starting at level 2, applied to an ability that is already unlocked. Fixed sequence, and the player must be told which bonus they just earned. |
| Vibration | On impact and on healing, **in the web build and in both apps**. Web uses `navigator.vibrate` where the browser has it; the apps go through `@capacitor/haptics`, because iOS WKWebView has no Vibration API and the Android WebView needs the `VIBRATE` permission. |
| Swords | The app's portrait sword row must also appear in the web build, in the same portrait layout. |
| Backgrounds | 60 backgrounds, one per level, in exactly the style of the six shipped stage images (measured spec below, taken from the images themselves — **not** the story ART-BIBLE); in level *x* the next level's place is already visible. The level-clear screen previews level *x+1*'s scene. |
| App art budget | The 19 MB that 60 level images add to the app bundle are accepted. Record the measured growth; do not reduce the web image quality for it. |
| Model stack | DeepSeek only for every agent role. The single exception is image generation, which uses the GPT image model behind the `image_generation` tool — the same model that produced the six existing stage images. |

## Requirement inventory

| ID | Requirement | Phase | Description |
|---|---|---|---|
| **1.1** | **Cooldown ability model** | P1 | A pure, DOM-free, unit-tested module (`static/game/cooldown-abilities.js`) owning the roster, unlock levels (1/6/11), the 180 s base cooldown, per-ability cooldown reduction, storm strength, spike slow parameters, and the passive fiend-speed modifier. Exposes cooldown progress as a 0-1 ratio and never calls `Math.random()` or `Date.now()`. |
| **1.2** | **HUD slots** | P2 | Three slots in the play area, visible from level 1. Locked: dimmed silhouette, no artwork, `aria-disabled`, not focusable as an action. Unlocked: artwork, ready glow, cooldown sweep/mask with a readable remaining time, 44 px minimum target, keyboard operable, localized name and description. They must not overlap the answer row or the sword row in portrait. |
| **1.3** | **Wind** | P2 | Clears the active fiend off the field (existing retreat path) and counts the encounter as resolved without score, combo or timing records, so level completion stays reachable. Disabled while no encounter is active. |
| **1.4** | **Storm** | P2 | Removes 1 + storm rank enemies from the level's remaining count (capped so at least one encounter still has to be fought). The removed enemies leave the level instead of counting as defeats: the encounter total shrinks, the Defeated readout drops to the smaller denominator and the portrait sword row loses exactly their swords. Each removal adds its own screen-fx burst, the departing swords puff off the row and one chained thunder cue plays. A level already at its last encounter cannot be finished by the storm alone. |
| **1.5** | **Earth spikes** | P2 | Slows the active fiend and the next spawns for a duration by a factor, with spikes and a slow aura for exactly that duration. The slow ends cleanly on level change, pause and retreat; no NaN or permanent speed drift. |
| **1.6** | **Ability art, sound, FX** | P3 | One pixel-art icon per ability in the stage palette (cyan magic, brass gold, warm amber; see the measured style spec), a ready glow, a cast sound built from the existing `audio.js` engine (no downloaded assets), and a screen-fx recipe composed from the existing helpers in `screen-fx.js` / `screen-fx-effects.js`. The three icons are owner-delivered assets committed before the phase; the worker wires, styles and preloads them, and falls back to a text label when one is missing. |
| **2.1** | **Bonus ladder** | P1 | One bonus per level from level 2, cycling a fixed four-step sequence — faster cooldown, stronger storm, fiends walk slower, more fiends slowed — assigned round-robin over the abilities unlocked at that level. Pure and unit-tested; every value has a documented cap. **Every earned bonus is applied to the live run, not only displayed**: a run started at level n replays the ladder up to n into the ability runtime (cooldown reductions, storm rank, passive fiend speed, spike targets), and each level start re-applies the same ladder to that runtime, so starting high or advancing is never a downgrade. |
| **2.2** | **Bonus notice** | P4 | At level start the player is told which bonus was just earned and for which ability, in DE and EN, through the existing overlay/toast pattern. No notice on level 1. |
| **2.3** | **Bonus visibility** | P4 | The slot readouts (remaining cooldown, storm count, slow strength) reflect the earned bonuses; tests pin level 1, a mid-chapter level and level 60. |
| **3.1** | **Haptics module** | P6 | Pure, DOM-free module with an injectable `vibrate` function and named patterns for impact and heal. A separate source resolver picks the platform driver: `navigator.vibrate` when the browser has it, otherwise a **lazy, guarded** `import('@capacitor/haptics')`, otherwise a no-op. The no-op path must also cover a device that has no vibration motor, the preference being off, and `prefers-reduced-motion`. Never throws when the plugin or the API is absent. |
| **3.2** | **Haptic triggers** | P6 | One vibration per event: sword/fireball/lightning landing on a fiend, hero damage, hold-to-heal heart, recovery heal, level-clear aura. Never on every animation frame, never on a locked or rejected ability cast. |
| **3.3** | **Vibration preference** | P6 | A persisted on/off control next to the existing audio settings, default on, DE/EN, in the web build and in both apps (the app already persists audio preferences through the same seam). |
| **3.4** | **App haptics wiring** | P6 | The app build vibrates on the same events: `@capacitor/haptics` is used when present, with the Android `VIBRATE` permission merged by the plugin's own manifest. Both are maintainer-owned prerequisites (M5, M6) — no worker edits `package.json`, `package-lock.json`, `AndroidManifest.xml` or the native projects. The game code, its tests and the app bundle must all pass **before** the plugin lands, because the resolver's no-op path is what ships in that state. |
| **4.1** | **One sword module** | P6 | The app-only `encounter-swords.js` becomes a single shared module under `static/game/`, with one stylesheet block. The app copy is removed rather than duplicated; `mobile/scripts/copy-assets.mjs` and its bundle check keep passing. |
| **4.2** | **Web portrait row** | P6 | The web build renders the row in portrait exactly as the app does: one sword per enemy, filled green left to right, glint on fill, `aria-hidden`, hidden in landscape and while hidden, no layout shift of `#mc-buttons`. |
| **5.1** | **Level art manifest** | P7 | `static/game/levels/manifest.json` maps level → 16:9 background. Resolution order is level art → chapter stage art → legacy background, with the existing `waitForBackgroundLoad()` contract intact so no wrong or blank frame flashes during a swap. |
| **5.2** | **Per-level backgrounds** | A1 (outside the harness) | 60 pixel-art backgrounds matching the measured style spec, one per level, generated from the six existing stage images as style references, each already showing the next level's setting on the horizon. Produced by the owner with the GPT image model and committed before P7; no worker issue generates, downloads or retouches art. |
| **5.3** | **Next-scene preview** | P7 | The level-clear screen shows the next level's scene (title and preview image) before continuing; level 60 shows the finale instead. |
| **5.4** | **Preload budget** | P7 | Only the current and next level image are preloaded/decoded; each image stays within the agreed byte budget; no new eager load of the legacy fallback. |
| **QA1** | **Unit coverage** | all | Every new pure module has a `node --test` suite; the full `node --test sites/ffm/static/game/*.test.js` stays green. The Python suite needs Flask and boto3, which the worker image does not install, so it runs in CI (`deploy.yml`), not as a worker check. |
| **QA2** | **No behaviour drift, both channels** | all | Auth, billing, leaderboard, scoring, combo abilities, healing and the app bundle keep today's behaviour; no new network request, no new paid service, no analytics. Every phase's checks run for the shared code *and* for the app bundle, because both consume `sites/ffm/static/`. |
| **QA3** | **i18n parity** | all | Every new string exists in DE and EN; `i18n.test.js` stays green. |
| **QA4** | **App bundle and weight** | P7/P8 | `cd sites/ffm/mobile && npm test` passes; the moved module, the ability icons, the manifest and every present level image are in the bundle check; `docs/ffm-game-assets.md` records the measured `www/` growth against the accepted ~19 MB for 60 level images. |
| **QA5** | **Accessibility** | P3/P6 | The three slots are reachable and named, the vibration toggle is announced, and nothing new traps focus or depends on colour alone. |

## Maintainer-owned prerequisites (outside worker authorization)

These touch protected paths or owner accounts. Workers must not attempt them; they stay visible until they have
evidence.

- **M5 Capacitor Haptics.** Install `@capacitor/haptics` (major matching Capacitor 8) in `sites/ffm/mobile`,
  update the lockfile, run `npm run copy-assets` and `npx cap sync` so the Android `VIBRATE` permission and the iOS
  plugin registration exist. Requires merging a `package.json`/native change. Until then the resolver's no-op path is
  what ships, and every phase must stay green in that state.
- **M6 Vibration on a device.** Manual check on a real Android phone and a real iPhone: one buzz on a fiend impact and
  one on a healed heart, silent when the setting is off. Cannot be proven by a JavaScript test.
- **M7 Level art and ability icons.** The 60 background images and the 3 ability icons are committed by the owner
  before P8 and P4 consume them (see the art section).

## Art production (the one step outside the DeepSeek stack)

Image generation cannot run inside the worker sandbox and is not a harness role. It is done by the orchestrating
agent with the `image_generation` tool, before the asset-integration phase, in six batches of ten levels.

**The style is measured from the six shipped stage images, not taken from `static/story/ART-BIBLE.md`.** That bible
describes the story dioramas (paper theatre) and is the wrong reference for the playfield backgrounds; the shipped
`stage-1`-`stage-6` renders are high-density 16-bit pixel art. The measurements below were taken on
2026-11-12 against those six files and are the authoritative style spec for levels 1-60.

### Measured style spec

| Aspect | Finding |
|---|---|
| Medium | High-density 16-bit console pixel art (SNES/Amiga adventure look). Not paper cutout, not 3D, not photographic, not painterly. |
| Raster | 1536×1024 renders with visible 2-4 px pixel clusters, hard edges, **no anti-aliasing and no blur**. Materials use 3-5 step colour ramps with ordered dithering at transitions and a 1-px dark outline on silhouettes. |
| Detail budget | Highest edge density in the midground band (Sobel mean ~10-19), clearly calmer sky and foreground (~4-13), because hero and fiends must read against it. |
| Composition | One-point perspective with the vanishing point on the horizontal centre; road, paving or carpet runs from the bottom centre to it; symmetric flanking masses (houses, tree clumps, columns) frame a central gate. Horizon/transition band sits at 30-58 % of the height. |
| Arena | The lower 35-50 % is a walkable, textured ground plane (dirt, cobbles, grass, carpet) with stones, flowers and glow specks but **no tall props** — that is where the hero and fiends stand. |
| Light | Low-key with a strong vignette (5-30 % of pixels below V 0.18). Practical lights (lanterns, candles, windows, magic) carry a hard 1-2 px bloom halo and long reflections. Two-light scheme: warm amber for safety, cold cyan-blue as the only saturated cool light for magic. |
| Exposure | Mean luminance 47 (throne hall) to 135 (woodland hall); saturation 0.49-0.78 — chapters I/II/IV are bright, III/V/VI are night-dark. |
| Absent | No characters, no UI, no text, no logo, no frame or border. |

Measured dominant colours per chapter (median cut, 8 colours, share > 4 %):

| Chapter | Levels | Dominant colours | Mood |
|---|---|---|---|
| I | 1-10 | `#9c6f2e` `#754b1c` `#423516` `#11110a` `#347095` `#6ca1a5` `#c9a869` `#183825` | daytime village, warm earth, sky blue, cyan runes |
| II | 11-20 | `#ac6539` `#825031` `#e39656` `#6d3e1f` `#493824` `#2f2116` `#886162` `#bb7759` | sunset fields, amber and orange |
| III | 21-30 | `#01242d` `#155733` `#346527` `#468125` `#73a626` `#0f352c` `#072d2f` `#2b352a` | night forest, saturated green, blue-violet glow |
| IV | 31-40 | `#1a8e3f` `#aeba50` `#b7e4b9` `#519389` `#386d2e` `#2e4022` `#50bc6a` | daylight woodland hall, fresh green |
| V | 41-50 | `#07040f` `#393042` `#70534d` `#957664` `#311e2e` `#1b1424` `#573c3c` `#0c0e24` | night square, lavender stone, warm windows |
| VI | 51-60 | `#161021` `#101f5d` `#52423e` `#94794e` `#32262a` `#010947` `#090e31` | throne hall, midnight blue and gold |

Prop vocabulary shared by all six: timber-framed buildings with red tiled roofs, windmill, stone tower, lantern posts
with iron hooks, wooden fences carrying glowing rune glyphs, banners with a rune sigil, market awnings, a stone
fountain with a rune obelisk, stained glass, gold filigree, leafy trees with exposed roots, blue and violet ground
flowers.

### Frame constraints for new renders

- Render 1536×1024. The renderer scales to the 800 px canvas width and centre-crops to 16:9, so **only y 80-944 is
  ever visible**; keep every landmark inside that band.
- Keep key landmarks inside x 120-1416 (portrait crop and HUD), and nothing important in the outer 40 px, because
  `drawBackground()` tiles the image horizontally at 0.2 parallax — the edges must join without an obvious seam.
- Chapter handovers stay as in the ART-BIBLE settings table (village, fields, forest, woodland hall, night square,
  throne hall); the measured spec above overrides the bible for medium, palette and light.

### Generation recipe

- **References** per batch: the matching `static/game/stage-<n>.webp` as the style reference, and the next chapter's
  stage image for the horizon landmark. No character reference: the stage art shows no characters.
- **Prompt file**: `static/game/levels/PROMPTS.md`, one row per level, assembled as
  `[style clause] + [chapter setting] + [level step] + [next-level landmark] + [negative clause]`, with the style
  clause and negative clause below used verbatim.
- Style clause: *high-density 16-bit pixel art background, hard pixel edges, no anti-aliasing, 3-5 step colour ramps
  with ordered dithering, 1-pixel dark outlines, one-point perspective with the vanishing point at the horizontal
  centre, symmetric flanking masses framing a central gate, walkable empty ground plane across the lower 40 % with no
  tall props, low-key lighting with a strong vignette, warm amber practical lights with hard bloom halos plus cold
  cyan-blue magic glow as the only cool light.*
- Negative clause: *paper cutout, paper theatre, cream paper border, 3D render, photograph, painterly brushwork,
  smooth gradients, anti-aliased edges, blur, depth of field, characters, text, watermark, frame, border, UI,
  isometric, top-down.*
- **Journey**: each level moves the camera one step toward the next chapter's setting, so level 10 already shows
  act II's fields on the horizon and level 59 already shows the throne room.
- **Output**: 1536×1024 render → centre-crop to 16:9 → WebP around quality 85 through the existing
  `sites/ffm/scripts/optimize-art.py` path → `static/game/levels/level-01.webp` … `level-60.webp`.
- **Provenance**: one row per image appended to `static/promo/art/PROVENANCE.md` (tool, model note, references,
  date), consistent with the existing table.
- **Review gate**: each batch is checked against the measured style spec above (medium, palette, symmetric framing,
  empty arena, ground band, no text or figures) before the manifest lists it; an unapproved level falls back to its
  chapter stage image, so a missing image is never a broken background.
- **App weight**: all 60 images ship in both app bundles (`copy-assets.mjs` copies everything under `static/game/`
  that is not excluded). At ~320 KB each that is roughly 19 MB, which the owner accepted on 2026-11-12; record the
  measured growth instead of shrinking the web art.

## Planned phase shape (guidance for the investigator, not a locked plan)

Shared shell files (`main.js`, `index.html`, `styles.css`, `i18n.js`) are the contention points. Keep them in as few
phases as possible and order the phases so no two issues edit the same file in one phase.

| Phase | Scope | Mostly touches | Depends on |
|---|---|---|---|
| P1 | Pure models: cooldown abilities, bonus ladder (new files + tests) | `static/game/cooldown-abilities.js` | — |
| P2 | Slots, activation, wind/storm/spike effects, cooldown ticking | `main.js`, `index.html`, `styles.css` | P1 |
| P3 | Ability art, ready glow, cast sounds, screen-fx recipes | `static/game/assets` for icons, `screen-fx-effects.js`, `audio.js` | P2 |
| P4 | Bonus notice and bonus-aware readouts | `gameplay-chrome.js`, `main.js`, `i18n.js` | P2 |
| P5 | Haptics model, platform driver resolver, triggers and persisted preference (web + app) | `static/game/haptics.js`, `main.js`, `audio-preferences.js`, settings markup | P2 |
| P6 | Shared sword row for web + app | `static/game/encounter-swords.js`, `styles.css`, `main.js`, `mobile/scripts/copy-assets.mjs` | P2 |
| P7 | Per-level background resolution, preload, level-clear preview | `renderer.js`, `main.js`, `static/game/levels/manifest.json` | P2, A1 |
| A1 | Asset task: 60 generated backgrounds, prompts, provenance | `static/game/levels/`, `static/promo/art/PROVENANCE.md` | owner/agent, outside the sandbox |

## Execution and evidence boundaries

- **DeepSeek stack only.** Run with `--model-source deepseek` (`HARNESS_MODEL_SOURCES=deepseek`). The menu is
  `deepseek/deepseek-flash` (low/standard) and `deepseek/deepseek-v4-pro` (strong). The single exception is the
  GPT image model in A1 — no other agent, tool or service leaves the DeepSeek stack.
- **No worker touches raster art.** A worker in the sandbox has no image model, no network and no keys. The 60 level
  backgrounds and the three ability icons are committed by the owner before the phase that consumes them; a worker
  only validates and wires files that already exist, and every phase must pass its checks while those files are
  absent (chapter-stage fallback, text-label fallback).
- **Do not set `policy.model_routing`.** It buys a plan pass for every issue. It is no longer needed to keep the
  refiner cheap: refinement starts on the standard band (`deepseek/deepseek-flash`) and climbs to
  `deepseek/deepseek-v4-pro` only on its own failed pass.
- **Keep the reviewer independent.** The reviewer runs on `deepseek/deepseek-v4-pro` whenever the implementer runs on
  `deepseek/deepseek-flash`; a same-model review is refused by the plan.
- **Refiner cost.** Refinement starts on `deepseek/deepseek-flash`; the strong band is an escalation earned by a
  failed refinement pass on the same issue, never a per-issue choice.
- **Overseer on.** `harness plan` runs with the overseer enabled (the harness default since 2026-11-12). A process
  block - a lost lease, a repeated check failure, a stall - is answered by the strong-tier overseer before you are
  asked; harness defects and content questions still reach you with its diagnosis. The bound is two rounds per issue.
- **Documentation-only issues** carry `"tier_fit": "low"`.
- **Issue ID prefix**: `ffmweb-`, so run branches and pull requests stay distinguishable from other runs.
- **One promotion, one deploy.** Use the run branch; `main` only moves through the promotion pull request, so the
  deploy happens once and not per issue.
- **Stable anchors.** New modules anchor on their own files. Issues that must touch `main.js` anchor on the smallest
  surrounding block they own, not on the file.
- **Both channels are in scope for every phase.** A phase that changes `sites/ffm/static/` changes the website and
  both apps at once, so its checks include the app bundle suite; a phase that says "web" and means only the website
  must say so explicitly.
- **Manual checks that cannot be automated** stay recorded as pending, never claimed: vibration feel on a real
  Android phone and a real iPhone after M5, the art review against the measured spec, and the portrait sword row on a
  real narrow phone.

## Verification commands

```
node --test sites/ffm/static/game/*.test.js                 # shared code: web + both apps
cd sites/ffm/mobile && npm test                              # app bundle, copy-assets, bundle check
node sites/ffm/static/game/levels/check-art.mjs --manifest    # level art manifest (tolerant of missing images)
SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q             # CI only: needs Flask and boto3
```

## Non-goals

- No change to the 60-level curriculum, scoring, combo abilities, healing mechanics or difficulty pacing.
- No new paid service, no analytics. The only new native plugin is `@capacitor/haptics` (M5), installed by the
  owner, never by a worker.
- No redraw of hero, fiend or item sprites; only the three ability icons and the 60 stage backgrounds are new art.
