class_name GamepadKeyboard
extends Node
## Feeds keyboard and gamepad into the shared [InputActions] abstraction, so
## gameplay listens to [InputActions] only. Tests drive [method poll_state].

const JOY_BUTTONS: Dictionary = {
	"a": JOY_BUTTON_A, "b": JOY_BUTTON_B, "x": JOY_BUTTON_X, "y": JOY_BUTTON_Y
}

var actions: InputActions = null


func _process(delta: float) -> void:
	poll(delta)


func poll(delta: float = 0.0) -> void:
	if actions == null:
		return
	var keys: Dictionary = {}
	for name: String in _names(actions.layout.keyboard):
		if Input.is_physical_key_pressed(OS.find_keycode_from_string(name.capitalize())):
			keys[name] = true
	var buttons: Dictionary = {}
	for name: String in _names(actions.layout.gamepad):
		if Input.is_joy_button_pressed(0, JOY_BUTTONS.get(name, JOY_BUTTON_INVALID)):
			buttons[name] = true
	var stick: Vector2 = Vector2(
		Input.get_joy_axis(0, JOY_AXIS_LEFT_X), Input.get_joy_axis(0, JOY_AXIS_LEFT_Y)
	)
	poll_state(keys, buttons, stick, delta)


static func _names(bindings: Dictionary) -> Array:
	var names: Array = []
	for value: Variant in bindings.values():
		for name: Variant in value if value is Array else []:
			if not names.has(name):
				names.append(name)
	return names


## Feeds one device state in; keys and buttons map binding names to pressed.
func poll_state(keys: Dictionary, buttons: Dictionary, stick: Vector2, delta: float = 0.0) -> void:
	if actions == null:
		return
	var move: Vector2 = MoveInput.combine(
		_keyboard_move(keys), MoveInput.stick_vector(stick), Vector2.ZERO
	)
	actions.set_move(move, "keyboard")
	for action: String in InputActions.ACTIONS:
		var held: bool = _down(action, buttons, actions.layout.gamepad)
		held = held or _down(action, keys, actions.layout.keyboard)
		if held:
			actions.press(action, InputActions.direction_name(actions.move))
		else:
			actions.release(action)
	actions.advance(delta)


func _keyboard_move(keys: Dictionary) -> Vector2:
	var bindings: Dictionary = actions.layout.keyboard
	return MoveInput.keyboard_vector(
		_down("moveLeft", keys, bindings),
		_down("moveRight", keys, bindings),
		_down("moveUp", keys, bindings),
		_down("moveDown", keys, bindings)
	)


func _down(key: String, state: Dictionary, bindings: Dictionary) -> bool:
	var names: Variant = bindings.get(key, [])
	for name: Variant in names if names is Array else []:
		if bool(state.get(String(name), false)):
			return true
	return false
