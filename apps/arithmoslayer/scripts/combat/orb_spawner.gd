class_name OrbSpawner
extends Node2D
## Builds the readable answer orbs that surround a Muddler.
##
## Free entry opens the number pad; multiple choice places two to four orbs on an
## orbit, each with its own number and shape. A correct strike raises the Chain
## and charges the Finisher; a wrong strike pops harmlessly, hints, drops the
## Chain one tier, and hastens the enemy. No strike ends the fight.

signal open_number_pad
signal correct_strike(orb: AnswerOrb, value: int)
signal wrong_strike(orb: AnswerOrb, value: int, hint: String)
signal unscrambled

const DEFAULT_PATH: String = "res://data/combat/orbs.json"
const ORB_SCENE_PATH: String = "res://scenes/combat/answer_orb.tscn"
const SYMBOLS: Dictionary = {
	"addition": "+",
	"subtraction": "-",
	"multiplication": "x",
	"division": "/",
}

var min_orbs: int = 2
var max_orbs: int = 4
var shapes: Array[String] = ["circle", "triangle", "square", "diamond"]
var orbit_radius: float = 56.0
var hint_chip_seconds: float = 1.4
var wrong_strike_hasten: float = 0.3

var enemy: Node = null
var chain: Chain = null
var finisher: Finisher = null
var orbs: Array[AnswerOrb] = []
var is_unscrambled: bool = false
var hint_text: String = ""

var _rng: Rng
var _mode: AnswerMode
var _distractors: Distractors
var _problem: Dictionary = {}
var _angle: float = 0.0
var _orb_scene: PackedScene = null


func _init(rng: Rng = null, mode: AnswerMode = null) -> void:
	_rng = rng if rng != null else Rng.new(0)
	_mode = mode if mode != null else AnswerMode.new()
	_distractors = Distractors.new(_rng)
	chain = Chain.new()
	finisher = Finisher.new()
	apply_config(load_config(DEFAULT_PATH))


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


func apply_config(config: Dictionary) -> void:
	min_orbs = clampi(_integer(config.get("minOrbs"), min_orbs), 2, 4)
	max_orbs = clampi(_integer(config.get("maxOrbs"), max_orbs), min_orbs, 4)
	var declared: Variant = config.get("shapes")
	if declared is Array and (declared as Array).size() >= 2:
		shapes.clear()
		for shape_value: Variant in declared:
			if shape_value is String and not shapes.has(String(shape_value)):
				shapes.append(String(shape_value))
	var orbit: Variant = config.get("orbit")
	var radius: Variant = (orbit as Dictionary).get("radiusPx") if orbit is Dictionary else null
	orbit_radius = _number(radius, orbit_radius, 0.0)
	hint_chip_seconds = _number(config.get("hintChipSeconds"), hint_chip_seconds, 0.0)
	wrong_strike_hasten = _number(config.get("wrongStrikeHastenSeconds"), wrong_strike_hasten, 0.0)


## Shows orbs for [param problem] and returns them, or opens the number pad.
func present(problem: Dictionary, band: Dictionary, mastery: float) -> Array[AnswerOrb]:
	clear()
	_problem = problem
	hint_text = ""
	is_unscrambled = false
	var resolved: Dictionary = _mode.resolve(band, mastery, max_orbs - 1)
	if not problem.has("answer") or String(resolved.get("kind", "")) == AnswerMode.KIND_NUMERIC:
		open_number_pad.emit()
		return []
	var count: int = clampi(int(resolved.get("orbs", min_orbs)), min_orbs, max_orbs)
	var answer: int = int(problem.get("answer", 0))
	var values: Array[int] = [answer]
	for distractor: Dictionary in _distractors.generate(problem, count - 1):
		var value: int = int(distractor.get("value", answer))
		if not values.has(value):
			values.append(value)
	var offset: int = 1
	while values.size() < count:
		if not values.has(answer + offset):
			values.append(answer + offset)
		elif answer - offset >= 0 and not values.has(answer - offset):
			values.append(answer - offset)
		offset += 1
	values.resize(count)
	_angle = float(_rng.call(&"randf_range", 0.0, TAU))
	var shape_offset: int = int(_rng.call(&"randi_range", 0, shapes.size() - 1))
	for index: int in count:
		var shape_name: String = shapes[(index + shape_offset) % shapes.size()]
		var orb: AnswerOrb = _make_orb(values[index], shape_name, values[index] == answer)
		var angle: float = _angle + TAU * float(index) / float(count)
		orb.position = Vector2(cos(angle), sin(angle)) * orbit_radius
		add_child(orb)
		orb.struck.connect(_on_orb_struck)
		orbs.append(orb)
	return orbs


## Removes every orb from the previous problem.
func clear() -> void:
	for orb: AnswerOrb in orbs:
		if is_instance_valid(orb):
			remove_child(orb)
			orb.queue_free()
	orbs.clear()


func _on_orb_struck(orb: AnswerOrb) -> void:
	if is_unscrambled:
		return
	if orb.is_correct:
		is_unscrambled = true
		chain.raise()
		finisher.add(chain.finisher_charge())
		correct_strike.emit(orb, orb.value)
		unscrambled.emit()
		return
	orb.pop()
	chain.drop()
	var symbol: String = String(SYMBOLS.get(String(_problem.get("operation", "")), "?"))
	hint_text = (
		"Not %d: %d %s %d"
		% [
			orb.value,
			int(_problem.get("a", 0)),
			symbol,
			int(_problem.get("b", 0)),
		]
	)
	if wrong_strike_hasten > 0.0 and enemy is EnemyStateMachine:
		(enemy as EnemyStateMachine).advance(wrong_strike_hasten)
	wrong_strike.emit(orb, orb.value, hint_text)


func _make_orb(value: int, shape_name: String, correct: bool) -> AnswerOrb:
	if _orb_scene == null:
		_orb_scene = load(ORB_SCENE_PATH) as PackedScene
	var orb: AnswerOrb = null
	if _orb_scene != null:
		orb = _orb_scene.instantiate() as AnswerOrb
	if orb == null:
		orb = AnswerOrb.new()
	orb.configure(value, shape_name, correct)
	return orb


static func _integer(value: Variant, fallback: int) -> int:
	return int(value) if value is int or value is float else fallback


static func _number(value: Variant, fallback: float, minimum: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number >= minimum and is_finite(number) else fallback
