class_name TimeControl
extends RefCounted
## Slows the world and freezes timers while a modal entry (the number pad) is open.
##
## Opening the pad calls [method open]; gameplay reads [method time_scale] to
## multiply movement and [method timers_paused] to freeze countdowns and
## cooldowns. The slow factor is data-tunable and defaults to fifteen percent.

const DEFAULT_PATH: String = "res://data/input/number_pad.json"
const DEFAULT_SLOW_SCALE: float = 0.15
const MIN_SLOW_SCALE: float = 0.05
const MAX_SLOW_SCALE: float = 1.0

var slow_scale: float = DEFAULT_SLOW_SCALE

var _active: bool = false
var _requests: int = 0


func _init(path: String = DEFAULT_PATH) -> void:
	apply_config(load_config(path))


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


func apply_config(config: Dictionary) -> void:
	slow_scale = clampf(
		_number(config.get("slowScale"), slow_scale), MIN_SLOW_SCALE, MAX_SLOW_SCALE
	)


## Opens one slow request; the world stays slow until every request closes.
func open() -> void:
	_requests += 1
	_active = true


func close() -> void:
	_requests = maxi(_requests - 1, 0)
	_active = _requests > 0


func is_active() -> bool:
	return _active


## World multiplier: [member slow_scale] while active, otherwise full speed.
func time_scale() -> float:
	return slow_scale if _active else 1.0


## Timers freeze entirely while the pad is open.
func timers_paused() -> bool:
	return _active


## Scales a frame delta by the current world multiplier.
func scale_delta(delta: float) -> float:
	return maxf(delta, 0.0) * time_scale()


static func _number(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if is_finite(number) else fallback
