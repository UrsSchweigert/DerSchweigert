class_name Selector
extends RefCounted
## Chooses the next problem from the unlocked bands, mixing new, review, and
## challenge bands toward the target accuracy and interleaving operations. It
## draws only through the injected [Rng], so the same seed replays the same run.

const DEFAULT_PATH: String = "res://data/session/selection.json"
const CATEGORY_NEW: String = "new"
const CATEGORY_REVIEW: String = "review"
const CATEGORY_CHALLENGE: String = "challenge"
const CATEGORIES: Array[String] = [CATEGORY_NEW, CATEGORY_REVIEW, CATEGORY_CHALLENGE]
const CHALLENGE_SHIFT: float = 0.5
const INTERLEAVE_ATTEMPTS: int = 8

var _rng: Rng
var _generator: ProblemGenerator
var _model: MasteryModel
var _bands: Array[Dictionary] = []
var _weights: Dictionary = {CATEGORY_NEW: 0.4, CATEGORY_REVIEW: 0.4, CATEGORY_CHALLENGE: 0.2}
var _target_accuracy: float = 0.8
var _window_size: int = 20
var _mastery_threshold: float = 0.75
var _interleave_operations: bool = true
var _results: Array[bool] = []
var _last_operation: String = ""


## Creates a selector from [param rng], [param generator], [param model], the
## [param bands] list, and [param config] (or the shipped selection file).
func _init(
	rng: Rng,
	generator: ProblemGenerator,
	model: MasteryModel,
	bands: Array = [],
	config: Dictionary = {},
) -> void:
	_rng = rng
	_generator = generator
	_model = model
	for band: Variant in bands:
		if band is Dictionary:
			_bands.append(band)
	_read(config if not config.is_empty() else load_config(DEFAULT_PATH))


## Returns the selection document at [param path], or an empty dictionary when
## it is missing or malformed.
static func load_config(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return parsed as Dictionary if parsed is Dictionary else {}


func _read(config: Dictionary) -> void:
	if _is_bounded(config.get("targetAccuracy", _target_accuracy)):
		_target_accuracy = float(config["targetAccuracy"])
	var window: Variant = config.get("windowSize", _window_size)
	if window is int and int(window) > 0:
		_window_size = int(window)
	if _is_bounded(config.get("masteryThreshold", _mastery_threshold)):
		_mastery_threshold = float(config["masteryThreshold"])
	var interleave: Variant = config.get("interleaveOperations", _interleave_operations)
	if interleave is bool:
		_interleave_operations = interleave
	var raw_weights: Variant = config.get("weights", {})
	if raw_weights is Dictionary:
		var weights: Dictionary = {}
		for category: String in CATEGORIES:
			var value: Variant = (raw_weights as Dictionary).get(category, _weights[category])
			if value is int or value is float:
				weights[category] = float(value)
		if not weights.is_empty():
			_weights = weights


func _is_bounded(value: Variant) -> bool:
	return (value is int or value is float) and float(value) > 0.0 and float(value) <= 1.0


## Returns the band ids whose prerequisites are all mastered.
func unlocked_band_ids() -> Array[String]:
	var unlocked: Array[String] = []
	for band: Dictionary in _bands:
		if _prerequisites_met(band):
			unlocked.append(String(band.get("id", "")))
	return unlocked


## Returns the fraction of the recent window that was correct, or the target
## accuracy while nothing has been recorded.
func recent_accuracy() -> float:
	if _results.is_empty():
		return _target_accuracy
	var correct: int = 0
	for value: bool in _results:
		if value:
			correct += 1
	return float(correct) / float(_results.size())


## Records one first-attempt outcome into the recent window.
func record_result(correct: bool) -> void:
	_results.append(correct)
	while _results.size() > _window_size:
		_results.pop_front()


## Returns the category weights after nudging the challenge share toward the
## target accuracy.
func effective_weights() -> Dictionary:
	var challenge: float = clampf(
		(
			float(_weights.get(CATEGORY_CHALLENGE, 0.0))
			+ (recent_accuracy() - _target_accuracy) * CHALLENGE_SHIFT
		),
		0.0,
		1.0,
	)
	var base_total: float = (
		float(_weights.get(CATEGORY_NEW, 0.0)) + float(_weights.get(CATEGORY_REVIEW, 0.0))
	)
	if base_total <= 0.0:
		return {CATEGORY_NEW: 0.0, CATEGORY_REVIEW: 0.0, CATEGORY_CHALLENGE: challenge}
	var remaining: float = 1.0 - challenge
	return {
		CATEGORY_NEW: float(_weights.get(CATEGORY_NEW, 0.0)) / base_total * remaining,
		CATEGORY_REVIEW: float(_weights.get(CATEGORY_REVIEW, 0.0)) / base_total * remaining,
		CATEGORY_CHALLENGE: challenge,
	}


## Chooses the next problem and returns [code]{problem, band, category}[/code],
## or an empty dictionary when no band is unlocked.
func select() -> Dictionary:
	var unlocked: Array[String] = unlocked_band_ids()
	if unlocked.is_empty():
		return {}
	var category: String = _pick_category(unlocked)
	var band_id: String = _pick_band(category, unlocked)
	var problem: Dictionary = _generate_interleaved(_band_by_id(band_id))
	_last_operation = String(problem.get("operation", ""))
	return {"problem": problem, "band": band_id, "category": category}


func _prerequisites_met(band: Dictionary) -> bool:
	var prereqs: Variant = band.get("prerequisites", [])
	if not (prereqs is Array):
		return true
	for prereq: Variant in prereqs:
		if _model.mastery_for(String(prereq)) < _mastery_threshold:
			return false
	return true


func _category_for(band_id: String) -> String:
	if _model.due_for_review(band_id):
		return CATEGORY_REVIEW
	if _model.mastery_for(band_id) >= _mastery_threshold:
		return CATEGORY_CHALLENGE
	return CATEGORY_NEW


func _pick_category(unlocked: Array[String]) -> String:
	var present: Dictionary = {}
	for band_id: String in unlocked:
		present[_category_for(band_id)] = true
	var weights: Dictionary = effective_weights()
	var total: float = 0.0
	for category: Variant in present:
		total += float(weights.get(String(category), 0.0))
	if total <= 0.0:
		return CATEGORY_NEW
	var roll: float = _draw_float() * total
	for category: Variant in present:
		roll -= float(weights.get(String(category), 0.0))
		if roll < 0.0:
			return String(category)
	return CATEGORY_NEW


func _pick_band(category: String, unlocked: Array[String]) -> String:
	var candidates: Array[String] = []
	for band_id: String in unlocked:
		if _category_for(band_id) == category:
			candidates.append(band_id)
	if _interleave_operations and _last_operation != "" and candidates.size() > 1:
		var alternates: Array[String] = []
		for band_id: String in candidates:
			if _offers_other_operation(band_id):
				alternates.append(band_id)
		if not alternates.is_empty():
			candidates = alternates
	return candidates[_draw_int(0, candidates.size() - 1)]


func _offers_other_operation(band_id: String) -> bool:
	var operations: Dictionary = _band_by_id(band_id).get("operations", {})
	for operation: Variant in operations:
		if String(operation) != _last_operation:
			return true
	return false


func _generate_interleaved(band: Dictionary) -> Dictionary:
	var problem: Dictionary = _generator.generate(band)
	if not _interleave_operations or _last_operation == "":
		return problem
	if (band.get("operations", {}) as Dictionary).size() <= 1:
		return problem
	for _attempt: int in INTERLEAVE_ATTEMPTS:
		if String(problem.get("operation", "")) != _last_operation:
			return problem
		problem = _generator.generate(band)
	return problem


func _band_by_id(band_id: String) -> Dictionary:
	for band: Dictionary in _bands:
		if String(band.get("id", "")) == band_id:
			return band
	return {}


func _draw_float() -> float:
	return float(_rng.call(&"randf"))


func _draw_int(low: int, high: int) -> int:
	return int(_rng.call(&"randi_range", low, high))
