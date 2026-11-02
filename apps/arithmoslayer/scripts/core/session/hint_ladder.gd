class_name HintLadder
extends RefCounted
## Serves the gentle three-rung feedback ladder for one problem.
##
## [code]data/session/feedback.json[/code] orders the stages and names the
## visual models each operation prefers. Each wrong answer advances one rung and
## never moves backwards; a correct answer resets the ladder for the next
## problem. The class only reads plain dictionaries, so it works headlessly.

const DEFAULT_PATH: String = "res://data/session/feedback.json"
const VISUAL_MODEL: String = "visual_model"
const DECOMPOSITION: String = "decomposition"
const ANSWER: String = "answer"
const MODEL_IDS: Array[String] = ["dot_array", "ten_frame", "number_line", "equal_groups"]

var _stages: Array[String] = [VISUAL_MODEL, DECOMPOSITION, ANSWER]
var _models: Dictionary = {}
var _rung: int = 0


## Creates a ladder from [param config], or from the feedback file when the
## dictionary is empty.
func _init(config: Dictionary = {}) -> void:
	_read(config if not config.is_empty() else load_config(DEFAULT_PATH))


## Returns the feedback document at [param path], or an empty dictionary when
## it is missing or malformed.
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
	var stages: Array[String] = []
	var raw_stages: Variant = config.get("stages", [])
	if raw_stages is Array:
		for value: Variant in raw_stages:
			var stage: String = String(value)
			if stage in _stages and not stages.has(stage):
				stages.append(stage)
	if not stages.is_empty():
		_stages = stages
	var raw_models: Variant = config.get("visualModels", {})
	if not (raw_models is Dictionary):
		return
	for operation: Variant in raw_models as Dictionary:
		var raw_list: Variant = (raw_models as Dictionary)[operation]
		if not (raw_list is Array):
			continue
		var models: Array[String] = []
		for value: Variant in raw_list:
			var model: String = String(value)
			if model in MODEL_IDS and not models.has(model):
				models.append(model)
		if not models.is_empty():
			_models[String(operation)] = models


## Records one wrong answer and returns the current hint.
func wrong(problem: Dictionary = {}) -> Dictionary:
	_rung = mini(_rung + 1, _stages.size())
	return rung_for(problem)


## Records a correct answer, resetting the ladder for the next problem.
func correct() -> void:
	_rung = 0


## Returns how many rungs are showing; zero means no hint yet.
func rung() -> int:
	return _rung


## Returns the current stage name, or an empty string before the first miss.
func stage() -> String:
	if _rung == 0:
		return ""
	return _stages[_rung - 1]


## Returns the current hint for [param problem] without advancing the ladder.
func rung_for(problem: Dictionary = {}) -> Dictionary:
	match stage():
		VISUAL_MODEL:
			return {"stage": VISUAL_MODEL, "model": model_for(problem)}
		DECOMPOSITION:
			return {"stage": DECOMPOSITION, "steps": decomposition(problem)}
		ANSWER:
			return {
				"stage": ANSWER,
				"answer": int(problem.get("answer", 0)),
				"replay": true,
				"problem": problem.duplicate(true),
			}
	return {}


## Returns the preferred visual model for [param problem]'s operation. The
## choice is deterministic for the same problem data.
func model_for(problem: Dictionary) -> String:
	var operation: String = String(problem.get("operation", ""))
	var models: Array[String] = MODEL_IDS
	if _models.has(operation):
		models = _models[operation]
	var index: int = posmod(int(problem.get("a", 0)) + int(problem.get("b", 0)), models.size())
	return models[index]


## Returns the worked steps that lead from [param problem] to its answer.
func decomposition(problem: Dictionary) -> Array[String]:
	var a: int = int(problem.get("a", 0))
	var b: int = int(problem.get("b", 0))
	var answer: int = int(problem.get("answer", 0))
	match String(problem.get("operation", "")):
		"addition":
			return ["%d + %d" % [a, b], "%d + %d = %d" % [a, b, answer]]
		"subtraction":
			return ["%d - %d" % [a, b], "%d - %d = %d" % [a, b, answer]]
		"multiplication":
			return ["%d groups of %d" % [b, a], "%d × %d = %d" % [a, b, answer]]
		"division":
			return ["%d shared into %d groups" % [a, b], "%d ÷ %d = %d" % [a, b, answer]]
	return []
