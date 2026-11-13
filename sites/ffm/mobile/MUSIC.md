# Bundled level music

The web game and the mobile app use `static/game/level-music.json`. It holds the
title/menu playlist under `menu` and maps a 1-based level number to a list of
bundled track filenames under `levels`, for example:

```json
{
  "menu": ["retro-05-ending.mp3"],
  "levels": {
    "1": ["retro-02-level-1.mp3"],
    "2": ["retro-02-level-1.mp3"],
    "11": ["first.mp3", "second.mp3"]
  }
}
```

An absent or empty list uses the existing chapter-aware rotation. Configured
lists rotate only their listed tracks, irrespective of chapter tags. Each file
must be a relative bundled file already listed in both `static/game/tracks.json`
and `mobile/game/tracks.json`, and credited in `mobile/game/music-manifest.js`.
Place the audio file in `static/game` so the app's normal asset copy includes
it. Do not use remote URLs; add songs and their licence/source credits only
when the owner supplies them. The example's extra files are illustrative.

The shipped configuration plays `retro-05-ending.mp3` on the intro and every
menu page, and cycles seven gameplay tracks over two levels each (levels 1-2,
3-4, 5-6, and so on, restarting the cycle after 14 levels).

The menu playlist is one continuous session: it starts on the first user
gesture (browser autoplay rules), and switching title pages never touches the
audio engine, so the track keeps playing from its current position across the
intro and between menus. `startMenuBGM()` is idempotent for that reason, and it
resumes instead of restarting after a background pause. The intro and the menu
pages swap behind a 170 ms fade to black (`#screen-fade`); reduced-motion users
get an immediate swap instead.

The menu track is also requested once during start-up, before any gesture, so
that a browser which permits playback starts the intro with music instead of
silence. When the browser refuses (an ordinary `NotAllowedError` under its
autoplay policy, which is not logged as a failure), the session stays
resumable and the next gesture starts the track; repeated gestures while it is
already playing do nothing. Both native shells allow media autoplay
(`mediaTypesRequiringUserActionForPlayback = []` on iOS,
`setMediaPlaybackRequiresUserGesture(false)` on Android), so the app starts
with music too. On iOS the Web Audio context can still be suspended until the
first touch; the menu track then becomes audible from that point.

Story dioramas — the prologue and every act opening — run on the `menu`
playlist. `createStoryIntro`'s `beforeScene` hook calls `startMenuMusic()` right
before the scene starts, so an act opening never plays over level music and
never starts in silence once the engine has audio. The hook is idempotent, and
the level's own track takes over (with the usual crossfade) when the diorama
ends.

## Gapless looping

A single-track playlist — the menu track and every level track — is played
through `static/game/music-loop.js`: the file is fetched once, decoded with
`decodeAudioData` and looped with an `AudioBufferSourceNode` (`loop = true`,
`loopEnd` at the decoded duration) into the same music bus, so volume and mute
keep working through the bus gain.

This matters because a media element loses about 25 ms at every wrap: whether
the rotation advances to the preloaded element or the element itself is looped,
the pipeline re-runs the MP3 decoder at the seam (measured 24.5 ms in Chrome,
and the same with a bare `<audio loop>`). A decoded buffer carries no encoder
padding — Chrome's decoder trims it — so the buffer path wraps with no gap at
all.

Multi-track playlists, and any context without `decodeAudioData`, keep the
media-element rotation. If fetching or decoding the single track fails, the
engine logs a warning and falls back to the rotation for the same playlist. One
decoded track is kept in memory at a time (~30 MB for the longest track) and
reused when the same file starts again, so the two levels that share a track
and a return to the title do not decode twice.

The game starts with the existing bundled fallback while configuration loads.
Invalid lists or unavailable configuration log a warning and use the normal
rotation; they do not block play. No player migration or song picker is needed.
If a track fails to load, playback falls back to the original bundled theme;
if that file also fails, music stops without interrupting gameplay.

## Effects and volume controls

Every effect, including the sword slash sample, runs through one effects gain
bus with 0.4 headroom at the maximum user setting. Where supported, a downstream
Web Audio compressor provides additional peak protection; this is not a
guarantee against clipping under arbitrary event overlap. Muting immediately
zeros the buses and stops scheduled effect voices, so unmuting does not revive
old effects. Music pause/resume, title unmute and single-preload rotation retain
their existing behavior.

Every synthesized cue is shaped with an 8 ms attack and an exponential release
to `_shapeEnvelope`, so no effect starts or ends on a hard edge. Bundled music
gets the same treatment at both ends: the `MusicLoop` fade gain ramps a track in
over 180 ms and out over 150 ms, including when a track replaces another, is
paused or stopped. The victory hymn is the deliberate exception — it keeps its
full attack and release.

### Victory hymn

`victory-hymn.mp3` (`static/game/`, CC0, celestialghost8) plays once at the end
of every level and at campaign completion through `playVictoryHymn()`. It is
decoded through the same `AudioContext` as the effects and plays on the effects
bus, so the effects volume and mute settings apply to it. While it rings, the
music bus is ducked to 30 % and restored when the fanfare ends; starting new
background music (`startBGM`/`startMenuBGM`/`startLevelBGM`) stops a still
ringing fanfare so the next level does not begin under a duck.

`playVictoryHymn()` resolves to `false` when the track cannot be decoded or the
engine has no fetch path. `main.js` then falls back to the synthesized
`playLevelClear()` / `playCampaignVictory()` cue. The track is warm-cached after
the first level, and it is deliberately absent from `tracks.json` so rotation
never picks it as background music; its credit lives in `music-manifest.js`.

### Sound-effect bank

Combat cues are generated sound effects in `static/game/sfx/`, not music. Every
name is a family of **three variants**, and a family never plays the same
variant twice in a row:

| Family | Files | Plays on |
| --- | --- | --- |
| `sword-slash` | `sword-slash-1..3.mp3` | a landed melee strike |
| `hero-hurt` | `hero-hurt-1..3.mp3` | the hero taking a hit (+0.12 s, with the strike) |
| `fire-cast` | `fire-cast-1..3.mp3` | a fireball leaving the hero, for its 1.35 s flight |
| `fire-impact` | `fire-impact-1..3.mp3` | a fireball landing |
| `bolt-cast` | `bolt-cast-1..3.mp3` | a lightning bolt leaving the hero, for its 0.46 s flight |
| `bolt-impact` | `bolt-impact-1..3.mp3` | a lightning strike landing |
| `heal-charge` | `heal-charge-1.mp3` | the hold-to-heal charge, **looping** while held (seamless 2 s bed) |
| `heal-bloom` | `heal-bloom-1..3.mp3` | a heart restored |
| `dragon-roar` | `dragon-roar-1..3.mp3` | the dragon ability landing |
| `answer-sparkle` | `answer-sparkle-1..3.mp3` | under the correct-answer tones, as glitter |
| `game-over` | `game-over-1.mp3` | hearts reach zero |
| `win-pop` | `win-pop-1.mp3` | the confetti burst when a level is cleared |
| `sword-gain` | `sword-gain-1.mp3` | the combo just entered a new ability band (6, 11, 21) |
| `fiend-<type>-hit` | `fiend-<type>-hit-1..3.mp3` | a landed strike the fiend survives |
| `fiend-<type>-death` | `fiend-<type>-death-1..3.mp3` | that fiend type dying |

`<type>` is one of the seven keys in `FIEND_SFX_TYPES` (`slimeling`, `bonehead`,
`toadlord`, `magelitch`, `birdfoe`, `wolffoe`, `snakefoe`) — the same key
`levels.js` samples and `main.js` stores on `fiend.type`. All families are
listed in `SFX_CUES` in `audio.js`; the file name is the only thing tying a
variant to its family, so a replacement drop needs no code change.

`main.js` calls `prepareFiend(type)` when a fiend spawns, which warms that
type's six clips, and the slash, hero-hurt, both spell families (launch and
blast), the heal charge and bloom and the dragon roar are warmed when the audio
context opens. `answer-sparkle`, `game-over`, `win-pop` and `sword-gain` load on
first use. Everything else is decoded lazily on first use. Each file is
fetched and decoded at most once per session, and a failed file is remembered
rather than retried on every hit. Until a variant is decoded — and permanently
when it cannot be loaded — the same call falls back to the synthesized cue it
replaced (swish, thud, hurt, death descent), so no event is ever silent.

Healing is deliberately the loudest thing in the mix — it is the reward the
player works nine seconds for — which is why the bloom and the charge bed run at
double the level of the other samples.

`heal-charge` is the one cue that is a state rather than an event. `setHealCharge(progress)`
starts a single looping bed on the first held frame, raises its playback rate
and level with `progress`, and `stopHealCharge()` ends it on release; repeated
frames update the same voice instead of stacking a second bed, and mute stops it
with every other voice. `main.js` calls it from `emitHealCharge`, before the
particle throttle, so a throttled frame never leaves the bed running after the
hold ended.

Mix: samples are deliberately hotter than the synth cues they replaced, because
they were hard to hear over the music at unity. The slash plays at 1.6, a spell
blast and the dragon roar at 1.5, the heal bloom at 2.7, a spell launch and the
hero-hurt sample and a fiend's death at 1.4-1.45, the game-over sting at 1.4,
the band chime at 1.2, the win pop at 1.1, a fiend's impact at 1.2, and the heal
charge bed at 1.1-2.0 while it charges, so the player's own action stays on top while
a creature's wound reads as secondary. A launch clip is cut to the projectile's
flight time (1.35 s fireball, 0.52 s bolt), so travel is covered end to end and
the blast takes over exactly when the launch ends. The effects bus keeps its own 0.4 headroom, so the ceiling
is the compressor rather than the mixer; raise `EFFECTS_HEADROOM` instead if the
whole effect layer, synth cues included, should get louder.
Everything still runs through the effects bus, so effects volume, mute and the
compressor apply to samples exactly as they do to synth cues. The source
prompts, model and licence terms are recorded in `THIRD-PARTY-LICENSES.md`; the
next round of particle-effect sounds is proposed in
[`SOUND-PROPOSAL.md`](SOUND-PROPOSAL.md).

Two cues in the ability HUD are synthesized only; there is no sample family to
replace, because they are mixed from waveforms rather than recorded:

| Method | Fires on | Recipe |
| --- | --- | --- |
| `playAbilityPress()` | pressing a *ready* orb, before the cast is attempted | glass: two highpass/bandpass noise cracks plus five inharmonic partials between 2.6 and 7.3 kHz, each 0.05–0.15 s, over a 0.12 s sine drop for the body of the ball |
| `playAbilityCast(id)` | a successful wind, storm or earth cast | wind: bandpass noise sweeping up plus a triangle sweep; storm: high bandpass snap into a thunder rumble; earth: deep sine drop under a low-passed rumble |
| `playFiendPortal()` | a fiend's portal tearing open, with the visual effect | the rent: 0.34 s bandpass noise swept 220 Hz → 1.9 kHz; behind it a sawtooth rumble 72 → 38 Hz and a 54 Hz sine thump; over it a thin triangle shimmer 680 → 1480 Hz |

The press cue is deliberately separate from the cast cue: the orb cracks under
the finger, and the spell answers a moment later, so a refused cast (no fiend to
blow away) still acknowledges the touch. All of them are muted with everything
else and build no nodes while muted.

The portal cue is the quietest of the three on purpose: it fires on every spawn
— every 0.5 s in a fast run — so it is mixed to sit under the game instead of in
front of it, and it sounds with the door rather than with the fiend's first step.

`setEffectsVolume(number)` and `setMusicVolume(number)` clamp finite numbers to
0–1 and return the resulting value. Non-numeric/NaN/infinite inputs throw
`TypeError`. Read values with `effectsVolume`/`musicVolume` or
`getEffectsVolume()`/`getMusicVolume()`. Defaults are effects 1, music 0.35.
`setMuted(boolean)` is idempotent and `toggleMute()` delegates to it.

The app shell (`platform.isApp`) enables `musicGainRouting`, so bundled music
shares the same Web Audio gain path as synthesized effects. On iOS the bundle
is served from the `capacitor:` scheme, which Web Audio cannot capture directly:
the engine fetches each bundled track once from the bundle origin, swaps the
media element to a same-origin `blob:` URL, and only then calls
`createMediaElementSource` and connects it to the shared music bus. Android's
`https://localhost` bundle origin is captured directly. The fallback track is
prefetched at construction and manifest tracks right after `tracks.json` loads;
a blob that arrives after rotation starts is swapped into the live element and
resumes exactly once. Preloading, rotation, offline playback and per-level
playlists keep working because only the element's `src` changes.

Effects keep their existing `_effectsBus` with 0.4 headroom and compressor; the
music bus is separate and carries the user's music gain. Mute zeros both buses.
Gesture unlock and interrupted-context resume use the existing `_ensureCtx` path
on every cue and on `startBGM`/`startLevelBGM`/`resumeBGM`. iOS keeps a
backgrounded page's context in WebKit's non-standard `interrupted` state rather
than `suspended`, so `_ensureCtx` resumes every state except `running` and
`closed`; recognising only `suspended` left the game silent after a return to
the foreground until it was reloaded.

`musicVolumeCapability` reports `awaiting-media-route` before capture,
`available` after the first successful capture, and
`unsupported-media-routing` when capture is unavailable (missing API,
cross-origin file, custom-scheme fetch failure, or graph attachment failure).
The configured app route accepts gain settings while awaiting first playback;
`supported` is true in both the awaiting and available states. This does not
certify audible output: a later routing failure still disables adjustment.
On failure the engine restores default direct playback at 0.35 and the slider
stays disabled with an explicit explanation. `setMusicVolume` throws rather
than reporting a successful no-op. Default status outside the app shell is
`unverified-media-routing`.

Mute, effects gain and music gain persist through `audio-preferences.js`
(`arithmo-audio-preferences-v1` in localStorage). A saved music gain applies
before first playback when the app route is configured. Unavailable routes
keep the existing deferred-preference handling. The app title has one speaker
menu for music, effects and mute; the pause menu mirrors its gain settings.

### Physical-device gates still required

The automated tests use fake media elements and contexts; they prove graph,
API and persistence behaviour only. Before claiming native audible output,
verify on a physical iOS and Android device:

- Bundled music is audible and the music slider changes live gain at 0, 0.2
  and 1 while a track plays.
- The iOS silent switch silences BGM and effects, and unmuting restores them.
- A call/alarm interruption pauses BGM and gameplay, and returning resumes both
  exactly once with mute and gain preserved.
- Background/foreground transitions do not duplicate playback.
- Rotation, preload and per-level playlists keep playing offline.
- Layered effects on device speakers/headphones do not clip or fatigue.

No native project or plugin change is part of this path. There is no
system-volume control: the app controls only its own Web Audio gain, and the
UI states the limitation when device gain control is unavailable.

### Gameplay event API

- `playCorrect()`: short, lower-gain sine/triangle ascending confirmation.
- `playWrong()`: descending triangle feedback, distinct from damage; call once
  for an incorrect answer, without stacking `playHeroHurt()`.
- `playTimeout()`: separated descending sine pulses for an expired task.
- `playHeal()`: rising sine triad when healing actually occurs.
- `playCampaignVictory()`: longer rising triangle finale for campaign completion,
  kept as the fallback when the bundled victory hymn cannot play.
- `playVictoryHymn()`: plays the bundled CC0 victory fanfare once, ducking the
  background music; resolves to `false` when the track is unavailable.
- Existing weapon, damage, level-clear and game-over APIs remain available.
