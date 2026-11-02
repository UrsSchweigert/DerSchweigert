class_name WeaponDefinition
extends RefCounted
## A data-only weapon: an ordered combo graph with typed frame data.
##
## [method load_file] parses a weapon JSON document and rejects every field the
## schema does not declare. [ComboEngine] reads the typed [Step] objects below,
## so adding a weapon is a data-only change under [code]data/weapons/[/code].

const DOCUMENT_FIELDS: Array[String] = ["version", "id", "inputBufferFrames", "steps"]
const STEP_FIELDS: Array[String] = ["id", "input", "frames", "hitbox", "cancel", "orb"]
const STEP_HOOKS: Array[String] = ["impulse", "knockback", "effects", "sounds", "finisher"]
const INPUT_FIELDS: Array[String] = ["kind", "direction", "touches"]
const INPUT_TIMING: Array[String] = ["holdFrames", "chargeFrames", "rhythmBeats"]
const FRAME_FIELDS: Array[String] = ["startup", "active", "recovery"]
const HITBOX_FIELDS: Array[String] = ["shape", "size"]
const CANCEL_FIELDS: Array[String] = ["startFrame", "endFrame", "into"]
const INPUT_KINDS: Array[String] = ["tap", "hold", "charge", "swipe", "rhythm"]


## One ordered combo step with every number the engine needs.
class Step:
	extends RefCounted
	var id: String = ""
	var input_kind: String = ""
	var input_direction: String = ""
	var input_touches: int = 1
	var hold_frames: int = 0
	var charge_frames: int = 0
	var rhythm_beats: int = 0
	var startup: int = 0
	var active: int = 0
	var recovery: int = 0
	var hitbox_shape: String = ""
	var hitbox_size: Vector2 = Vector2.ZERO
	var impulse: Vector2 = Vector2.ZERO
	var knockback: float = 0.0
	var cancel_start: int = 0
	var cancel_end: int = 0
	var cancel_into: Array[String] = []
	var orb: String = ""
	var effects: Array[String] = []
	var sounds: Array[String] = []
	var finisher: bool = false

	func total_frames() -> int:
		return startup + active + recovery


var version: int = 1
var id: String = ""
var input_buffer_frames: int = 6
var steps: Array[Step] = []
var errors: Array[String] = []


## Loads [param path], reporting a missing or malformed file in [member errors].
static func load_file(path: String) -> WeaponDefinition:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(file.get_as_text()) if file != null else null
	if not (parsed is Dictionary):
		var missing: WeaponDefinition = WeaponDefinition.new()
		missing.errors.append("%s: weapon must be a readable JSON object" % path)
		return missing
	return from_dictionary(parsed as Dictionary)


## Builds a definition from an already decoded weapon [param data].
static func from_dictionary(data: Dictionary) -> WeaponDefinition:
	var definition: WeaponDefinition = WeaponDefinition.new()
	definition._read(data)
	return definition


## Returns whether the document loaded without a schema error.
func is_valid() -> bool:
	return errors.is_empty()


## Returns the ordered step ids.
func step_ids() -> Array[String]:
	var ids: Array[String] = []
	for entry: Step in steps:
		ids.append(entry.id)
	return ids


## Returns the step with [param step_id], or an empty step when it is absent.
func step(step_id: String) -> Step:
	for entry: Step in steps:
		if entry.id == step_id:
			return entry
	return Step.new()


## Returns the id after [param step_id] in the ordered graph, or an empty string.
func step_after(step_id: String) -> String:
	var ids: Array[String] = step_ids()
	var index: int = ids.find(step_id)
	return ids[index + 1] if index >= 0 and index + 1 < ids.size() else ""


## Returns whether [param step_id] ends the combo.
func is_finisher(step_id: String) -> bool:
	return step(step_id).finisher


func _read(data: Dictionary) -> void:
	errors.clear()
	_reject_unknown(data, DOCUMENT_FIELDS, "weapon")
	version = _int(data, "version", 0)
	id = _string(data, "id")
	input_buffer_frames = _int(data, "inputBufferFrames", 0)
	steps.clear()
	var raw_steps: Variant = data.get("steps", [])
	for raw: Variant in raw_steps if raw_steps is Array else []:
		if raw is Dictionary:
			steps.append(_read_step(raw as Dictionary))
	if version != 1:
		errors.append("version must be 1")
	if id.is_empty():
		errors.append("id must be a non-empty string")
	if input_buffer_frames <= 0:
		errors.append("inputBufferFrames must be positive")
	if steps.is_empty():
		errors.append("steps must not be empty")


func _read_step(raw: Dictionary) -> Step:
	var step: Step = Step.new()
	step.id = _string(raw, "id")
	_reject_unknown(raw, STEP_FIELDS + STEP_HOOKS, "step '%s'" % step.id)
	var input: Dictionary = _nested(raw, "input")
	var frames: Dictionary = _nested(raw, "frames")
	var hitbox: Dictionary = _nested(raw, "hitbox")
	var cancel: Dictionary = _nested(raw, "cancel")
	_reject_unknown(input, INPUT_FIELDS + INPUT_TIMING, "step '%s' input" % step.id)
	_reject_unknown(frames, FRAME_FIELDS, "step '%s' frames" % step.id)
	_reject_unknown(hitbox, HITBOX_FIELDS, "step '%s' hitbox" % step.id)
	_reject_unknown(cancel, CANCEL_FIELDS, "step '%s' cancel" % step.id)
	step.input_kind = _string(input, "kind")
	step.input_direction = _string(input, "direction")
	step.input_touches = _int(input, "touches", 1)
	step.hold_frames = _int(input, "holdFrames", 0)
	step.charge_frames = _int(input, "chargeFrames", 0)
	step.rhythm_beats = _int(input, "rhythmBeats", 0)
	step.startup = _int(frames, "startup", 0)
	step.active = _int(frames, "active", 0)
	step.recovery = _int(frames, "recovery", 0)
	step.hitbox_shape = _string(hitbox, "shape")
	step.hitbox_size = _vector(hitbox.get("size"))
	step.impulse = _vector(raw.get("impulse"))
	step.knockback = float(raw.get("knockback", 0.0))
	step.cancel_start = _int(cancel, "startFrame", 0)
	step.cancel_end = _int(cancel, "endFrame", 0)
	step.cancel_into = _strings(cancel.get("into"))
	step.orb = _string(raw, "orb")
	step.effects = _strings(raw.get("effects"))
	step.sounds = _strings(raw.get("sounds"))
	step.finisher = bool(raw.get("finisher", false))
	if step.id.is_empty():
		errors.append("step %d needs a non-empty id" % steps.size())
	elif step_ids().count(step.id) > 0:
		errors.append("duplicate step id '%s'" % step.id)
	if not INPUT_KINDS.has(step.input_kind):
		errors.append("step '%s': unknown input kind '%s'" % [step.id, step.input_kind])
	return step


func _reject_unknown(data: Dictionary, allowed: Array[String], context: String) -> void:
	for field: Variant in data:
		if not allowed.has(String(field)):
			errors.append("%s: unknown field '%s'" % [context, String(field)])


func _nested(step: Dictionary, name: String) -> Dictionary:
	var value: Variant = step.get(name, {})
	return value if value is Dictionary else {}


func _string(data: Dictionary, key: String) -> String:
	var value: Variant = data.get(key, "")
	return String(value) if value is String else ""


func _int(data: Dictionary, key: String, fallback: int) -> int:
	var value: Variant = data.get(key, fallback)
	return int(value) if value is int or value is float else fallback


func _vector(value: Variant) -> Vector2:
	if value is Array and (value as Array).size() >= 2:
		var values: Array = value as Array
		return Vector2(float(values[0]), float(values[1]))
	return Vector2.ZERO


func _strings(value: Variant) -> Array[String]:
	var strings: Array[String] = []
	for item: Variant in value if value is Array else []:
		strings.append(String(item))
	return strings
