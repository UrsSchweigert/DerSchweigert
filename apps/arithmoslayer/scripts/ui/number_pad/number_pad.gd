class_name NumberPad
extends Control
## Thumb-friendly free-entry number pad.
##
## Digits split across the left and right thumbs, with delete and confirm at the
## bottom of each column. Opening the pad slows the world and freezes timers
## through its [TimeControl]; every accepted key emits a haptic and a sound hook
## so the haptics and audio managers can react without reading the pad state.

signal opened
signal closed
signal value_changed(text: String)
signal confirmed(value: int)
signal haptic_requested(kind: String)
signal sound_requested(kind: String)

const DEFAULT_PATH: String = "res://data/input/number_pad.json"
const DEFAULT_MIN_KEY_DP: float = 56.0
const KEY_DELETE: String = "delete"
const KEY_CONFIRM: String = "confirm"
const THUMB_LEFT: String = "left"
const THUMB_RIGHT: String = "right"

var time_control: TimeControl = TimeControl.new()
var min_key_dp: float = DEFAULT_MIN_KEY_DP
var haptic_enabled: bool = true
var sound_enabled: bool = true
var pixel_scale: float = 1.0

var _entry: AnswerMode.NumericEntry = AnswerMode.NumericEntry.new()
var _keys: Array[Dictionary] = []
var _buttons: Dictionary = {}
var _open: bool = false
var _display: Label = null
var _display_panel: ColorRect = null


func _init(path: String = DEFAULT_PATH) -> void:
	apply_config(load_config(path))


func _ready() -> void:
	build()


func _exit_tree() -> void:
	if _open:
		_open = false
		time_control.close()
		Engine.time_scale = time_control.time_scale()


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


func apply_config(config: Dictionary) -> void:
	min_key_dp = maxf(_number(config.get("minKeyDp"), min_key_dp), 0.0)
	haptic_enabled = _bool(config.get("haptic"), haptic_enabled)
	sound_enabled = _bool(config.get("sound"), sound_enabled)
	time_control.apply_config(config)
	_keys.clear()
	var raw_keys: Variant = config.get("keys")
	if raw_keys is Array:
		for key_value: Variant in raw_keys:
			if key_value is Dictionary:
				_keys.append(key_value as Dictionary)


func open() -> void:
	if _open:
		return
	_open = true
	_entry.clear()
	_update_display()
	time_control.open()
	Engine.time_scale = time_control.time_scale()
	opened.emit()


func close() -> void:
	if not _open:
		return
	_open = false
	time_control.close()
	Engine.time_scale = time_control.time_scale()
	closed.emit()


func is_open() -> bool:
	return _open


## Handles one pad key by id: a digit appends, delete removes, confirm submits.
## Returns whether the input was accepted; non-numeric ids are rejected.
func press(id: String) -> bool:
	if id == KEY_DELETE:
		return _delete()
	if id == KEY_CONFIRM:
		return _confirm()
	if _is_digit(id):
		return _push(id)
	return false


## Feeds raw text entry; only single decimal digits are accepted.
func type(text: String) -> bool:
	return _push(text) if _is_digit(text) else false


func display_text() -> String:
	return _entry.text()


func value() -> int:
	return _entry.confirm()


## Rebuilds the greybox keys from the loaded layout; clears any previous build.
func build() -> void:
	for child: Node in get_children():
		remove_child(child)
		child.free()
	_buttons.clear()
	_build_display()
	for key: Dictionary in _keys:
		var id: String = String(key.get("id", ""))
		var button: Button = _make_key(id, key_label(id))
		_buttons[id] = button
		add_child(button)
		button.pressed.connect(_on_key_pressed.bind(id))


## Every key is at least [member min_key_dp] device pixels on a side.
func key_size() -> float:
	return dp(min_key_dp)


func dp(value: float) -> float:
	return value * maxf(pixel_scale, 0.0)


func key_ids() -> Array[String]:
	var ids: Array[String] = []
	for key: Dictionary in _keys:
		ids.append(String(key.get("id", "")))
	return ids


func key_label(id: String) -> String:
	for key: Dictionary in _keys:
		if String(key.get("id", "")) == id:
			return String(key.get("label", id))
	return ""


## The thumb half a key lives on: [constant THUMB_LEFT] or [constant THUMB_RIGHT].
func key_thumb(id: String) -> String:
	for key: Dictionary in _keys:
		if String(key.get("id", "")) == id:
			var thumb: String = String(key.get("thumb", THUMB_RIGHT))
			return thumb if thumb == THUMB_LEFT else THUMB_RIGHT
	return THUMB_RIGHT


## The center of one key, laid out in two thumb columns.
func key_center(id: String) -> Vector2:
	var side: Array[String] = _side_ids(key_thumb(id))
	var index: int = side.find(id)
	if index < 0:
		return Vector2.ZERO
	var fraction: float = float(index + 1) / float(side.size() + 1)
	var x: float = size.x * 0.25 if key_thumb(id) == THUMB_LEFT else size.x * 0.75
	return Vector2(x, size.y * fraction)


func _side_ids(thumb: String) -> Array[String]:
	var ids: Array[String] = []
	for key: Dictionary in _keys:
		if key_thumb(String(key.get("id", ""))) == thumb:
			ids.append(String(key.get("id", "")))
	return ids


func _make_key(id: String, label_text: String) -> Button:
	var button: Button = Button.new()
	button.name = "Key" + id.capitalize()
	var size_px: float = key_size()
	button.size = Vector2.ONE * size_px
	button.position = key_center(id) - Vector2.ONE * size_px * 0.5
	button.text = label_text
	button.focus_mode = Control.FOCUS_NONE
	return button


func _build_display() -> void:
	_display_panel = ColorRect.new()
	_display_panel.name = "Display"
	_display_panel.color = Color(0.0, 0.0, 0.0, 0.35)
	var panel_width: float = maxf(size.x * 0.5, key_size() * 3.0)
	_display_panel.size = Vector2(panel_width, key_size() * 0.75)
	_display_panel.position = Vector2((size.x - panel_width) * 0.5, size.y * 0.08)
	add_child(_display_panel)
	_display = Label.new()
	_display.name = "DisplayLabel"
	_display.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_display.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_display.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_display_panel.add_child(_display)
	_update_display()


func _update_display() -> void:
	if _display != null:
		_display.text = display_text()


func _on_key_pressed(id: String) -> void:
	press(id)


func _push(character: String) -> bool:
	if not _entry.push(character):
		return false
	_update_display()
	value_changed.emit(display_text())
	_haptic("digit")
	_sound("digit")
	return true


func _delete() -> bool:
	if not _entry.delete():
		return false
	_update_display()
	value_changed.emit(display_text())
	_haptic(KEY_DELETE)
	_sound(KEY_DELETE)
	return true


func _confirm() -> bool:
	if _entry.is_empty():
		return false
	var submitted: int = _entry.confirm()
	_entry.clear()
	_update_display()
	value_changed.emit(display_text())
	_haptic(KEY_CONFIRM)
	_sound(KEY_CONFIRM)
	confirmed.emit(submitted)
	return true


func _haptic(kind: String) -> void:
	if haptic_enabled:
		haptic_requested.emit(kind)


func _sound(kind: String) -> void:
	if sound_enabled:
		sound_requested.emit(kind)


static func _is_digit(character: String) -> bool:
	return (
		character.length() == 1 and character.unicode_at(0) >= 48 and character.unicode_at(0) <= 57
	)


static func _number(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if is_finite(number) else fallback


static func _bool(value: Variant, fallback: bool) -> bool:
	return bool(value) if value is bool else fallback
