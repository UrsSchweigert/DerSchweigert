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

## Tests

`test/unit/combat/test_movement.gd` covers direction normalization and
deadzones, analog magnitudes, data-defined numbers, body and tilemap collision,
camera clamping and smoothing, and the wired arena scene.
