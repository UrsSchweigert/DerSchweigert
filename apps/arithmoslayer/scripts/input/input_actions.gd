class_name InputActions
extends RefCounted
## One input abstraction shared by touch, gamepad, and keyboard.
## Devices report presses, releases, and a move vector; gameplay listens here.

signal action_pressed(action: String, gesture: String, direction: String)
signal action_released(action: String)
signal move_changed(vector: Vector2)

const DEFAULT_LAYOUT_PATH: String = "res://data/input/actions.json"
const MIN_TARGET_DP: float = 48.0
const TAP: String = "tap"
const HOLD: String = "hold"
const SWIPE: String = "swipe"
const ACTIONS: Array[String] = ["attack", "dodge", "swap", "special"]
const DIRECTIONS: Array[String] = ["up", "down", "left", "right"]
const SIDES: Array[String] = ["left", "right"]
const DEADZONE: float = 0.2


class Pad:
	extends RefCounted
	var action: String = ""
	var side: String = "right"
	var size_dp: float = 48.0
	var offset_dp: Vector2 = Vector2.ZERO


class Layout:
	extends RefCounted
	var source_path: String = ""
	var min_target_dp: float = 48.0
	var hold_seconds: float = 0.25
	var swipe_threshold_dp: float = 24.0
	var stick_side: String = "left"
	var stick_radius_dp: float = 72.0
	var stick_margin_dp: float = 24.0
	var stick_deadzone: float = 0.2
	var floating_stick: bool = true
	var pads: Array[Pad] = []
	var keyboard: Dictionary = {}
	var gamepad: Dictionary = {}
	var errors: Array[String] = []

	func pad(action: String) -> Pad:
		for entry: Pad in pads:
			if entry.action == action:
				return entry
		return Pad.new()

	## Returns a copy whose stick and buttons swap sides.
	func mirrored() -> Layout:
		return InputActions.load_layout(source_path, true)

	static func opposite(side: String) -> String:
		return "right" if side == "left" else "left"


var layout: Layout = Layout.new()
var move: Vector2 = Vector2.ZERO

var _moves: Dictionary = {}
var _down: Dictionary = {}
var _held: Dictionary = {}
var _resolved: Dictionary = {}
var _last_gesture: String = ""
var _last_direction: String = ""


func _init(path: String = DEFAULT_LAYOUT_PATH) -> void:
	layout = load_layout(path)


static func load_layout(path: String = DEFAULT_LAYOUT_PATH, mirror: bool = false) -> Layout:
	var layout: Layout = Layout.new()
	layout.source_path = path
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(file.get_as_text()) if file != null else null
	if not (parsed is Dictionary):
		layout.errors.append("%s: layout must be a JSON object" % path)
		return layout
	var data: Dictionary = parsed as Dictionary
	if _number(data.get("version"), 0.0) != 1.0:
		layout.errors.append("version must be 1")
	layout.min_target_dp = _number(data.get("minTargetDp"), layout.min_target_dp)
	layout.hold_seconds = _number(data.get("holdSeconds"), layout.hold_seconds)
	layout.swipe_threshold_dp = _number(data.get("swipeThresholdDp"), layout.swipe_threshold_dp)
	var stick: Variant = data.get("stick", {})
	var stick_data: Dictionary = stick if stick is Dictionary else {}
	layout.stick_side = _side(stick_data.get("side"), layout.stick_side)
	layout.stick_radius_dp = _number(stick_data.get("radiusDp"), layout.stick_radius_dp)
	layout.stick_margin_dp = _number(stick_data.get("marginDp"), layout.stick_margin_dp)
	layout.stick_deadzone = _number(stick_data.get("deadzone"), layout.stick_deadzone)
	layout.floating_stick = bool(stick_data.get("floating", layout.floating_stick))
	var pads: Variant = data.get("buttons", [])
	for raw: Variant in pads if pads is Array else []:
		if raw is Dictionary:
			layout.pads.append(_read_pad(raw as Dictionary))
	layout.keyboard = _bindings(data.get("keyboard"))
	layout.gamepad = _bindings(data.get("gamepad"))
	if mirror:
		layout.stick_side = Layout.opposite(layout.stick_side)
		for entry: Pad in layout.pads:
			entry.side = Layout.opposite(entry.side)
	_validate(layout)
	return layout


## An attack waits for one gesture: a direction swipes, a hold holds, a release taps.
func press(action: String, direction: String = "") -> bool:
	if not ACTIONS.has(action) or _down.has(action):
		return false
	_down[action] = true
	_held[action] = 0.0
	_resolved[action] = false
	if action != "attack":
		action_pressed.emit(action, TAP, "")
	elif DIRECTIONS.has(direction):
		_resolve_attack(SWIPE, direction)
	return true


## A short attack resolves as a tap.
func release(action: String) -> bool:
	if not _down.has(action):
		return false
	_down.erase(action)
	_held.erase(action)
	if action == "attack" and not bool(_resolved.get(action, false)):
		_resolve_attack(TAP, "")
	action_released.emit(action)
	_resolved.erase(action)
	return true


func swipe(direction: String) -> bool:
	if not _down.has("attack") or bool(_resolved.get("attack", false)):
		return false
	if not DIRECTIONS.has(direction):
		return false
	_resolve_attack(SWIPE, direction)
	return true


## Resolves a held attack as a hold after the data-defined delay.
func advance(delta: float) -> void:
	if not is_down("attack") or bool(_resolved.get("attack", false)):
		return
	_held["attack"] = float(_held.get("attack", 0.0)) + maxf(delta, 0.0)
	if float(_held["attack"]) >= layout.hold_seconds:
		_resolve_attack(HOLD, "")


## Sets the move vector of one device; devices never overwrite each other.
func set_move(vector: Vector2, source: String = "touch") -> void:
	_moves[source] = vector.limit_length(1.0)
	var combined: Vector2 = Vector2.ZERO
	for candidate: Vector2 in _moves.values():
		if candidate.length() > combined.length():
			combined = candidate
	combined = MoveInput.eight_way(combined, layout.stick_deadzone)
	if combined.is_equal_approx(move):
		return
	move = combined
	move_changed.emit(move)


func is_down(action: String) -> bool:
	return _down.has(action)


func last_gesture() -> String:
	return _last_gesture


func last_direction() -> String:
	return _last_direction


static func direction_name(vector: Vector2) -> String:
	if vector.length() <= DEADZONE:
		return ""
	if absf(vector.x) > absf(vector.y):
		return "right" if vector.x > 0.0 else "left"
	return "down" if vector.y > 0.0 else "up"


func _resolve_attack(gesture: String, direction: String) -> void:
	_resolved["attack"] = true
	_last_gesture = gesture
	_last_direction = direction
	action_pressed.emit("attack", gesture, direction)


static func _read_pad(raw: Dictionary) -> Pad:
	var pad: Pad = Pad.new()
	pad.action = raw.get("action") if raw.get("action") is String else ""
	pad.side = _side(raw.get("side"), pad.side)
	pad.size_dp = _number(raw.get("sizeDp"), pad.size_dp)
	pad.offset_dp = _vector(raw.get("offsetDp"))
	return pad


static func _validate(layout: Layout) -> void:
	if layout.min_target_dp < MIN_TARGET_DP:
		layout.errors.append("minTargetDp must be at least %d" % int(MIN_TARGET_DP))
	if not SIDES.has(layout.stick_side):
		layout.errors.append("stick.side must be left or right")
	for action: String in ACTIONS:
		var pad: Pad = layout.pad(action)
		if pad.action.is_empty():
			layout.errors.append("missing button for '%s'" % action)
		elif pad.size_dp < layout.min_target_dp:
			layout.errors.append("button '%s' is under %d dp" % [action, int(layout.min_target_dp)])
		if _binding(layout.keyboard, action).is_empty():
			layout.errors.append("keyboard binding for '%s' is empty" % action)
		if _binding(layout.gamepad, action).is_empty():
			layout.errors.append("gamepad binding for '%s' is empty" % action)


static func _bindings(value: Variant) -> Dictionary:
	return value if value is Dictionary else {}


static func _binding(bindings: Dictionary, key: String) -> Array:
	var value: Variant = bindings.get(key, [])
	return value if value is Array else []


static func _side(value: Variant, fallback: String) -> String:
	var side: String = value if value is String else ""
	return side if SIDES.has(side) else fallback


static func _number(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if is_finite(number) else fallback


static func _vector(value: Variant) -> Vector2:
	if not (value is Array and (value as Array).size() >= 2):
		return Vector2.ZERO
	var values: Array = value as Array
	return Vector2(float(values[0]), float(values[1]))
