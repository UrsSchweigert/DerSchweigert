class_name GameFeel
extends RefCounted
## Turns a strike into hit-stop, knockback, squash and stretch, a camera punch,
## and screen shake, all read from feel.json.
##
## [method strike] starts every effect and returns the payload it started, so a
## caller can apply the numbers and a test can assert them. When
## [member reduced_effects] is on, every intensity is multiplied by
## [member reduced_intensity_scale] and every duration by
## [member reduced_duration_scale], so one setting softens all five effects.

const DEFAULT_PATH: String = "res://data/combat/feel.json"
const PROFILE_KEY: String = "reducedEffects"
const MAX_POWER: float = 2.0
const SHAKE_VERTICAL_RATIO: float = 1.3

var reduced_effects: bool = false
var reduced_intensity_scale: float = 0.25
var reduced_duration_scale: float = 0.5
var hit_stop_seconds: float = 0.06
var knockback_distance: float = 28.0
var knockback_seconds: float = 0.18
var squash: float = 0.22
var stretch: float = 0.3
var squash_seconds: float = 0.16
var camera_punch_distance: float = 6.0
var camera_punch_seconds: float = 0.12
var shake_amplitude: float = 4.0
var shake_seconds: float = 0.2
var shake_frequency: float = 22.0

var _hit_stop: float = 0.0
var _knockback: Vector2 = Vector2.ZERO
var _knockback_total: float = 0.0
var _knockback_remaining: float = 0.0
var _squash: float = 0.0
var _stretch: float = 0.0
var _squash_total: float = 0.0
var _squash_remaining: float = 0.0
var _punch: Vector2 = Vector2.ZERO
var _punch_total: float = 0.0
var _punch_remaining: float = 0.0
var _shake: float = 0.0
var _shake_total: float = 0.0
var _shake_remaining: float = 0.0
var _shake_elapsed: float = 0.0


func _init(path: String = DEFAULT_PATH) -> void:
	apply_config(load_config(path))


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


## Applies the effect numbers and the reduced-effects scales from a document.
func apply_config(config: Dictionary) -> void:
	var reduced: Dictionary = _dictionary(config.get("reducedEffects"))
	reduced_intensity_scale = _scale(reduced.get("intensityScale"), reduced_intensity_scale)
	reduced_duration_scale = _scale(reduced.get("durationScale"), reduced_duration_scale)
	var hit_stop: Dictionary = _dictionary(config.get("hitStop"))
	hit_stop_seconds = _positive(hit_stop.get("seconds"), hit_stop_seconds)
	var knockback: Dictionary = _dictionary(config.get("knockback"))
	knockback_distance = _positive(knockback.get("distancePx"), knockback_distance)
	knockback_seconds = _positive(knockback.get("seconds"), knockback_seconds)
	var body: Dictionary = _dictionary(config.get("squashStretch"))
	squash = _amount(body.get("squash"), squash)
	stretch = _amount(body.get("stretch"), stretch)
	squash_seconds = _positive(body.get("seconds"), squash_seconds)
	var punch: Dictionary = _dictionary(config.get("cameraPunch"))
	camera_punch_distance = _positive(punch.get("distancePx"), camera_punch_distance)
	camera_punch_seconds = _positive(punch.get("seconds"), camera_punch_seconds)
	var shake: Dictionary = _dictionary(config.get("screenShake"))
	shake_amplitude = _positive(shake.get("amplitudePx"), shake_amplitude)
	shake_seconds = _positive(shake.get("seconds"), shake_seconds)
	shake_frequency = _positive(shake.get("frequency"), shake_frequency)


## Reads the reduced-effects toggle from a saved profile.
func apply_profile(profile: Dictionary) -> void:
	reduced_effects = bool(profile.get(PROFILE_KEY, false))


## Writes the reduced-effects toggle into a copy of [param profile].
func write_profile(profile: Dictionary) -> Dictionary:
	var saved: Dictionary = profile.duplicate(true)
	saved[PROFILE_KEY] = reduced_effects
	return saved


func set_reduced_effects(enabled: bool) -> void:
	reduced_effects = enabled


## Starts every effect for a strike of [param power] along [param direction]
## and returns the durations and intensities it started.
func strike(direction: Vector2 = Vector2.ZERO, power: float = 1.0) -> Dictionary:
	var intensity: float = clampf(power, 0.0, MAX_POWER)
	var duration: float = 1.0
	if reduced_effects:
		intensity *= reduced_intensity_scale
		duration *= reduced_duration_scale
	var heading: Vector2 = direction.normalized() if direction.length() > 0.0 else Vector2.ZERO
	_hit_stop = hit_stop_seconds * duration
	_knockback = heading * knockback_distance * intensity
	_knockback_total = knockback_seconds * duration
	_knockback_remaining = _knockback_total
	_squash = squash * intensity
	_stretch = stretch * intensity
	_squash_total = squash_seconds * duration
	_squash_remaining = _squash_total
	_punch = heading * camera_punch_distance * intensity
	_punch_total = camera_punch_seconds * duration
	_punch_remaining = _punch_total
	_shake = shake_amplitude * intensity
	_shake_total = shake_seconds * duration
	_shake_remaining = _shake_total
	_shake_elapsed = 0.0
	return {
		"hitStop": {"seconds": _hit_stop},
		"knockback": {"offset": _knockback, "seconds": _knockback_total},
		"squashStretch": {"squash": _squash, "stretch": _stretch, "seconds": _squash_total},
		"cameraPunch": {"offset": _punch, "seconds": _punch_total},
		"screenShake": {"amplitude": _shake, "seconds": _shake_total, "frequency": shake_frequency},
	}


## Steps every timer, so expired effects stop contributing offsets.
func advance(delta: float) -> void:
	if delta <= 0.0:
		return
	_hit_stop = maxf(_hit_stop - delta, 0.0)
	_knockback_remaining = maxf(_knockback_remaining - delta, 0.0)
	_squash_remaining = maxf(_squash_remaining - delta, 0.0)
	_punch_remaining = maxf(_punch_remaining - delta, 0.0)
	_shake_remaining = maxf(_shake_remaining - delta, 0.0)
	_shake_elapsed += delta


func is_hit_stopping() -> bool:
	return _hit_stop > 0.0


## Returns the decaying knockback displacement for this frame.
func knockback_offset() -> Vector2:
	return _knockback * _decay(_knockback_remaining, _knockback_total)


## Returns the body scale: a squash for the first half, a stretch for the second.
func squash_scale() -> Vector2:
	if _squash_remaining <= 0.0 or _squash_total <= 0.0:
		return Vector2.ONE
	var progress: float = 1.0 - _squash_remaining / _squash_total
	var pulse: float = sin(PI * progress)
	if progress < 0.5:
		return Vector2(1.0 + _squash * pulse, 1.0 - _squash * pulse)
	return Vector2(1.0 - _stretch * pulse, 1.0 + _stretch * pulse)


## Returns the punch and shake displacement a camera should add this frame.
func camera_offset() -> Vector2:
	return punch_offset() + shake_offset()


func punch_offset() -> Vector2:
	return _punch * _decay(_punch_remaining, _punch_total)


func shake_offset() -> Vector2:
	if _shake_remaining <= 0.0 or _shake_total <= 0.0:
		return Vector2.ZERO
	var phase: float = _shake_elapsed * shake_frequency
	var wave: Vector2 = Vector2(sin(phase), cos(phase * SHAKE_VERTICAL_RATIO))
	return wave * _shake * (_shake_remaining / _shake_total)


static func _decay(remaining: float, total: float) -> float:
	return remaining / total if remaining > 0.0 and total > 0.0 else 0.0


static func _dictionary(value: Variant) -> Dictionary:
	return value if value is Dictionary else {}


static func _scale(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return clampf(number, 0.0, 1.0) if is_finite(number) else fallback


static func _amount(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number >= 0.0 and number <= 1.0 and is_finite(number) else fallback


static func _positive(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number > 0.0 and is_finite(number) else fallback
