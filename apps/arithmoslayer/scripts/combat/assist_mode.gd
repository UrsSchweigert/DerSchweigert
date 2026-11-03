class_name AssistMode
extends RefCounted
## A per-profile play style: it aims, simplifies, and slows enemies, but it
## never reduces rewards, so an assisted profile earns what every other earns.

const DEFAULT_PATH: String = "res://data/combat/assist.json"
const PROFILE_KEY: String = "assistMode"
const DEFAULT_ENEMY_SPEED_MULTIPLIER: float = 0.7
const DEFAULT_AUTO_TARGET_RADIUS: float = 260.0

var enabled: bool = false
var profile_key: String = PROFILE_KEY
var display_name: String = "Assist"
var auto_target_radius: float = DEFAULT_AUTO_TARGET_RADIUS
var one_button_combos: bool = true
var timers: bool = false
var enemy_speed_multiplier: float = DEFAULT_ENEMY_SPEED_MULTIPLIER


func _init(path: String = DEFAULT_PATH) -> void:
	apply_config(load_config(path))


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


func apply_config(config: Dictionary) -> void:
	profile_key = _text(config.get("profileKey"), profile_key)
	var presentation: Dictionary = _dictionary(config.get("presentation"))
	display_name = _text(presentation.get("name"), display_name)
	auto_target_radius = _positive_float(
		_dictionary(config.get("autoTarget")).get("radiusPx"), auto_target_radius
	)
	one_button_combos = _bool(config.get("oneButtonCombos"), one_button_combos)
	timers = _bool(config.get("timers"), timers)
	enemy_speed_multiplier = clampf(
		_positive_float(config.get("enemySpeedMultiplier"), enemy_speed_multiplier), 0.1, 1.0
	)


func set_enabled(value: bool) -> void:
	enabled = value


func apply_profile(profile: Dictionary) -> void:
	enabled = bool(profile.get(profile_key, false))


func write_profile(profile: Dictionary) -> Dictionary:
	var saved: Dictionary = profile.duplicate(true)
	saved[profile_key] = enabled
	return saved


## Returns the nearest orb index inside the auto-target radius, or -1.
func target_index(origin: Vector2, orbs: Array[Vector2]) -> int:
	if not enabled:
		return -1
	var best: int = -1
	var best_distance: float = auto_target_radius
	for index: int in orbs.size():
		var distance: float = origin.distance_to(orbs[index])
		if distance <= best_distance:
			best = index
			best_distance = distance
	return best


func aim_direction(origin: Vector2, orbs: Array[Vector2]) -> Vector2:
	var index: int = target_index(origin, orbs)
	return Vector2.ZERO if index < 0 else origin.direction_to(orbs[index])


## Assist turns every hold, charge, swipe, and rhythm step into one tap.
func input_for(step: WeaponDefinition.Step) -> Dictionary:
	if enabled and one_button_combos:
		return {"kind": InputActions.TAP, "direction": ""}
	return {"kind": step.input_kind, "direction": step.input_direction}


func enemy_speed_scale() -> float:
	return enemy_speed_multiplier if enabled else 1.0


## The base game has timers; assist does not.
func timers_enabled() -> bool:
	return timers if enabled else true


## Rewards are never reduced: this is a play style, not a penalty.
func reward_scale() -> float:
	return 1.0


static func _dictionary(value: Variant) -> Dictionary:
	return value if value is Dictionary else {}


static func _text(value: Variant, fallback: String) -> String:
	return String(value) if value is String and not (value as String).is_empty() else fallback


static func _bool(value: Variant, fallback: bool) -> bool:
	return bool(value) if value is bool else fallback


static func _positive_float(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number > 0.0 and is_finite(number) else fallback
