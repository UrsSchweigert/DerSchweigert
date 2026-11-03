class_name TouchControls
extends Control
## A floating stick and action buttons laid out from data/input/actions.json,
## all at or above 48 dp, mirrorable, and reporting into [InputActions].

var actions: InputActions = null
var layout: InputActions.Layout = null
var pixel_scale: float = 1.0

var _stick_pointer: int = -1
var _stick_origin: Vector2 = Vector2.ZERO
var _button_pointer: int = -1
var _button_action: String = ""
var _button_origin: Vector2 = Vector2.ZERO


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	bind(actions)


func bind(target: InputActions) -> void:
	actions = target if target != null else InputActions.new()
	layout = actions.layout
	build()


func set_mirrored(value: bool) -> void:
	layout = actions.layout.mirrored() if value else actions.layout
	build()


func build() -> void:
	for child: Node in get_children():
		remove_child(child)
		child.free()
	if layout == null:
		return
	_add_target("stick", stick_center(), dp(layout.stick_radius_dp) * 2.0)
	for pad: InputActions.Pad in layout.pads:
		_add_target(pad.action, button_center(pad.action), target_size(pad.action))


func dp(value: float) -> float:
	return value * maxf(pixel_scale, 0.0)


func stick_center() -> Vector2:
	var edge: float = dp(layout.stick_margin_dp) + dp(layout.stick_radius_dp)
	var x: float = size.x - edge if layout.stick_side == "right" else edge
	return Vector2(x, size.y - edge)


func button_center(action: String) -> Vector2:
	var pad: InputActions.Pad = layout.pad(action)
	var half: float = dp(pad.size_dp) * 0.5
	var offset: Vector2 = pad.offset_dp * pixel_scale
	var x: float = offset.x + half
	if pad.side == "right":
		x = size.x - offset.x - half
	return Vector2(x, size.y - offset.y - half)


func target_size(action: String) -> float:
	return dp(layout.pad(action).size_dp)


func _gui_input(event: InputEvent) -> void:
	handle_event(event)


func handle_event(event: InputEvent) -> void:
	if actions == null or layout == null:
		return
	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event
		_report(touch.index, touch.position, touch.pressed)
	elif event is InputEventScreenDrag:
		var drag: InputEventScreenDrag = event
		_drag(drag.index, drag.position)
	elif event is InputEventMouseButton:
		var button: InputEventMouseButton = event
		if button.button_index == MOUSE_BUTTON_LEFT:
			_report(0, button.position, button.pressed)
	elif event is InputEventMouseMotion:
		var motion: InputEventMouseMotion = event
		if motion.button_mask & MOUSE_BUTTON_MASK_LEFT:
			_drag(0, motion.position)


func _report(index: int, point: Vector2, pressed: bool) -> void:
	if pressed:
		var action: String = _action_at(point)
		if action != "":
			_button_pointer = index
			_button_action = action
			_button_origin = point
			actions.press(action)
		elif _stick_pointer < 0 and _in_stick(point):
			_stick_pointer = index
			_stick_origin = point if layout.floating_stick else stick_center()
			actions.set_move(Vector2.ZERO)
		return
	if index == _stick_pointer:
		_stick_pointer = -1
		actions.set_move(Vector2.ZERO)
	elif index == _button_pointer:
		actions.swipe(InputActions.direction_name(point - _button_origin))
		actions.release(_button_action)
		_button_pointer = -1
		_button_action = ""


func _drag(index: int, point: Vector2) -> void:
	if index == _stick_pointer:
		var radius: float = maxf(dp(layout.stick_radius_dp), 1.0)
		actions.set_move((point - _stick_origin) / radius)
	elif index == _button_pointer and _button_action == "attack":
		actions.swipe(InputActions.direction_name(point - _button_origin))


func _action_at(point: Vector2) -> String:
	for pad: InputActions.Pad in layout.pads:
		if point.distance_to(button_center(pad.action)) <= dp(pad.size_dp) * 0.5:
			return pad.action
	return ""


func _in_stick(point: Vector2) -> bool:
	if not layout.floating_stick:
		return point.distance_to(stick_center()) <= dp(layout.stick_radius_dp)
	return (point.x < size.x * 0.5) == (layout.stick_side == "left")


func _add_target(target_name: String, center: Vector2, size_px: float) -> void:
	var target: ColorRect = ColorRect.new()
	target.name = target_name.capitalize()
	target.color = Color(1.0, 1.0, 1.0, 0.12)
	target.mouse_filter = Control.MOUSE_FILTER_IGNORE
	target.position = center - Vector2.ONE * size_px * 0.5
	target.size = Vector2.ONE * size_px
	add_child(target)
	var label: Label = Label.new()
	label.text = target_name
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	target.add_child(label)
