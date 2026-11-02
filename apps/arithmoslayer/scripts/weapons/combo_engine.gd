class_name ComboEngine
extends RefCounted
## Fixed-timestep combo state machine driven by a [WeaponDefinition].
##
## Inputs are buffered, a cancel window can jump to a declared target step, a
## step advances only after [method confirm_hit] lands during its active frames,
## and the finisher ends the combo. [method tick] advances one fixed frame.

signal step_started(step_id: String)
signal combo_finished

enum State { IDLE, ACTIVE, FINISHED }

const MAX_TOUCHES: int = 2
const DEFAULT_BUFFER_FRAMES: int = 6

var weapon: WeaponDefinition
var buffer_frames: int = DEFAULT_BUFFER_FRAMES
var state: State = State.IDLE
var step_id: String = ""
var frame: int = 0
var hit_confirmed: bool = false

var _buffer: Array[Dictionary] = []
var _accumulator: float = 0.0


func _init(definition: WeaponDefinition, buffer: int = -1) -> void:
	weapon = definition
	if buffer > 0:
		buffer_frames = buffer
	elif definition != null and definition.input_buffer_frames > 0:
		buffer_frames = definition.input_buffer_frames


## Starts the combo on the first step, or returns false for an invalid weapon.
func start() -> bool:
	_buffer.clear()
	_accumulator = 0.0
	hit_confirmed = false
	if weapon == null or not weapon.is_valid() or weapon.steps.is_empty():
		state = State.IDLE
		return false
	state = State.ACTIVE
	_begin_step(weapon.step_ids()[0])
	return true


## Advances exactly one fixed frame.
func tick() -> void:
	if state != State.ACTIVE:
		return
	_age_buffer()
	frame += 1
	if _consume_cancel():
		return
	if frame >= weapon.step(step_id).total_frames():
		_finish_step()


## Consumes whole [constant Timestep.FIXED_DELTA] frames from [param delta].
func advance(delta: float) -> void:
	_accumulator += maxf(delta, 0.0)
	while _accumulator >= Timestep.FIXED_DELTA:
		_accumulator -= Timestep.FIXED_DELTA
		tick()


## Buffers an input, returning false when the two-touch limit is reached.
func push_input(kind: String, direction: String = "") -> bool:
	if state != State.ACTIVE or _buffer.size() >= MAX_TOUCHES:
		return false
	_buffer.append({"kind": kind, "direction": direction, "age": 0})
	return true


## Confirms a hit during the current step's active frames.
func confirm_hit() -> bool:
	if state != State.ACTIVE:
		return false
	var step: WeaponDefinition.Step = weapon.step(step_id)
	if frame < step.startup or frame >= step.startup + step.active:
		return false
	hit_confirmed = true
	return true


## Cancels the active step without completing the combo, used by a dodge roll.
## Returns true when a step was interrupted.
func cancel() -> bool:
	if state != State.ACTIVE:
		return false
	state = State.IDLE
	step_id = ""
	frame = 0
	hit_confirmed = false
	_buffer.clear()
	_accumulator = 0.0
	return true


## Returns how many inputs are waiting in the buffer.
func buffered_count() -> int:
	return _buffer.size()


## Returns the current step.
func current_step() -> WeaponDefinition.Step:
	return weapon.step(step_id)


## Returns the touches [param step] needs, capped at [constant MAX_TOUCHES].
static func required_touches(step: WeaponDefinition.Step) -> int:
	return clampi(step.input_touches, 1, MAX_TOUCHES)


func _begin_step(target_id: String) -> void:
	step_id = target_id
	frame = 0
	hit_confirmed = false
	step_started.emit(step_id)


func _finish_step() -> void:
	if weapon.is_finisher(step_id):
		state = State.FINISHED
		combo_finished.emit()
		return
	var next_step: String = weapon.step_after(step_id)
	_begin_step(next_step if next_step != "" and hit_confirmed else weapon.step_ids()[0])


func _consume_cancel() -> bool:
	var step: WeaponDefinition.Step = weapon.step(step_id)
	if frame < step.cancel_start or frame >= step.cancel_end:
		return false
	for target: String in step.cancel_into:
		var index: int = _matching_entry(target)
		if index >= 0:
			_buffer.remove_at(index)
			_begin_step(target)
			return true
	return false


func _matching_entry(target_id: String) -> int:
	for index: int in _buffer.size():
		if _matches(target_id, _buffer[index]):
			return index
	return -1


func _matches(target_id: String, entry: Dictionary) -> bool:
	var target: WeaponDefinition.Step = weapon.step(target_id)
	if target.id.is_empty() or target.input_kind != String(entry.get("kind", "")):
		return false
	return (
		target.input_direction.is_empty()
		or target.input_direction == String(entry.get("direction", ""))
	)


func _age_buffer() -> void:
	for entry: Dictionary in _buffer:
		entry["age"] = int(entry.get("age", 0)) + 1
	_buffer = _buffer.filter(
		func(entry: Dictionary) -> bool: return int(entry["age"]) <= buffer_frames
	)
