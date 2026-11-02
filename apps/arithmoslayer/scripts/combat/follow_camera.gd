class_name FollowCamera
extends Camera2D
## Follows a target with exponential smoothing and clamps the view to the room.
##
## The camera centers on its target but never shows outside the room: when the
## room is larger than the viewport the center stops half a viewport from each
## wall, and when the room is smaller the camera stays on the room center. The
## smoothing runs at the fixed physics step so a replay keeps the same framing.

const DEFAULT_PATH: String = "res://data/combat/player.json"

@export var target: Node2D
@export var room_size: Vector2 = Vector2(1600.0, 900.0)
@export var smoothing_speed: float = 6.0


func _ready() -> void:
	apply_config(PlayerMovement.load_config(DEFAULT_PATH))
	apply_room()
	snap_to_target()


## Applies the camera numbers from a player document.
func apply_config(config: Dictionary) -> void:
	var settings: Variant = config.get("camera", {})
	if not (settings is Dictionary):
		return
	var speed: Variant = settings.get("smoothingSpeed", smoothing_speed)
	if speed is int or speed is float:
		smoothing_speed = maxf(float(speed), 0.0)
	var zoom_value: Variant = settings.get("zoom", zoom.x)
	if zoom_value is int or zoom_value is float:
		zoom = Vector2.ONE * maxf(float(zoom_value), 0.01)


## Publishes the room bounds as camera limits.
func apply_room() -> void:
	limit_left = 0
	limit_top = 0
	limit_right = maxi(int(room_size.x), 1)
	limit_bottom = maxi(int(room_size.y), 1)


## Jumps straight to the clamped target position without smoothing.
func snap_to_target() -> void:
	if target != null:
		global_position = clamp_center(target.global_position, room_size, view_size())


## Returns the viewport size in world units, accounting for zoom.
func view_size() -> Vector2:
	return get_viewport_rect().size / zoom


## Returns the camera center for [param target_position] after one smoothed
## physics step toward the clamped target.
func step_position(
	current: Vector2, target_position: Vector2, view: Vector2, delta: float
) -> Vector2:
	var desired: Vector2 = clamp_center(target_position, room_size, view)
	if smoothing_speed <= 0.0:
		return desired
	return current.lerp(desired, 1.0 - exp(-smoothing_speed * delta))


## Returns [param target] clamped so a view of [param view] stays inside
## [param room], centered when the room is smaller than the view.
static func clamp_center(target: Vector2, room: Vector2, view: Vector2) -> Vector2:
	return Vector2(_clamp_axis(target.x, room.x, view.x), _clamp_axis(target.y, room.y, view.y))


static func _clamp_axis(value: float, room: float, view: float) -> float:
	if view <= 0.0 or room <= view:
		return room * 0.5
	return clampf(value, view * 0.5, room - view * 0.5)


func _physics_process(delta: float) -> void:
	if target == null:
		return
	global_position = step_position(global_position, target.global_position, view_size(), delta)
