class_name MasteryModel
extends RefCounted
## Tracks per-band mastery from correctness and response time, reading the
## spaced-review ladder, slow threshold, and EMA learning rate from
## [code]data/mastery/intervals.json[/code]. It reads plain dictionaries and
## draws nothing, so the same profile always lands on the same numbers.

const DEFAULT_PATH: String = "res://data/mastery/intervals.json"
const ACCURACY_WEIGHT: float = 0.7
const FLUENCY_WEIGHT: float = 0.3

var _intervals: Array[int] = [0, 1, 3, 7, 14, 30]
var _slow_threshold_ms: int = 3000
var _learning_rate: float = 0.2
var _skills: Dictionary = {}


## Creates a model from [param config], or from the intervals file when empty.
func _init(config: Dictionary = {}) -> void:
	_read(config if not config.is_empty() else load_config(DEFAULT_PATH))


## Returns the intervals document at [param path], or an empty dictionary.
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


func _read(config: Dictionary) -> void:
	var raw_intervals: Variant = config.get("intervals", [])
	if raw_intervals is Array:
		var intervals: Array[int] = []
		for value: Variant in raw_intervals:
			if value is int or value is float:
				intervals.append(int(value))
		if not intervals.is_empty():
			_intervals = intervals
	var raw_slow: Variant = config.get("slowThresholdMs", _slow_threshold_ms)
	if raw_slow is int or raw_slow is float:
		_slow_threshold_ms = int(raw_slow)
	var raw_rate: Variant = config.get("learningRate", _learning_rate)
	if raw_rate is int or raw_rate is float:
		var rate: float = float(raw_rate)
		if rate > 0.0 and rate <= 1.0:
			_learning_rate = rate


## Records one answered problem for [param band_id]. A correct answer raises
## accuracy and rewards; a slow correct answer still raises both but lowers
## fluency; a wrong answer lowers accuracy and resets the review stage.
func record(band_id: String, correct: bool, response_time_ms: int) -> void:
	var skill: Dictionary = _ensure_skill(band_id)
	var target: float = 1.0 if correct else 0.0
	var accuracy: float = float(skill["accuracy"])
	skill["accuracy"] = accuracy + _learning_rate * (target - accuracy)
	if correct:
		var fast: bool = response_time_ms < _slow_threshold_ms
		var fluency: float = float(skill["fluency"])
		var fluency_target: float = 1.0 if fast else 0.0
		skill["fluency"] = fluency + _learning_rate * (fluency_target - fluency)
		skill["rewards"] = int(skill["rewards"]) + 1
		skill["stage"] = mini(int(skill["stage"]) + 1, _intervals.size() - 1)
		skill["due_in"] = _intervals[int(skill["stage"])]
	else:
		skill["stage"] = 0
		skill["due_in"] = _intervals[0]


## Returns the EMA accuracy for [param band_id] in [code][0, 1][/code].
func accuracy_for(band_id: String) -> float:
	return float(_skill(band_id).get("accuracy", 0.0))


## Returns the EMA fluency for [param band_id] in [code][0, 1][/code].
func fluency_for(band_id: String) -> float:
	return float(_skill(band_id).get("fluency", 0.0))


## Returns mastery for [param band_id] in [code][0, 1][/code], accuracy-weighted.
func mastery_for(band_id: String) -> float:
	var combined: float = (
		ACCURACY_WEIGHT * accuracy_for(band_id) + FLUENCY_WEIGHT * fluency_for(band_id)
	)
	return clampf(combined, 0.0, 1.0)


## Returns how many problems [param band_id] has answered correctly.
func rewards_for(band_id: String) -> int:
	return int(_skill(band_id).get("rewards", 0))


## Returns whether [param band_id] has been seen and is due for review.
func due_for_review(band_id: String) -> bool:
	return _skills.has(band_id) and int(_skills[band_id].get("due_in", 0)) <= 0


## Returns the review interval for [param band_id], or the first one if unseen.
func due_in_for(band_id: String) -> int:
	return int(_skill(band_id).get("due_in", _intervals[0]))


func _ensure_skill(band_id: String) -> Dictionary:
	if not _skills.has(band_id):
		_skills[band_id] = _default_skill()
	return _skills[band_id]


func _skill(band_id: String) -> Dictionary:
	if _skills.has(band_id):
		return _skills[band_id]
	return _default_skill()


func _default_skill() -> Dictionary:
	return {
		"accuracy": 0.0,
		"fluency": 0.0,
		"rewards": 0,
		"stage": 0,
		"due_in": _intervals[0],
	}
