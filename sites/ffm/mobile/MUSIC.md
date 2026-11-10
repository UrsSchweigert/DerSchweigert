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

Every synthesized effect, including sword noise, runs through one effects gain
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
Gesture unlock and suspended-context resume use the existing `_ensureCtx` path
on every cue and on `startBGM`/`startLevelBGM`.

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
