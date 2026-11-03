class_name PlayerMovement
extends CharacterBody2D
## Moves the hero in eight directions with data-defined speed and acceleration.
##
## The body reads a direction from [MoveInput], accelerates toward it, and uses
## [method CharacterBody2D.move_and_slide] so tilemap and body collisions slide
## instead of tunnelling. Tests and the bot drive it directly with [method drive]
## to replay a scripted path.

const DEFAULT_PATH: String = "res://data/combat/player.json"
const DEFAULT_MAX_SPEED: float = 220.0
const DEFAULT_ACCELERATION: float = 1600.0
const DEFAULT_DECELERATION: float = 2000.0
const DEFAULT_RADIUS: float = 14.0

var max_speed: float = DEFAULT_MAX_SPEED
var acceleration: float = DEFAULT_ACCELERATION
var deceleration: float = DEFAULT_DECELERATION
var radius: float = DEFAULT_RADIUS
var speed_multiplier: float = 1.0
var input: MoveInput = MoveInput.new()
var actions: InputActions = null

var _driven: bool = false
var _driven_direction: Vector2 = Vector2.ZERO


func _ready() -> void:
	motion_mode = MOTION_MODE_FLOATING
	apply_config(load_config(DEFAULT_PATH))
	_ensure_collider()


## Returns the player document at [param path], or an empty dictionary.
static func load_config(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not (parsed is Dictionary):
		return {}
	return parsed as Dictionary


## Applies the movement numbers from a player document, keeping the current
## values for anything missing or invalid.
func apply_config(config: Dictionary) -> void:
	var movement: Variant = config.get("movement", {})
	if not (movement is Dictionary):
		return
	max_speed = _positive_float(movement.get("maxSpeed"), max_speed)
	acceleration = _positive_float(movement.get("acceleration"), acceleration)
	deceleration = _positive_float(movement.get("deceleration"), deceleration)
	radius = _positive_float(movement.get("radius"), radius)


## Drives the body from [param direction] until [method release_drive] is called.
func drive(direction: Vector2) -> void:
	_driven_direction = direction.limit_length(1.0)
	_driven = true


## Returns control of the body to the input devices.
func release_drive() -> void:
	_driven = false


## Returns the velocity after accelerating [param current] toward
## [param direction] for [param delta] seconds.
func step_velocity(current: Vector2, direction: Vector2, delta: float) -> Vector2:
	var target: Vector2 = direction.limit_length(1.0) * max_speed * speed_multiplier
	var rate: float = acceleration if direction.length_squared() > 0.0 else deceleration
	return current.move_toward(target, rate * delta)


func _physics_process(delta: float) -> void:
	var direction: Vector2 = _driven_direction if _driven else _poll_direction()
	velocity = step_velocity(velocity, direction, delta)
	move_and_slide()


func _poll_direction() -> Vector2:
	if actions != null:
		return actions.move
	return input.poll()


func _ensure_collider() -> void:
	var collider: CollisionShape2D = get_node_or_null("CollisionShape2D") as CollisionShape2D
	if collider == null:
		var circle: CircleShape2D = CircleShape2D.new()
		circle.radius = radius
		collider = CollisionShape2D.new()
		collider.name = "CollisionShape2D"
		collider.shape = circle
		add_child(collider)
	elif collider.shape is CircleShape2D:
		(collider.shape as CircleShape2D).radius = radius


static func _positive_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return number
	return fallback
