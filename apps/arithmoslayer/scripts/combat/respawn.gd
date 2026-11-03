class_name Respawn
extends Node
## Returns the hero to the room entrance or last checkpoint after a defeat.
## A defeat starts a short delay, then moves the body, refills every heart, and
## grants invulnerability. Earned items and score are never touched, so there is
## no game-over screen and no lost progress.

signal respawned(position: Vector2)

const DEFAULT_PATH: String = "res://data/combat/health.json"
const DEFAULT_DELAY: float = 0.6
const DEFAULT_INVULNERABILITY: float = 1.5

@export var entrance_position: Vector2 = Vector2.ZERO
var checkpoint_position: Vector2 = Vector2.ZERO
var has_checkpoint: bool = false
var delay_seconds: float = DEFAULT_DELAY
var invulnerability_seconds: float = DEFAULT_INVULNERABILITY
var progress: Dictionary = {}

var _pending: bool = false
var _timer: float = 0.0


func _ready() -> void:
	apply_config(Health.load_config(DEFAULT_PATH))


func apply_config(config: Dictionary) -> void:
	var section: Variant = config.get("respawn", {})
	if not (section is Dictionary):
		return
	delay_seconds = _non_negative_float(section.get("delaySeconds"), delay_seconds)
	invulnerability_seconds = _non_negative_float(
		section.get("invulnerabilitySeconds"), invulnerability_seconds
	)


func set_progress(earned: Dictionary) -> void:
	progress = earned


func earned_progress() -> Dictionary:
	return progress


func set_checkpoint(position: Vector2) -> void:
	checkpoint_position = position
	has_checkpoint = true


func spawn_position() -> Vector2:
	return checkpoint_position if has_checkpoint else entrance_position


func is_pending() -> bool:
	return _pending


func begin(health: Health) -> bool:
	if health == null or not health.is_defeated() or _pending:
		return false
	_pending = true
	_timer = delay_seconds
	return true


func advance(
	delta: float, player: Node2D = null, health: Health = null, dodge: Dodge = null
) -> bool:
	if not _pending:
		return false
	_timer = maxf(_timer - maxf(delta, 0.0), 0.0)
	if _timer > 0.0:
		return false
	_apply(player, health, dodge)
	return true


func respawn_now(player: Node2D, health: Health, dodge: Dodge = null) -> Vector2:
	_apply(player, health, dodge)
	return spawn_position()


func _apply(player: Node2D, health: Health, dodge: Dodge) -> void:
	var position: Vector2 = spawn_position()
	if player != null:
		player.global_position = position
	if health != null:
		health.restore()
		health.grant_invulnerability(invulnerability_seconds)
	if dodge != null:
		dodge.reset()
	_pending = false
	_timer = 0.0
	respawned.emit(position)


static func _non_negative_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number >= 0.0 and is_finite(number):
			return number
	return fallback
