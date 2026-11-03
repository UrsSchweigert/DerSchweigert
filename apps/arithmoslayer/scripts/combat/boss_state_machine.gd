class_name BossStateMachine
extends Node2D
## Runs a multi-phase boss fight from a boss document.
##
## Each phase owns hp, the curriculum bands its mastery rounds draw from, a
## scripted pattern name, and a pattern-loop duration. Damage drains the current
## phase and starts the next one; the timer in [method advance] only loops the
## current phase. Entering a phase records a checkpoint, so [method retry] never
## replays a completed phase. [method mastery_round] draws a band through the
## injected [Rng], keeping replays deterministic.

signal phase_changed(phase_index: int, phase_id: String)
signal health_changed(hp: int, max_hp: int)
signal defeated

const DEFAULT_PATH: String = "res://data/combat/bosses.json"
const BANDS_PATH: String = "res://data/curriculum/bands.json"
const DEFAULT_PHASE_DURATION: float = 12.0
const MAX_LOOPS_PER_STEP: int = 64

@export var data_path: String = DEFAULT_PATH
@export var requested_boss_id: String = ""

var boss_id: String = ""
var island: String = ""
var max_hp: int = 1
var hp: int = 1
var phases: Array[Dictionary] = []
var phase_index: int = 0
var phase_hp: int = 0
var phase_max_hp: int = 0
var phase_time: float = 0.0
var phase_pattern: String = ""
var phase_duration: float = DEFAULT_PHASE_DURATION
var checkpoint_index: int = 0
var checkpoint_hp: int = 0
var checkpoint_max_hp: int = 0
var _defeated: bool = false


func _ready() -> void:
	apply_config(load_config(data_path))


## Returns the boss document at [param path], or an empty dictionary.
static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


## Applies a boss document or a single boss object.
func apply_config(config: Dictionary) -> void:
	var boss: Dictionary = _select_boss(config, requested_boss_id)
	var parsed: Array[Dictionary] = []
	var raw_phases: Variant = boss.get("phases")
	if raw_phases is Array:
		for raw_phase: Variant in raw_phases:
			if raw_phase is Dictionary:
				parsed.append(raw_phase as Dictionary)
	if parsed.is_empty():
		return
	boss_id = _text(boss.get("id"), boss_id)
	island = _text(boss.get("island"), island)
	phases = parsed
	max_hp = _positive_int(boss.get("hp"), _health_from(-1, 0))
	hp = max_hp
	_defeated = false
	_enter_phase(0)


## Returns true once the last phase is empty and defeat is announced.
func is_defeated() -> bool:
	return _defeated


## Returns the id of the current phase, or an empty string before a load.
func current_phase_id() -> String:
	if phase_index < 0 or phase_index >= phases.size():
		return ""
	return _text(phases[phase_index].get("id"), "")


## Returns the band ids the current phase draws mastery rounds from.
func current_phase_bands() -> Array[String]:
	var bands: Array[String] = []
	if phase_index < 0 or phase_index >= phases.size():
		return bands
	var raw_bands: Variant = phases[phase_index].get("bands")
	if raw_bands is Array:
		for raw_band: Variant in raw_bands:
			if raw_band is String and not (raw_band as String).is_empty():
				bands.append(raw_band as String)
	return bands


## Drains [param amount] from the current phase, handing over at zero hp.
func damage(amount: int = 1) -> bool:
	if amount <= 0 or _defeated or phases.is_empty():
		return false
	var applied: int = mini(amount, phase_hp)
	phase_hp -= applied
	hp = maxi(hp - applied, 0)
	if phase_hp > 0:
		health_changed.emit(hp, max_hp)
		return true
	if phase_index + 1 < phases.size():
		_enter_phase(phase_index + 1)
		return true
	_defeated = true
	hp = 0
	health_changed.emit(hp, max_hp)
	defeated.emit()
	return true


## Advances the pattern timer, looping the current phase when it elapses.
func advance(delta: float) -> int:
	if delta <= 0.0 or _defeated or phases.is_empty():
		return phase_index
	phase_time += delta
	var loops: int = 0
	while phase_time >= phase_duration and loops < MAX_LOOPS_PER_STEP:
		phase_time -= phase_duration
		loops += 1
	return phase_index


## Restores the checkpoint recorded at the current phase's start.
func retry() -> bool:
	if phases.is_empty() or checkpoint_index >= phases.size():
		return false
	_defeated = false
	phase_index = checkpoint_index
	phase_max_hp = checkpoint_max_hp
	phase_hp = checkpoint_hp
	phase_time = 0.0
	_read_phase_fields()
	hp = mini(_health_from(phase_index, phase_hp), max_hp)
	health_changed.emit(hp, max_hp)
	phase_changed.emit(phase_index, current_phase_id())
	return true


## Returns one of the current phase's bands through [param rng], or {}.
func mastery_round(rng: Rng) -> Dictionary:
	var bands: Array[String] = current_phase_bands()
	if rng == null or bands.is_empty():
		return {}
	var band_id: String = bands[int(rng.call(&"randi_range", 0, bands.size() - 1))]
	var band: Dictionary = _find_band(load_config(BANDS_PATH), band_id)
	if band.is_empty():
		return {}
	return {
		"phase_id": current_phase_id(),
		"band_id": band_id,
		"island": String(band.get("island", "")),
	}


func _enter_phase(index: int) -> void:
	phase_index = index
	phase_max_hp = _positive_int(phases[index].get("hp"), 1)
	phase_hp = phase_max_hp
	phase_time = 0.0
	_read_phase_fields()
	checkpoint_index = phase_index
	checkpoint_hp = phase_hp
	checkpoint_max_hp = phase_max_hp
	health_changed.emit(hp, max_hp)
	phase_changed.emit(phase_index, current_phase_id())


func _read_phase_fields() -> void:
	if phase_index < 0 or phase_index >= phases.size():
		return
	phase_pattern = _text(phases[phase_index].get("pattern"), phase_pattern)
	phase_duration = _positive_float(phases[phase_index].get("duration"), DEFAULT_PHASE_DURATION)


func _health_from(index: int, current_hp: int) -> int:
	var total: int = current_hp
	for later: int in range(index + 1, phases.size()):
		total += _positive_int(phases[later].get("hp"), 1)
	return total


static func _select_boss(config: Dictionary, wanted_id: String) -> Dictionary:
	var raw_bosses: Variant = config.get("bosses")
	if raw_bosses is Array:
		var fallback: Dictionary = {}
		for raw_boss: Variant in raw_bosses:
			if raw_boss is Dictionary:
				var boss: Dictionary = raw_boss as Dictionary
				fallback = boss if fallback.is_empty() else fallback
				if not wanted_id.is_empty() and _text(boss.get("id"), "") == wanted_id:
					return boss
		return fallback
	return config if config.has("phases") else {}


static func _find_band(document: Dictionary, band_id: String) -> Dictionary:
	var raw_bands: Variant = document.get("bands")
	if raw_bands is Array:
		for raw_band: Variant in raw_bands:
			if raw_band is Dictionary and String(raw_band.get("id", "")) == band_id:
				return raw_band as Dictionary
	return {}


static func _text(value: Variant, fallback: String) -> String:
	if value is String and not (value as String).is_empty():
		return value as String
	return fallback


static func _positive_int(value: Variant, fallback: int) -> int:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return maxi(int(number), 1)
	return maxi(fallback, 1)


static func _positive_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return number
	return fallback
