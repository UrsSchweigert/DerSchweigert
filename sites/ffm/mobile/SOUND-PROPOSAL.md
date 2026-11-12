# Sound proposal: the particle effects

**Status: proposal.** Nothing below is generated or wired. It audits what
`screen-fx-effects.js` plays today, what sound each effect already has, and what
it should get next.

Scope: the 13 player-facing recipes in `EFFECT_NAMES` plus the four granular
pieces (`fireTrail`, `fireImpact`, `boltTrail`, `boltImpact`) that `main.js`
drives per projectile frame and per real collision. Together they are the whole
`createEffectTable()`.

## What already makes noise

The rule so far: a particle effect is silent on its own, and `main.js` plays the
matching cue next to the effect call. Sounds are either synthesized in `audio.js`
or bundled samples picked from `SFX_CUES` (three variants each, never the same
twice in a row).

| Effect | Fires when | Sound today |
| --- | --- | --- |
| `correctAnswer` | right answer, anchored to the answer row | `playCorrect()` synth (two tones) |
| `wrongAnswer` | wrong answer or timeout | `playWrong()` / `playTimeout()` synth |
| `heroStrike` | melee arc on a correct answer | `playSwordSwing()` — 3 slash samples |
| `fiendHurt` | blade lands, fiend survives | `playFiendHit(type)` — 3 samples per fiend type |
| `heroHurt` | the wrong-answer strike lands (+0.12 s) | `playHeroHurt(0.12)` — 3 samples |
| `fireball` (`fireTrail`, `fireImpact`) | fireball cast, flight, collision | `playFireballCast()` — 3 `fire-cast` samples (1.36 s, the flight); `playFireballHit()` — 3 `fire-impact` samples |
| `lightning` (`boltTrail`, `boltImpact`) | lightning cast, flight, arrival | `playLightningCast()` — 3 `bolt-cast` samples (0.52 s, the flight); `playLightningHit()` — 3 `bolt-impact` samples |
| `levelWon` | level cleared | `playVictoryHymn()` sample, `playLevelClear()` synth fallback |
| `gameOver` | hearts reach zero | `playGameOver()` synth |
| `dragonFinisher` | dragon ability lands | `playDragonRoar()` — 3 `dragon-roar` samples (+ `playDragonBreath()`) |
| `heal` | heart restored, beam column | `playHeal()` — 3 `heal-bloom` samples |
| `healCharge` | every frame while the heal hold charges | `setHealCharge(progress)` — looping `heal-charge-1` bed |
| `swordGain` | — | **none, and nothing plays it** |

Two findings fall out of the audit:

- `healCharge` is the only effect the player triggers for seconds at a time, and
  it is completely silent.
- `swordGain` is registered and tested but `main.js` never plays it, so it is
  dead weight until the ability that should call it exists.

## Design rules for anything added

1. **One event, one cue.** Particles that fire from the same `main.js` branch
   share a single sound. `fireball` and `fireImpact` are one cast and one hit,
   not five sounds.
2. **Three variants, no back-to-back repeat.** Anything the player hears twice
   per problem uses the cue bank, so a run of correct answers never machine-guns
   the same sample.
3. **Mix under the dialogue of the scene.** The slash and the victory hymn carry
   the beat. `FIEND_HIT_GAIN` 0.75 and `FIEND_DEATH_GAIN` 0.9 are the calibration
   points; the effects bus runs 0.4 headroom at full volume.
4. **No sound per particle or per frame.** A trail that spawns 60 embers a second
   gets one looped sound per projectile, started at cast and stopped on impact,
   or nothing at all.
5. **Budget.** Keep the whole bank under ~600 KB: 0.3-1.0 s, 44.1 kHz,
   `mp3_44100_96` for anything longer than half a second.
6. **Licensing.** Bundled samples must come from a generator that permits
   commercial use on a paid product. See
   [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

## Proposal

Priorities: **P0** obvious gap, ship next. **P1** strong payoff, same round.
**P2** polish. **P3** nice to have once the ability exists.

| Effect | Proposed sound | Cue name | Priority |
| --- | --- | --- | --- |
| ~~`healCharge`~~ | **Shipped** as `heal-charge-1` (2 s seamless loop) driven by `setHealCharge(progress)`; playback rate and level rise with the charge. | — | done |
| ~~`heal`~~ | **Shipped** as `heal-bloom-1..3` (1.0 s), synth three-tone kept as fallback. | — | done |
| ~~`fireball` (`fireTrail`)~~ | **Shipped** as `fire-cast-1..3` (1.36 s), cut to the 1.35 s flight; no loop flag needed. | — | done |
| ~~`fireImpact`~~ | **Shipped** as `fire-impact-1..3` (0.68 s), rotating with the slash and blast gains. | — | done |
| ~~`lightning` (`boltTrail`)~~ | **Shipped** as `bolt-cast-1..3` (0.52 s), the 0.46 s flight; higher and thinner than fire. | — | done |
| ~~`boltImpact`~~ | **Shipped** as `bolt-impact-1..3` (0.68 s). | — | done |
| ~~`dragonFinisher`~~ | **Shipped** as `dragon-roar-1..3` (1.6 s), synth roaring bed kept as fallback. | — | done |
| ~~`correctAnswer`~~ | **Shipped**: synth tones kept, `answer-sparkle-1..3` at 0.5 gain underneath. | — | done |
| `wrongAnswer` | Keep synth. The new hero-hurt sample already supplies the physical part of the mistake. | — | done |
| ~~`gameOver`~~ | **Shipped** as `game-over-1` (1.76 s), six-note synth descent kept as fallback. | — | done |
| ~~`levelWon`~~ | **Shipped** as `win-pop-1`, fired with the `levelWon` burst under the hymn. | — | done |
| ~~`swordGain`~~ | **Shipped** as `sword-gain-1`, fired once per ability band (combo 6, 11, 21) through `isAbilityBandStart()`. The `swordGain` particle recipe is still never played by `main.js`. | — | done |
| `heroStrike` / `fiendHurt` | Covered: slash variants + per-type impact. | — | done |

### If the whole proposal lands

- Nothing further is proposed. The bank is 73 files in 27 cue families, 920 KB.
- `dragon-roar` is the only proposal whose absence is noticeable in the first
  minute of play; the rest are polish on top of cues that already work.
- Both spell pairs shipped (launch + blast), and neither needed a loop flag: the
  clips are cut to the flight time, so they end as the blast begins.

### Open decisions for the owner

1. The `swordGain` *particle recipe* is still never played; only its sound is
   wired. Play the effect too, or drop the recipe and its test?
2. The level-clear fanfare (`playLevelClear`, eight square-wave notes) is the
   last fully synthesized cue of the level cycle. A sampled short fanfare would
   replace it if the hymn ever fails to decode — rare, so low value.
3. Every cue is mono-summed stereo at 96 kbps. If the app bundle budget gets
   tight, downmixing to mono would save roughly 40 % of the 920 KB.
