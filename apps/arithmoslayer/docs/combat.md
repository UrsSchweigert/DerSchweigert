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
