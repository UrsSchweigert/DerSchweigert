# Combat movement and camera

The greybox arena is the first playable combat surface: a tilemap border, a
circle hero, and a camera that frames the room. It ships no art.

## Movement

`scripts/combat/player_movement.gd` is a `CharacterBody2D` in floating motion
mode. Each physics step it reads a direction from `scripts/input/move_input.gd`,
accelerates the velocity toward it, and calls `move_and_slide()` so tilemap and
body collisions slide instead of tunnelling.

`scripts/input/move_input.gd` combines keyboard (WASD or arrows), the left
gamepad stick, and a touch vector into one analog vector. The vector is snapped
to the nearest of eight compass directions and its magnitude stays between zero
and one, so a diagonal is never faster than a straight line and a half-deflected
stick walks at half speed. Inputs under the 0.2 deadzone are ignored.

`data/combat/player.json` defines the numbers:

| Field | Meaning |
| --- | --- |
| `movement.maxSpeed` | Top speed in pixels per second. |
| `movement.acceleration` | Pixels per second squared while a direction is held. |
| `movement.deceleration` | Pixels per second squared after the direction is released. |
| `movement.radius` | Collision circle radius. |
| `camera.smoothingSpeed` | Exponential follow rate; higher is snappier. |
| `camera.zoom` | Camera zoom. |

`PlayerMovement.drive(direction)` and `release_drive()` bypass the input
devices so a test or the scripted bot can replay a path. `tools/validate_data.py`
rejects a player document with a missing, non-numeric, or non-positive number.

## Camera

`scripts/combat/follow_camera.gd` centers on its target but clamps the center so
the viewport never shows outside `room_size`, staying on the room center when
the room is smaller than the viewport. Smoothing uses
`1 - exp(-smoothingSpeed * delta)` at the fixed physics step, and the room
bounds are also published as `Camera2D` limits.

## Arena

`scenes/combat/arena.tscn` builds a 1600x900 room from 32-pixel tiles on load,
with a collidable border ring, a static pillar for body collision, the player in
the middle, and the follow camera. Set `room_size` and `tile_size` on the arena
root to resize the room; the border and camera bounds follow.

## Health, dodge, and respawn

`data/combat/health.json` defines hearts, hit i-frames, the dodge window and
cooldown, and respawn timings. `health.gd` spends a heart per hit and ignores
hits during i-frames or inside a roll bound with `Health.bind_dodge`; the arena
wires the two on load. `dodge.gd` rolls for the data duration, cancels any
weapon combo, and waits for its cooldown. `respawn.gd` returns the hero to the
last checkpoint or room entrance with full hearts and brief invulnerability,
keeping earned items and score. `test/unit/combat/test_health_dodge.gd` covers
the window, roll protection, cooldown, every weapon, and both respawn points.

## Tests

`test/unit/combat/test_movement.gd` covers direction normalization and
deadzones, analog magnitudes, data-defined numbers, body and tilemap collision,
camera clamping and smoothing, and the wired arena scene.

## Debug snapshot, input injection, and replay

Three helpers under `scripts/debug/` support bot playthroughs and bug reports,
and `input_injection.gd` and `state_snapshot.gd` refuse to do anything unless
`OS.is_debug_build()` is true, so a release build cannot reach them. They are
plain classes, not autoloads.

`Replay` records one fixed-tick session: `record({kind, action, direction, x,
y})` stamps the current tick, `advance_tick()` moves on, and `to_json()` writes
`{version, seed, ticks, events}`. `from_json()` reads it back and collects
malformed fields in `errors`. `InputInjection.inject(event)` feeds those events
to the shared `InputActions` and drives a bound `PlayerMovement`.
`StateSnapshot.capture(state)` returns the JSON view of a live session: tick,
entities, orbs, problem, chain and finisher, hearts, entitlement, and cleared.

`data/bots/arena.json` seeds the scripted bot in `test/bots/arena_bot.gd`. The
bot answers every problem by striking the correct orb, records its inputs, and
`replay_session()` re-runs them so a matching snapshot proves determinism.
`test/integration/combat/test_replay_snapshot.gd` covers the clear, the replay
round trip and its determinism, the snapshot, the injection API, and the debug
guard.

## Enemies

`scripts/combat/enemy_state_machine.gd` is the Muddler brain. It cycles through
seven states in a fixed order:

| State | Purpose |
| --- | --- |
| `IDLE` | Brief pause after spawning or resetting. |
| `PATROL` | Walk the room before the hero is noticed. |
| `CHASE` | Close the distance to the hero. |
| `TELEGRAPH` | Show the attack warning for at least 0.4 seconds. |
| `ATTACK` | Resolve the attack. |
| `STAGGER` | Recover after the attack. |
| `UNSCRAMBLE` | Re-form the body, then return to `PATROL`. |

`advance(delta)` steps the state timers, so a test or the scripted bot can run
the brain without a physics frame. `duration_for(State.TELEGRAPH)` and
`telegraph_remaining()` expose the warning window. `apply_config()` clamps any
telegraph below `MIN_TELEGRAPH` (0.4 seconds) so a data mistake cannot remove
the readable warning at default speed.

`data/enemies/muddler_<biome>.json` defines eight archetypes across the meadow,
desert, tundra, forest, swamp, cavern, volcano, and reef biomes. Each document
declares the seven states, a telegraph, speed, hp, and one movement pattern and
one attack pattern. No two archetypes share either pattern.

`scenes/combat/muddler.tscn` is the placeholder enemy: a square `ColorRect` body
and an `Area2D` hitbox with the state machine script on the root. It ships no
final art.

`tools/validate/enemies.py` rejects a document with a missing or unknown state,
a telegraph below 0.4 seconds, a non-positive speed or hp, a missing pattern, or
a movement or attack pattern already used by another archetype.

`test/unit/combat/test_enemy_states.gd` covers the eight biomes, the seven-state
cycle, the telegraph floor, pattern uniqueness, the placeholder scene, and the
validator's rejection cases.

## Orbs, chain, and finisher

`data/combat/orbs.json` defines two to four orbs, the four shapes, the orbit
radius, and the hint-chip and pop durations. `answer_orb.gd` draws a number
label, a shape label, and a matching polygon, so an orb reads by number and
shape rather than colour; `scenes/combat/answer_orb.tscn` is its greybox scene.

`orb_spawner.gd` asks `AnswerMode` how the band is answered: free entry emits
`open_number_pad`, and multiple choice places the answer plus `Distractors` on
the orbit with distinct shapes. A correct strike sets `is_unscrambled`, raises
the `Chain`, and charges the `Finisher`; a wrong strike pops harmlessly, shows a
hint chip, drops the `Chain` one tier (never below zero), and advances the enemy
by `wrongStrikeHastenSeconds`.

`data/combat/chain.json` defines ascending `shardMultiplier`/`finisherCharge`
tiers and the `finisherThreshold`; `tools/validate/orbs_chain.py` rejects bad
counts, missing shapes, and flat tiers, and `test_orbs_chain.gd` covers it all.

## Strike feel

`data/combat/feel.json` defines five effects that fire on every strike:
hit-stop, knockback, squash and stretch, a camera punch, and screen shake.
`scripts/combat/game_feel.gd` starts all five in `strike(direction, power)` and
returns the payload it started; `advance(delta)` steps the timers, and
`knockback_offset()`, `squash_scale()`, and `camera_offset()` give the
per-frame displacement and scale. `OrbSpawner` owns a `GameFeel`, fires it on
both correct and wrong strikes, and emits `felt_strike` with the payload.

Every intensity is multiplied by `power` (clamped to two) so a higher chain
tier hits harder. The `reducedEffects` section holds `intensityScale` and
`durationScale`; when `GameFeel.reduced_effects` is on, every one of the five
effects uses both scales, so the setting softens and shortens all of them at
once. The toggle round-trips through a saved profile under the
`reducedEffects` key. `tools/validate/feel.py` rejects missing effects,
non-positive durations or intensities, scales outside zero to one, and scales
that would not soften anything. `test/unit/combat/test_game_feel.gd` covers the
data, every effect's duration and intensity, the squash-then-stretch envelope,
expiry, the reduced path, the profile round trip, the orb-strike hook, and the
validator.

## Bosses

`data/combat/bosses.json` declares each boss with an island from
`data/curriculum/bands.json`, a total hp, and phases. A phase carries its own hp,
the band ids its mastery rounds draw from, a scripted pattern, and a pattern-loop
duration.

`scripts/combat/boss_state_machine.gd` runs the fight: `damage()` drains the
current phase and hands over at zero hp, `advance(delta)` loops the pattern timer
without skipping a phase, and the last phase emits `defeated`. Every phase entry
records a checkpoint, and `retry()` restores it with full phase hp, so a retry
never replays a completed phase. `mastery_round(rng)` deterministically draws one
of the phase's bands through the injected `Rng`.

`scripts/combat/boss_health_bar.gd` follows a boss's `health_changed` and
`defeated` signals with a greybox background and fill; `scenes/combat/boss.tscn`
is the placeholder boss. `tools/validate/bosses.py` rejects unknown islands,
foreign bands, duplicate ids, and non-positive hp or duration, and
`test/unit/combat/test_boss_framework.gd` covers transitions, checkpoint restore,
mastery selection, the scene, and the validator.
