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
The engine does not persist settings; the shell owns device-wide preferences
and guarded storage access.

HTML media `volume` is not reliable on iOS. Consequently music adjustment is
**disabled by default**: inspect `musicVolumeCapability` (`{ supported, status }`)
and disable the music slider with an explicit explanation when unsupported.
`setMusicVolume` throws an error rather than reporting a successful no-op.
Existing direct media playback and its default volume remain unchanged.

The constructor option `musicGainRouting: true` is for a validated deployment
or manual spike, not an iOS support claim. It attaches same-origin HTTP(S)
current/preloaded media elements to a shared Web Audio gain bus, after the
existing gesture context unlock. Before capture the status is
`awaiting-media-route`; success is `available`; missing API, custom schemes,
cross-origin files or source-connection failures report
`unsupported-media-routing` and preserve default direct playback. A captured
element is replaced if graph attachment fails. Source nodes disconnect when
tracks are released. Default status is `unverified-media-routing`.

Before enabling this option in a native shell, manually verify audible
playback of bundled local URLs on actual iOS/Capacitor devices, live gain at
0/0.2/1 while playing, rotation and preload, interruption/pause/resume, mute,
and gesture unlock. Also listen to layered effects on device speakers and
headphones for peak levels and fatigue. Fake-context tests verify graph and
API behavior only; no native volume spike or listening-quality validation has
been performed. Music ducking is deliberately not enabled pending that spike.

### Gameplay event API

- `playCorrect()`: short, lower-gain sine/triangle ascending confirmation.
- `playWrong()`: descending triangle feedback, distinct from damage; call once
  for an incorrect answer, without stacking `playHeroHurt()`.
- `playTimeout()`: separated descending sine pulses for an expired task.
- `playHeal()`: rising sine triad when healing actually occurs.
- `playCampaignVictory()`: longer rising triangle finale for campaign completion,
  instead of stacking the regular `playLevelClear()` fanfare.
- Existing weapon, damage, level-clear and game-over APIs remain available.
