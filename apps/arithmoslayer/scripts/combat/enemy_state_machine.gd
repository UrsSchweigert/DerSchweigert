class_name EnemyStateMachine
extends Node2D
## Runs the seven-state Muddler brain and reads its numbers from an enemy document.
##
## A Muddler cycles idle, patrol, chase, telegraph, attack, stagger, and
## unscramble before returning to patrol. The telegraph is the readable warning
## before an attack and never drops below [constant MIN_TELEGRAPH] seconds, even
## when a document asks for a shorter one. Tests and the bot can call
## [method advance] directly so a replay uses the same fixed timings.

signal state_changed(previous: int, current: int)

enum State { IDLE, PATROL, CHASE, TELEGRAPH, ATTACK, STAGGER, UNSCRAMBLE }

const MIN_TELEGRAPH: float = 0.4
const DEFAULT_PATH: String = "res://data/enemies/muddler_meadow.json"
const MAX_TRANSITIONS_PER_STEP: int = 64
const STATE_NAMES: Array[String] = [
	"idle", "patrol", "chase", "telegraph", "attack", "stagger", "unscramble"
]
const DEFAULT_DURATIONS: Dictionary = {
	State.IDLE: 0.2,
	State.PATROL: 0.6,
	State.CHASE: 0.9,
	State.ATTACK: 0.2,
	State.STAGGER: 0.35,
	State.UNSCRAMBLE: 0.45,
}

@export var data_path: String = DEFAULT_PATH

var archetype_id: String = ""
var biome: String = ""
var hp: int = 1
var max_hp: int = 1
var speed: float = 60.0
var movement_pattern: String = ""
var attack_pattern: String = ""
var telegraph_duration: float = MIN_TELEGRAPH
var declared_states: Array[String] = []
var state: int = State.IDLE
var state_time: float = 0.0


func _ready() -> void:
	apply_config(load_config(data_path))


## Returns the enemy document at [param path], or an empty dictionary.
static func load_config(path: String) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		return parsed as Dictionary
	return {}


## Applies an enemy document, keeping current values for missing or invalid
## fields and clamping the telegraph to [constant MIN_TELEGRAPH].
func apply_config(config: Dictionary) -> void:
	archetype_id = _text(config.get("id"), archetype_id)
	biome = _text(config.get("biome"), biome)
	max_hp = _positive_int(config.get("hp"), max_hp)
	hp = max_hp
	speed = _positive_float(config.get("speed"), speed)
	movement_pattern = _text(config.get("movement"), movement_pattern)
	attack_pattern = _text(config.get("attack"), attack_pattern)
	var telegraph: Variant = config.get("telegraph")
	if telegraph is int or telegraph is float:
		telegraph_duration = maxf(float(telegraph), MIN_TELEGRAPH)
	var states: Variant = config.get("states")
	if states is Array:
		declared_states.clear()
		for state_name: Variant in states:
			if state_name is String:
				declared_states.append(String(state_name))


## Returns the duration in seconds for [param state_id]. The telegraph always
## lasts at least [constant MIN_TELEGRAPH] seconds.
func duration_for(state_id: int) -> float:
	if state_id == State.TELEGRAPH:
		return maxf(telegraph_duration, MIN_TELEGRAPH)
	return float(DEFAULT_DURATIONS.get(state_id, 0.2))


## Returns the state that follows [param current] in the Muddler cycle.
static func next_state(current: int) -> int:
	match current:
		State.IDLE:
			return State.PATROL
		State.PATROL:
			return State.CHASE
		State.CHASE:
			return State.TELEGRAPH
		State.TELEGRAPH:
			return State.ATTACK
		State.ATTACK:
			return State.STAGGER
		State.STAGGER:
			return State.UNSCRAMBLE
		State.UNSCRAMBLE:
			return State.PATROL
		_:
			return State.IDLE


## Advances the brain by [param delta] seconds and returns the current state.
func advance(delta: float) -> int:
	if delta <= 0.0:
		return state
	state_time += delta
	var transitions: int = 0
	while state_time >= duration_for(state) and transitions < MAX_TRANSITIONS_PER_STEP:
		state_time -= duration_for(state)
		_enter(next_state(state))
		transitions += 1
	return state


## Returns true while the attack telegraph is on screen.
func is_telegraphing() -> bool:
	return state == State.TELEGRAPH


## Returns the seconds left in the current telegraph, or zero.
func telegraph_remaining() -> float:
	if not is_telegraphing():
		return 0.0
	return maxf(duration_for(State.TELEGRAPH) - state_time, 0.0)


## Returns to idle with a fresh timer.
func reset() -> void:
	_enter(State.IDLE)


## Returns the lower-case name of [param state_id].
static func state_name(state_id: int) -> String:
	if state_id < 0 or state_id >= STATE_NAMES.size():
		return "unknown"
	return STATE_NAMES[state_id]


func _enter(next: int) -> void:
	var previous: int = state
	state = next
	state_time = 0.0
	state_changed.emit(previous, state)


static func _text(value: Variant, fallback: String) -> String:
	if value is String and not (value as String).is_empty():
		return value as String
	return fallback


static func _positive_int(value: Variant, fallback: int) -> int:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return maxi(int(number), 1)
	return fallback


static func _positive_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return number
	return fallback
