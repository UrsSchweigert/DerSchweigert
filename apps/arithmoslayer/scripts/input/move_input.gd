class_name MoveInput
extends RefCounted
## Turns keyboard, gamepad, and touch input into one analog movement vector.
##
## The result always points along one of eight compass directions and is at most
## one unit long, so a diagonal is never faster than a straight line. Gameplay
## code reads this abstraction instead of the [Input] singleton, and tests feed
## the same functions directly.

const DEADZONE: float = 0.2
const DIRECTIONS: int = 8

var _touch_vector: Vector2 = Vector2.ZERO


## Returns the direction the given keys ask for, with up as negative Y.
static func keyboard_vector(left: bool, right: bool, up: bool, down: bool) -> Vector2:
	return Vector2(float(right) - float(left), float(down) - float(up))


## Returns the direction the left stick asks for, ignoring values under
## [param deadzone].
static func stick_vector(stick: Vector2, deadzone: float = DEADZONE) -> Vector2:
	if stick.length() <= deadzone:
		return Vector2.ZERO
	return stick.limit_length(1.0)


## Snaps [param raw] to the nearest of eight directions and keeps its magnitude
## between zero and one.
static func eight_way(raw: Vector2, deadzone: float = DEADZONE) -> Vector2:
	var magnitude: float = minf(raw.length(), 1.0)
	if magnitude <= deadzone:
		return Vector2.ZERO
	var step: float = TAU / float(DIRECTIONS)
	var snapped: float = roundf(raw.angle() / step) * step
	return Vector2.from_angle(snapped) * magnitude


## Returns the strongest of the keyboard, stick, and touch vectors as an
## eight-way direction.
static func combine(keyboard: Vector2, stick: Vector2, touch: Vector2) -> Vector2:
	var strongest: Vector2 = keyboard.limit_length(1.0)
	for candidate: Vector2 in [stick.limit_length(1.0), touch.limit_length(1.0)]:
		if candidate.length() > strongest.length():
			strongest = candidate
	return eight_way(strongest)


## Sets the vector a touch joystick reports, already relative to its center.
func set_touch_vector(vector: Vector2) -> void:
	_touch_vector = vector.limit_length(1.0)


## Returns the eight-way direction from every connected input device.
func poll() -> Vector2:
	var keyboard: Vector2 = keyboard_vector(
		Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT),
		Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT),
		Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP),
		Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN),
	)
	var stick: Vector2 = stick_vector(
		Vector2(
			Input.get_joy_axis(0, JOY_AXIS_LEFT_X),
			Input.get_joy_axis(0, JOY_AXIS_LEFT_Y),
		)
	)
	return combine(keyboard, stick, _touch_vector)
