class_name Dodge
extends Node
## A dodge roll with data-defined invulnerability frames and cooldown.
## [method try_dodge] cancels whatever combo is active, so every weapon can roll
## out of its own steps, and the hero's [Health] consults the roll's i-frames.

const DEFAULT_PATH: String = "res://data/combat/health.json"
const DEFAULT_COOLDOWN: float = 0.9
const DEFAULT_DURATION: float = 0.35
const DEFAULT_IFRAME_START: float = 0.05
const DEFAULT_IFRAME_END: float = 0.3
const DEFAULT_SPEED_MULTIPLIER: float = 2.4

var cooldown_seconds: float = DEFAULT_COOLDOWN
var duration_seconds: float = DEFAULT_DURATION
var invulnerability_start_seconds: float = DEFAULT_IFRAME_START
var invulnerability_end_seconds: float = DEFAULT_IFRAME_END
var speed_multiplier: float = DEFAULT_SPEED_MULTIPLIER

var _rolling: bool = false
var _elapsed: float = 0.0
var _cooldown_left: float = 0.0


func _ready() -> void:
	apply_config(Health.load_config(DEFAULT_PATH))


func apply_config(config: Dictionary) -> void:
	var section: Variant = config.get("dodge", {})
	if not (section is Dictionary):
		return
	cooldown_seconds = _positive_float(section.get("cooldownSeconds"), cooldown_seconds)
	duration_seconds = _positive_float(section.get("durationSeconds"), duration_seconds)
	speed_multiplier = _positive_float(section.get("speedMultiplier"), speed_multiplier)
	invulnerability_start_seconds = _non_negative_float(
		section.get("invulnerabilityStartSeconds"), invulnerability_start_seconds
	)
	invulnerability_end_seconds = _non_negative_float(
		section.get("invulnerabilityEndSeconds"), invulnerability_end_seconds
	)
	cooldown_seconds = maxf(cooldown_seconds, duration_seconds)
	invulnerability_start_seconds = clampf(invulnerability_start_seconds, 0.0, duration_seconds)
	invulnerability_end_seconds = clampf(
		invulnerability_end_seconds, invulnerability_start_seconds, duration_seconds
	)


func try_dodge(combo: ComboEngine = null) -> bool:
	if not can_dodge():
		return false
	if combo != null:
		combo.cancel()
	_rolling = true
	_elapsed = 0.0
	_cooldown_left = cooldown_seconds
	return true


func advance(delta: float) -> void:
	if delta <= 0.0:
		return
	_cooldown_left = maxf(_cooldown_left - delta, 0.0)
	if not _rolling:
		return
	_elapsed = minf(_elapsed + delta, duration_seconds)
	if _elapsed >= duration_seconds:
		_rolling = false


func is_invulnerable() -> bool:
	return (
		_rolling
		and _elapsed >= invulnerability_start_seconds
		and _elapsed < invulnerability_end_seconds
	)


func is_rolling() -> bool:
	return _rolling


func can_dodge() -> bool:
	return not _rolling and _cooldown_left <= 0.0


func elapsed_seconds() -> float:
	return _elapsed


func speed_scale() -> float:
	return speed_multiplier if _rolling else 1.0


func reset() -> void:
	_rolling = false
	_elapsed = 0.0
	_cooldown_left = 0.0


static func _positive_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return number
	return fallback


static func _non_negative_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number >= 0.0 and is_finite(number):
			return number
	return fallback
