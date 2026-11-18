# Choppy car audio (CarPlay / Bluetooth): diagnosis

The owner supplied no connection, device or symptom details. Nothing was
tested on a device or in a car, and nothing here is a verified result. For that
reason this document includes no code fix: it lists what the code does, ranked
hypotheses, a device test procedure and candidate fixes, all **not
implemented**.

## Code facts

- One `AudioContext`, default options: `_makeContext` is
  `new (AudioContext ?? webkitAudioContext)()` with no `sampleRate` and no
  `latencyHint` (`static/game/audio.js`, constructor). `_ensureCtx()` creates it
  once and never recreates it.
- No handling of `statechange`, `devicechange` or audio route changes anywhere
  in `static/game/audio.js`. Interruptions are handled only through
  pause/resume in `mobile/game/lifecycle.js`.
- Effects and music buses (`_effectsBus`, `_musicBus`) feed one
  `DynamicsCompressor` (`_output`) that feeds `destination`
  (`static/game/audio.js`, `_ensureCtx`).
- Music is a decoded, looping `AudioBufferSourceNode` (`loop = true`) in
  `static/game/music-loop.js`. The fallback is an `<audio>` element routed into
  the graph with `createMediaElementSource` (`_captureMusicElement` in
  `audio.js`).
- The story scenes have no voice-over: the diorama player creates no audio
  element, so music and effects are the only sounds.
- No native audio-session code: `SceneDelegate.swift` sets no `AVAudioSession`
  category (see `RELEASING.md`), and there is no Capacitor audio plugin.
- The web inspector is disabled: `webContentsDebuggingEnabled` is `false` for
  iOS and Android in `capacitor.config.json`. Enabling it needs an
  owner-merged build change and is only described here.

## Hypotheses (ranked)

1. **Stale context after an output sample rate or route change.** The context
   was created before the hands-free profile or CarPlay connected and keeps its
   old rate or route. Confirmed if: starting the app after connecting is clean
   but connecting while running is choppy, and a restart while connected cures
   it. Refuted if: starting the app after connecting is also choppy.
2. **Interactive low-latency render quantum under-running on a high-latency
   Bluetooth route.** The default `latencyHint` is `interactive`. Confirmed if:
   A2DP and wireless CarPlay are choppy but wired CarPlay and the phone speaker
   are clean, on all sound types. Refuted if: wired CarPlay is also choppy.
3. **Audio session category switching when an `<audio>` element starts or
   stops.** Confirmed if: choppiness starts or stops with the music fallback
   (the only `<audio>` element left) starting or stopping. Refuted if:
   decoded-buffer music and effects are choppy without any `<audio>` element.
4. **CPU load.** Confirmed if: the phone speaker is also choppy under the same
   scene, or choppiness tracks busy scenes. Refuted if: the phone speaker is
   clean in the same scene and only the car route is choppy.

## Device test procedure

Run each cell and write the outcome (clean / choppy / n/a) in the Result column.

| Connection | App start | Sound | Result |
| --- | --- | --- | --- |
| Wired CarPlay | before connecting | music | |
| Wired CarPlay | before connecting | effects | |
| Wired CarPlay | after connecting | music | |
| Wired CarPlay | after connecting | effects | |
| Wireless CarPlay | before connecting | music | |
| Wireless CarPlay | before connecting | effects | |
| Wireless CarPlay | after connecting | music | |
| Wireless CarPlay | after connecting | effects | |
| Bluetooth A2DP | before connecting | music | |
| Bluetooth A2DP | before connecting | effects | |
| Bluetooth A2DP | after connecting | music | |
| Bluetooth A2DP | after connecting | effects | |
| Phone speaker (control) | n/a | music | |
| Phone speaker (control) | n/a | effects | |

Further questions to answer while connected:

| Question | Result |
| --- | --- |
| Does a restart of the app while connected cure it? | |
| Does a phone call or Siri prompt trigger it? | |

## Candidate fixes (all not implemented)

| Observation pattern | Candidate fix to try next | Status |
| --- | --- | --- |
| Choppy only when connecting while running; restart cures it | Recreate or resume the context on route change (`statechange`, `devicechange`) | not implemented |
| Choppy only on Bluetooth / wireless CarPlay, any sound | `latencyHint: "playback"` when no low latency is needed | not implemented |
| Choppy tied to `<audio>` start/stop (the music fallback) | Route the music fallback through a decoded buffer instead of `<audio>` | not implemented |
| Choppy after a phone call or Siri prompt | Resume the context when it is `suspended` or `interrupted` | not implemented |
| Choppy on the phone speaker too, in busy scenes | Reduce load: fewer simultaneous voices, skip the compressor | not implemented |
| No pattern, cause unclear | Temporarily enable the web inspector (owner-merged build change) and log the context state, `sampleRate` and `baseLatency` | not implemented |

## Symptom questions for the owner

- Device and iOS/Android version?
- Car or head unit?
- Connection type (wired CarPlay, wireless CarPlay, Bluetooth A2DP)?
- Which sounds are choppy (music, effects)?
- Does it happen from the start or after an event (connecting, a call, Siri)?
