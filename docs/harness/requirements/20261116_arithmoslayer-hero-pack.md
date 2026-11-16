# Arithmo Slayer: hero pack (playable heroes for the apps' second in-app purchase and the web subscription)

Status: investigation input only; implementation, release and publication are not approved
Date: 2026-11-16
Source: owner request 2026-11-16, revised the same day three times: full in-game heroes instead of portraits only;
the web subscription includes the pack; the harness produces the art; the default hero is regenerated too

Add a set of ten playable heroes to Arithmo Slayer. A hero is a full character: a profile portrait **and** the
in-game figure with its own weapon and its own idle, walk, strike, hurt, death, victory and cast animations. The
default adventurer stays free and is **regenerated with the same pipeline as the nine new heroes**, so all ten are
one style. The other nine are a **cosmetic** entitlement:

- **Apps (Android, iOS)**: a second one-time in-app purchase, the *hero pack*, chosen per family profile.
- **Web (`ffm.derschweigert.de`)**: part of the existing single subscription. Whoever has `premium_access` (paid,
  gifted or grandfathered) can choose any hero; everyone else plays the adventurer. No new price, product or Stripe
  change.

"Cosmetic" is a hard rule: a hero changes **what is drawn and heard**, never **when** anything happens. Every hero
plays the same seven clips with the same frame durations and event frames (`hit`, `release`, `hurt`, `collapse`),
lunges the same distance, resolves hits at the same moment and earns the same score. A unit test pins this for every
hero.

**Both channels are in scope.** `sites/ffm/static/` is the single source for the website and both apps (the app
bundle copies it apart from an exclusion list), so the roster, the hero art and the hero skin seam live there and
reach all three channels at once. The app purchase, the family profiles and the app picker live in
`sites/ffm/mobile/game/`; the web entitlement, the account profile field and the web picker live in `sites/ffm/app/`
and the shared shell.

Owner decisions recorded 2026-11-16 (do not reopen them in the plan; the five former *confirm* items were settled
with the plan approved on 2026-11-16 and are marked *Settled*):

| Decision | Choice |
|---|---|
| Platforms | Web, Android app and iOS app. |
| App product | One **non-consumable** product, suggested id `arithmoslayer_hero_pack`, through the existing `@capgo/native-purchases` plugin. No subscription, no consumable, no per-hero products, no backend, no third-party purchase service. `arithmoslayer_full_unlock` keeps its behaviour and its cached document format exactly. |
| App independence | Hero pack and full unlock are independent. The pack unlocks no level; the full unlock unlocks no hero. |
| Web entitlement | Hero choice is unlocked by `premium_access` from the server's fresh entitlement decision, nothing else. Anonymous and free players play the adventurer. Enforcement on the web is **client-side** (the art is public static content anyway); the server stores the choice for every account and never validates entitlement for a cosmetic. |
| Web storage | One hero per account, stored as a `hero` attribute on the user profile item (DynamoDB), read by `GET /profile`, written by `PATCH /profile`. Bounded string, validated against the roster pattern server-side; an unknown id resolves to the adventurer client-side. |
| App storage | Per family profile in the profile document (Capacitor Preferences), backed up with it. A new profile starts with the adventurer. |
| What a hero is | Portrait (256×256) plus a sprite atlas of the same seven four-frame clips (`idle`, `walk`, `swing`, `hurt`, `dead`, `victory`, `cast`), built with `hero_frames.py` to the same standing height (163 atlas px), the same foot pivot and the same lossless WebP as today's atlas. |
| Weapons | Part of the art and of the strike feedback: the strike clip shows the hero's own weapon; the strike FX (slash arc, arrow flash, shield-bash burst, staff glow, punch burst) and the strike sound match it. Spells (fireball, lightning, dragon) are unchanged in art, sound and timing; only the casting pose is the hero's own. |
| Default hero redo | The adventurer is regenerated with the same pipeline, using today's atlas only as the style reference for the identity sheets. After review the old `static/game/hero/` atlas is removed; the procedural canvas hero that `entities.js` still draws when no atlas is loaded remains the last-resort fallback. |
| Art production | **By the harness**, through the asset pipeline: workers submit asset requests, the trusted broker calls the fal API with the owner's key and a named credit budget, workers run the split and atlas scripts in the sandbox, and the owner reviews one contact sheet per hero. Model: `fal-ai/flux-pro/kontext` (already the allowed, proven model for this pipeline, $0.04 per image). Budget: 320 images, about $13. |
| *Settled:* strike timing | Every hero lunges and strikes like the adventurer, so a bow hero shoots at point-blank after the same lunge. The arrow's flight and hit are drawn as a purely visual particle effect in the bow strike FX, from the existing release frame to the existing hit frame: no projectile entity, no arrival timer, no change to hit timing, damage or score. |
| *Settled:* voice cues | Hurt, victory and death cues stay shared by every hero in this release; only the strike cue varies by weapon family. |
| *Settled:* princess variants | Two heroes: a courtly princess and an armed one with sword and staff. |
| *Settled:* German names | The DE names in the roster are final. |
| *Settled:* subscription terms | No issue touches them (M13). Whether the web terms (`legal_texts.py`, `agb-app` pages are app-only and unaffected) need a sentence that the subscription includes the hero pack. Owner's legal call; not a worker decision. |
| Discoverability | Locked heroes are visible in the picker, dimmed, with a lock badge, the localised name and their idle pose. Tapping one opens the pack sheet (app) or the existing subscription call to action (web). No launch pop-up, no nag, no countdown, no "limited offer", nothing that calls a locked hero free. |
| Parental gate (app) | The existing bilingual adult gate runs before the pack purchase and before every restore. |
| Restore (app) | One "Restore purchases" action restores both products and stays visible on iOS. |
| Refund / revocation (app) | A refunded pack locks the heroes again; the game falls back to the adventurer; the profile keeps its recorded choice. A revocation takes effect at the next level start, never mid-encounter. The same applies on the web when `premium_access` ends. |
| Offline (app) | A purchased pack works offline from the cached entitlement. A failed store read is never a revocation. |
| Weight | Ten atlases at roughly 600 KB each plus ten portraits: about **6 MB** in the web static deploy (fetched on demand only) and in each app bundle. Only the active hero's atlas is decoded at a time. Record the measured growth; do not make the atlases lossy. |
| Models | Claude only for every agent role (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`), overseer on. Image generation is the single exception, through the fal provider above. |

## Hero roster

Stable ids are stored in both profile stores and never change after release. Display names are localised strings;
ids are never shown. `strike` is the weapon family that selects the strike FX and sound.

| id | EN name | DE name (proposal) | Figure (art brief) | strike | Entitlement |
|---|---|---|---|---|---|
| `adventurer` | Adventurer | Abenteurer | Today's hero, regenerated: short, softly tousled golden-blonde hair with at most three small rounded tufts (noticeably less spiky than today, so the hero does not resemble an existing game character; the style reference is softened the same way), crimson scarf, blue plate with pauldrons, longsword. | `sword` | free, default |
| `adventuress` | Adventuress | Abenteurerin | Female counterpart: same scarf, plate and longsword, longer hair tied back. | `sword` | pack / subscription |
| `princess` | Princess | Prinzessin | Courtly princess, midnight-blue and gold gown, gold circlet; strikes with a light rapier. | `sword` | pack / subscription |
| `princess-armed` | Warrior Princess | Kriegerprinzessin | The princess in travel armour, sword in one hand, staff in the other; casts with the staff. | `sword` | pack / subscription |
| `rogue` | Rogue | Waldläufer | Male rogue, hood half down, leather and forest green, shortbow; point-blank shot. | `bow` | pack / subscription |
| `rogue-f` | Rogue | Waldläuferin | Female rogue, same hood, leather and bow, distinct hair and face. | `bow` | pack / subscription |
| `soldier` | Soldier | Soldat | Male soldier, steel helmet with brass nose guard, round buckler on the left arm, arming sword. | `buckler` | pack / subscription |
| `soldier-f` | Soldier | Soldatin | Female soldier, same helmet, buckler and sword, distinct face. | `buckler` | pack / subscription |
| `monk` | Monk | Mönch | Male monk, wrapped robe, shaved head, bound fists; palm strike or kick. | `fist` | pack / subscription |
| `priestess` | Priestess | Priesterin | Priestess, wrapped robe with sash, hair in a high knot, bound fists, same stance. | `fist` | pack / subscription |

Pairs must differ by **silhouette** at playfield scale and at 56 px (hair, hood, helmet, weapon), not only by colour.

## Requirement inventory

| ID | Requirement | Phase | Description |
|---|---|---|---|
| **1.1** | **App product catalogue** | P1 | `mobile/game/purchase.js` sells a catalogue of non-consumable products: `arithmoslayer_full_unlock` and `arithmoslayer_hero_pack`. `queryProduct`, `purchase` and `restore` take a product id; `getPurchases` already returns every `inapp` transaction. Settlement, outcome mapping, the parental gate and every existing `purchase.test.mjs` behaviour stay as they are. |
| **1.2** | **App per-product entitlement** | P1 | `entitlement.js` caches one grant per product. `arithmoslayer:entitlement` keeps its exact format for the full unlock; the pack gets its own key. `refresh()` reconciles every product from one store read. `getStatus()` keeps today's `premium_access` shape and adds `hero_pack`. The app adapter's `refreshEntitlement` refreshes both; the one restore action restores both and leaves the caches untouched on error, denied gate or nothing to restore. `restore.test.mjs` gains the pack cases. |
| **1.3** | **Web profile hero field** | P1 | `sites/ffm/app`: the user item gains an optional `hero` attribute; `GET /profile` returns it; `PATCH /profile` accepts `hero` (pattern `^[a-z][a-z0-9-]{0,31}$` or `null`) alongside `first_grade_year` without making either mandatory. `api.js` gets `updateProfile({ firstGradeYear, hero })` with the old one-argument call still working. Python tests under `sites/ffm/tests/` cover the field (they run in CI, not in the sandbox). |
| **2.1** | **Shared roster module** | P2 | A pure, DOM-free module `static/game/heroes.js` owning the roster: ids, i18n keys, strike family, portrait and atlas paths, which id is free. It resolves a stored choice plus an entitlement flag to the hero to use (default when unknown, missing or locked) and never throws on bad input. Unit-tested. |
| **2.2** | **App profile hero field** | P2 | The family profile document gains an optional `hero` id, validated on read (unknown reads as default, never invalidates the document), written through `setHero(profileId, id)` with the same atomic write as `renameProfile`. Existing documents keep loading. `profile-store.test.mjs` and `backup.test.mjs` cover it. |
| **2.3** | **Hero asset manifest and tooling** | P2 | `static/game/heroes/manifest.json` lists every roster id with portrait, atlas and frames module under `static/game/heroes/<id>/`. A tolerant check (`heroes/check-heroes.mjs`, in the `levels/check-art.mjs` pattern) reports missing files and exits 0, and fails on an id outside the roster, a frames module whose clip set or frame count differs from the reference, or a file over its byte budget (700 KB atlas, 24 KB portrait). `scripts/hero_frames.py` gains `--hero <id>` (frames in, atlas and frames module out under `heroes/<id>/`) and `--weapon sword|buckler|bow|staff|fist`: the blade-line check applies to `sword` and `buckler`; the others get a presence check for weapon pixels in the strike frames. `scripts/hero_poses.py` gains `--out DIR`. Both verified in the sandbox with `--check` on the existing master sheet and on fixture frames. |
| **3.1** | **Hero skin seam** | P3 | `entities.js`: `Hero.setSkin({ atlas, frames, anchors, strike })` makes the atlas image and frames metadata per instance; `hero-anim.js` builds clips from the shared timing table plus the skin's `fxAt` anchors, so durations, `loop`, `next`, `at` events and tracks are shared constants no skin can change. `castHandAnchor` reads the active skin. Until the regenerated adventurer lands, the default skin is today's `hero/` atlas and a test asserts the default clips and frames equal `HERO_CLIPS` and `HERO_FRAMES`. |
| **3.2** | **Strike feedback per weapon** | P3 | `_drawSwingFx` and the strike cue are selected by the strike family: `sword` keeps today's arc and `sword-slash` cue unchanged; `bow`, `buckler`, `staff` and `fist` get canvas-drawn FX (no new image files) and a cue synthesised by the `audio.js` engine (no downloaded samples). Hit frame, anchor convention and fade timing are shared. Unit-tested with fake context and fake engine. |
| **3.3** | **Platform hero selection** | P3 | `platform.js` gains `getActiveHeroSkin()`. Web adapter: the account's `hero` from `getProfile` gated by `getBillingStatus().premium_access`; `null` when logged out or not premium. App adapter: the active family profile's `hero` gated by the cached pack entitlement. `main.js` applies the skin when the profile is loaded or switched and at every level start, never mid-encounter. |
| **3.4** | **Preload and memory** | P3 | The selected hero's atlas replaces the default in the critical preload manifest; switching hero loads the new atlas before a level can start through the existing loading path and releases the previous one. A failed atlas load falls back to the adventurer, then to the procedural canvas hero, never a blank. Tested with a fake image loader. |
| **4.1** | **Hero art, one issue per hero** | P4 | For each roster id, in this order: (a) one `idle` 2×2 identity sheet requested through the asset pipeline with the style reference below; a `manual_test` task shows it to the owner, who approves or asks for a retry (at most three identity tries per hero); (b) the six remaining clip sheets requested with the approved identity sheet as reference; (c) `hero_poses.py` split, `hero_frames.py --hero --weapon` build, anchors measured and written into the frames module; (d) a contact sheet of all 28 frames plus the portrait attached to one `manual_test` task per hero; (e) on pass, the files are committed with provenance rows. The adventurer is the first hero built. |
| **4.2** | **Portraits** | P4 | Each hero's portrait is derived from its approved `idle-1` frame with the promo avatar recipe (256×256 WebP, binary alpha, 4 px blocks, 55 px bust, 28 colours), as a step of the same per-hero issue. A 56 px contact sheet of all ten is part of the last hero's review task. |
| **4.3** | **Adventurer cut-over** | P4 | Once the regenerated adventurer passes review, the roster's default points at `heroes/adventurer/`, `static/game/hero/` is deleted, `asset-preload.js` and `entities.js` stop referencing it, and `hero-preview.html` takes `?hero=<id>`. The default-skin parity test from 3.1 is replaced by the timing-parity test (QA3). |
| **5.1** | **App hero picker** | P5 | In the family player list each row shows its hero's portrait; the active row offers "Change hero", opening a grid of all ten with portrait, localised name and idle pose; free and owned heroes selectable, locked ones dimmed with a lock badge. Selecting writes the profile and refreshes identity rows and the title-screen hero. Keyboard operable, 44 px targets, `aria-pressed`, blocked while a game runs. |
| **5.2** | **App pack sheet** | P5 | Tapping a locked hero opens the pack sheet: localised name and store price (never hard-coded), Buy, Restore purchases, Close, parental gate before buy and restore, the same outcome lines as the level paywall. Reuses `paywall.js` patterns parameterised by product. No sheet opens on its own. |
| **5.3** | **Web hero picker** | P5 | The account modal (inside the existing `app-omit` region of `index.html`, so the app never sees it) gets the same grid; selectable only with `premium_access`, otherwise locked with the existing subscription call to action. Saves through `updateProfile`. Logged-out players see no picker. |
| **5.4** | **Identity rows and placeholder** | P5 | `renderPlayerIdentity()` shows the active hero's portrait beside the name (app identity rows; web account row) through a renderer that leaves the other channel's markup untouched. A hero whose portrait or atlas is missing renders a neutral placeholder and plays as the adventurer; all P5 tests pass with only the adventurer present. |
| **5.5** | **i18n** | P5 | Every new string exists in DE and EN; `i18n.test.js` stays green. |
| **6.1** | **Release handover** | P6 | `mobile/RELEASING.md` and `README.md` describe the second product and its sandbox procedure; `sites/ffm/README.md` describes the web perk, the profile field and the deploy; `docs/ffm-game-assets.md` records the measured growth; `static/game/heroes/PROVENANCE.md` is complete. |
| **QA1** | **Unit coverage** | all | Every new module has a `node --test` suite; `cd sites/ffm/mobile && npm test` and `node --test sites/ffm/static/game/*.test.js` stay green in every phase. Python tests pass in CI on every pull request touching `sites/ffm/`. |
| **QA2** | **No behaviour drift** | all | Full unlock, level paywall, levels 1-2 free, subscription checkout, leaderboard, local progress, spells, lunge, hit timing and scoring keep today's behaviour. No new network request from the game, no analytics, no new plugin, no new paid service beyond the named fal budget. |
| **QA3** | **Timing parity** | P4 | A test iterates every committed hero, builds its clips and asserts frame counts, durations, `at` events, `loop` and `next` equal the shared table. |
| **QA4** | **Bundle and weight** | P2/P6 | `copy-assets` ships `www/game/heroes/`, `bundle-check` lists the manifest as required and every present hero file as offline, the web deploy carries the same files, and the measured growth is recorded against the accepted ~6 MB. |
| **QA5** | **Accessibility** | P5 | Pickers and sheet are keyboard reachable, every hero is named, the lock state is not conveyed by colour alone, nothing new traps focus. |

## Maintainer-owned prerequisites (outside worker authorization)

These touch protected paths or owner accounts. Workers must not attempt them; the investigation report and the
release handover keep each one visible until it has evidence.

- **M8 Store products.** Create `arithmoslayer_hero_pack` as a non-consumable in App Store Connect (DE/EN name and
  description, price tier, the review screenshot Apple requires) and in the Play Console. Both before the sandbox
  tests; the Apple product is submitted with the next binary.
- **M9 Harness: fal asset provider.** `tools/harness/assets.py` gets a generation provider behind `_ai`: the broker
  (trusted side, on the owner's Mac) resolves the key as `tools/fal_image.py` does, calls the model named in the
  policy, decrements `paid_generation_credits` per image, writes the PNG under the plan's asset directory, records
  generator, prompt, seed and references in the manifest as nondeterministic, and never exposes the key to a worker.
  The request schema gains `references` (repository image paths, validated inside the repo), `seed` and `size`.
  The plan policy names `paid_generation_credits: 320`, `generator: fal-ai/flux-pro/kontext`, an `allowed_licenses`
  entry for that generator's commercial output terms on the `sprite` class, `assets.output_dir:
  sites/ffm/static/game/heroes/`, and `visual_fit_needs_human: false` (review is per hero, not per sheet, see 4.1).
  Tested with a fake fal client; the plan is refused until it exists.
- **M10 Harness: worker image.** `tools/harness/worker/Dockerfile` adds Python 3 with Pillow, numpy and scipy so a
  worker can run `hero_poses.py` and `hero_frames.py`. Rebuild, `harness isolation verify`.
- **M11 Harness runtime.** The Claude Code migration of the harness is in the working tree, not yet committed.
  Commit it with M9 and M10, then `harness isolation build`, `harness isolation verify`, `harness claude login`,
  `harness models --refresh`.
- **M12 Version.** The release that ships the pack bumps the app version (suggested 1.1.0) in `package.json` and
  the native projects.
- **M13 Terms.** Owner decides whether the subscription terms mention the hero pack (see *confirm*).
- **Art review.** The owner answers one identity task and one contact-sheet task per hero (about 20 tasks, plus
  retries). This is the pacing item of the run: P4 waits on each answer.
- **Sandbox and device evidence.** Owner-run on a real Android phone and a real iPhone with the revision recorded:
  sandbox purchase of the pack; restore on a fresh install restores both products; revoke the pack and see the
  heroes lock and the game fall back; buy the pack without the full unlock; delete a profile and see other profiles
  keep their heroes; offline launch after purchase; update install keeps progress, unlock and heroes; and for every
  hero one level in both orientations: feet on the ground line, no size pop between clips, strike FX on the weapon,
  cast glow on the casting hand, heal aura centred, death pose on the ground. On the web: a premium account chooses
  a hero and it survives reload and a second browser; a free account sees the heroes locked. None of these can be
  claimed from a JavaScript test.

## Art production (inside the harness, one issue per hero)

Image generation runs through the asset pipeline (M9); the split and build run in the sandbox (M10). The worker
never holds the fal key and never downloads anything itself.

- **Model and licence**: `fal-ai/flux-pro/kontext`, the allowed row in `static/story/ART-BIBLE.md`, $0.04 per
  image, commercial output. It is the model that produced the shipped fiend sprites, the promo avatars and the extra
  hero poses, so its behaviour on this pipeline is known. No FLUX.1 [dev] endpoint, ever.
- **Budget**: 10 heroes × (up to 3 identity tries + 6 clip sheets + 1 portrait pass) plus clip retries, capped at
  320 images (about $13). A hero that exhausts its retries is left out of the manifest and reported; it never
  blocks the others.
- **Style reference**: today's `hero/hero-atlas.webp` `idle-1` frame, upscaled ×4 nearest on a flat magenta plate
  (the recipe in `regenerate_fiends.py`), passed as the reference for every identity sheet including the
  adventurer's own. Each hero's six clip sheets use that hero's approved identity sheet as the reference.
- **Sheets**: one 1024×1024 PNG per clip holding a 2×2 grid of poses, mirroring the adventurer's clips frame for
  frame: idle breathes (neutral, inhale, full, exhale); walk is contact-pass-contact-pass; swing is windup, strike,
  impact, follow-through with the hero's own weapon; hurt is a recoil; dead is buckle, fall, ground, still; victory
  is raise, cheer, plant, hold; cast is gather, thrust, hold, recover with the casting hand free. Flat backdrop, no
  shadow, facing right, no text.
- **Build**: `hero_poses.py --split <sheet> --name <clip> --height 163 --out <dir>` then
  `hero_frames.py --from-frames <dir> --hero <id> --weapon <family>`. Output: `static/game/heroes/<id>/hero-atlas.webp`
  (lossless) and `hero-frames.js`. The strike `fxAt` (weapon contact point on the strike frame) and the cast `fxAt`
  (palm on the release frame) are measured on the built frames and written into the frames module; they are the only
  per-hero numbers the animator reads.
- **Review gate per hero** (the `manual_test` task): contact sheet of all 28 frames at playfield scale plus the
  portrait; equal standing height across clips; weapon present in every swing frame; silhouette distinct from every
  hero already approved; no text, frame or background; children are the audience (no blood, no bare skin beyond face
  and hands, no brand likeness). Fail means regenerate the named clips within the budget.
- **Provenance**: `static/game/heroes/PROVENANCE.md`, one row per sheet and portrait (hero, clip, prompt summary,
  seed, model, reference, date), mirrored from the asset manifest the broker writes.

## Planned phase shape (guidance for the investigator, not a locked plan)

Contention points: `purchase.js` / `entitlement.js` (P1), `entities.js` / `hero-anim.js` (P3), `main.js` (P3 and
P5), `index.html` (P5 only). Keep each in one phase and let no two issues edit the same file in one phase.

| Phase | Scope | Mostly touches | Depends on |
|---|---|---|---|
| P1 | App product catalogue and entitlement; web profile field and API client | `mobile/game/purchase.js`, `entitlement.js`, `platform-adapter.js`, `paywall.js`, `entitlement-panel.js`; `sites/ffm/app/main.py`, `models.py`, `sites/ffm/tests/`, `static/game/api.js` | — |
| P2 | Shared roster, app profile field, manifest and check, builder options | `static/game/heroes.js`, `heroes/manifest.json`, `heroes/check-heroes.mjs`, `mobile/game/profile-store.js`, `scripts/hero_frames.py`, `scripts/hero_poses.py` | — (parallel-safe with P1) |
| P3 | Skin seam, per-weapon FX and cues, platform selection (both adapters), preload | `static/game/entities.js`, `hero-anim.js`, `audio.js`, `asset-preload.js`, `platform.js`, `platform-adapter.js`, `main.js`, `mobile/game/platform-adapter.js` | P1, P2 |
| P4 | Art: ten per-hero issues (adventurer first), portraits, adventurer cut-over | `static/game/heroes/<id>/`, `heroes/PROVENANCE.md`; cut-over touches `heroes/manifest.json`, `asset-preload.js`, `hero-preview.html`, deletes `hero/` | P2 (tooling), P3 (cut-over only) |
| P5 | App picker, pack sheet, web picker, identity rows, placeholder, i18n | `mobile/game/profile-ui.js`, new `hero-picker.js`, `pack-sheet.js`, `mobile-ui.css`, `static/game/main.js`, `index.html` (account modal), `styles.css` (web picker only), `i18n.js` | P3 |
| P6 | Release handover, bundle check, measured size | `mobile/RELEASING.md`, `README.md`, `sites/ffm/README.md`, `scripts/bundle-check.mjs`, `docs/ffm-game-assets.md` | P4, P5 |

Suggested issues (about 22): `ffmhero-catalogue` (1.1), `ffmhero-entitlement` (1.2), `ffmhero-web-profile` (1.3),
`ffmhero-roster` (2.1), `ffmhero-app-profile` (2.2), `ffmhero-manifest-tooling` (2.3), `ffmhero-skin-seam` (3.1,
QA3), `ffmhero-strike-fx` (3.2), `ffmhero-selection-preload` (3.3, 3.4), `ffmhero-art-<id>` × 10 (4.1, 4.2,
parallel-safe, each anchored on its own `heroes/<id>/`), `ffmhero-adventurer-cutover` (4.3), `ffmhero-app-picker`
(5.1, 5.4 app part), `ffmhero-pack-sheet` (5.2), `ffmhero-web-picker` (5.3, 5.4 web part), `ffmhero-i18n` (5.5),
`ffmhero-release` (6.1, QA4). Documentation goes into the issue it documents, never into an issue of its own.

### Model guidance per issue

| Issue | Implementer | Reviewer | Why |
|---|---|---|---|
| `ffmhero-entitlement` | `claude-opus-5-5` | `claude-sonnet-5-5` | Changing the entitlement cache under an installed app is where a mistake costs real customers their unlock. |
| `ffmhero-catalogue`, `ffmhero-web-profile` | `claude-sonnet-5-5` | `claude-opus-5-5` | Bounded changes with existing test patterns; the reviewer confirms nothing changed for existing callers (the Python tests only run in CI). |
| `ffmhero-roster`, `ffmhero-app-profile` | `claude-sonnet-5-5` | `claude-haiku-5-5` | Pure module and an optional validated field in a well-tested store. |
| `ffmhero-manifest-tooling` | `claude-sonnet-5-5` | `claude-opus-5-5` | The builder options decide whether ten art issues can run unattended; the reviewer checks `--check` on the existing sheet is unchanged. |
| `ffmhero-skin-seam`, `ffmhero-selection-preload` | `claude-opus-5-5` | `claude-sonnet-5-5` | Shared playfield code that the website runs; per-instance atlas and shared timing must be exactly equivalent to today's constants, and the atlas swap moment shows on screen. |
| `ffmhero-strike-fx` | `claude-sonnet-5-5` | `claude-opus-5-5` | Canvas FX and synthesised cues follow existing patterns; the reviewer checks the sword path is untouched and nothing new runs per frame. |
| `ffmhero-art-<id>` | `claude-sonnet-5-5` | `claude-haiku-5-5` | A fixed recipe: asset requests, two scripts, one task. The judgement is the owner's review task, not the model's. |
| `ffmhero-adventurer-cutover` | `claude-sonnet-5-5` | `claude-opus-5-5` | Deletes the old atlas; the reviewer proves every reference is gone and the fallback order still holds. |
| `ffmhero-app-picker`, `ffmhero-web-picker`, `ffmhero-pack-sheet` | `claude-sonnet-5-5` | `claude-opus-5-5` | DOM modules in existing patterns; accessibility, the blocked-during-game rule and the gate-before-store rule are the review risk. |
| `ffmhero-i18n`, `ffmhero-release` | `claude-haiku-5-5` | `claude-sonnet-5-5` | Strings, documentation and a measured number. |

The refiner starts on the standard band by harness default and climbs only on its own failed pass. Do not sign a
refiner and do not set `policy.model_routing`.

## Execution and evidence boundaries

- **Claude stack only** for agents (`--model-source claude`). The reviewer must never be the implementer's model.
  The fal provider is the single exception and is called by trusted code, never by an agent.
- **Do not set `policy.model_routing`.** It buys a plan pass for every issue.
- **Overseer on** (harness default).
- **Issue ID prefix** `ffmhero-`.
- **One promotion, one deploy.** Work lands on the run branch; `main` moves only through the promotion pull request.
  That deploy carries a **backend change** (the profile field) and about 6 MB of static art; the app release is a
  separate owner action.
- **Credits are policy.** `paid_generation_credits`, the generator id and the asset directory are in the approved
  policy and the approval digest. No worker can raise them; an exhausted budget raises an asset task, not a retry.
- **No worker touches `package.json`, lockfiles, the native projects, `tools/harness/` or `.github/`.** The pack
  needs no native change.
- **The web build keeps today's behaviour** apart from the hero perk and the account picker. `styles.css` changes
  are limited to the web picker; app styles go to `mobile-ui.css`; `index.html` is edited only inside the account
  modal's `app-omit` region.
- **Stable anchors.** New modules anchor on their own files; art issues anchor on their own `heroes/<id>/`
  directory. Issues that must touch `main.js`, `entities.js` or `profile-ui.js` anchor on the smallest block they
  own (`renderPlayerIdentity`, `_drawAtlasFrame`, the profile row render), not on the file.
- **Every phase passes with the art absent**: the adventurer (old atlas until the cut-over, regenerated after) and
  the placeholder are the shipping path at every point.
- **Manual checks stay pending, never claimed**: everything under "Sandbox and device evidence" and every art review.

## Verification commands

```
node --test sites/ffm/static/game/*.test.js                 # shared playfield and shell: web + both apps
cd sites/ffm/mobile && npm test                              # app overlay, copy-assets, bundle check
node sites/ffm/static/game/heroes/check-heroes.mjs           # manifest, tolerant of missing heroes
python3 sites/ffm/scripts/hero_frames.py --check             # in the sandbox after M10
SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q             # CI only: needs Flask and boto3
```

## Non-goals

- No change to hit timing, lunge, spell projectiles, combo ladder, cooldown abilities, scoring or difficulty.
  A ranged-strike variant for bow heroes is a separate requirement.
- No per-hero voice cues, spells or stats.
- No hero in the leaderboard, no upload of a player's own picture, no server-side entitlement check for a cosmetic.
- No per-hero products, consumables, subscription changes, price changes or bundle discounts.
- No change to the level paywall, the free levels, the full-unlock product id or its cached document format.
- No new plugin, permission, analytics, or network request from the game; the only paid service is the named fal
  budget, used by trusted code.
