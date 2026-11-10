# Bundled level music

The web game and the mobile app use `static/game/level-music.json`. Map a
1-based level number to a list of bundled track filenames, for example:

```json
{
  "levels": {
    "1": ["background-music.mp3"],
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
  instead of stacking the regular `playLevelClear()` fanfare.
- Existing weapon, damage, level-clear and game-over APIs remain available.
