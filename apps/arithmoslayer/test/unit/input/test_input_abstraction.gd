extends GutTest
## Guards the one input abstraction, the touch layout, and assist mode.

const LAYOUT_PATH: String = "res://data/input/actions.json"
const ASSIST_PATH: String = "res://data/combat/assist.json"
const ARENA_PATH: String = "res://scenes/combat/arena.tscn"
const WEAPON_PATH: String = "res://data/weapons/glaive.json"
const SCREEN: Vector2 = Vector2(1152.0, 648.0)
const EPSILON: float = 0.001


func after_each() -> void:
	GameState.reset()


func test_layout_is_mirrorable_and_keeps_48_dp_targets() -> void:
	var layout: InputActions.Layout = InputActions.load_layout(LAYOUT_PATH)
	assert_true(layout.errors.is_empty(), "actions.json must be valid")
	assert_true(layout.min_target_dp >= InputActions.MIN_TARGET_DP, "targets must be 48 dp")
	var flipped: InputActions.Layout = layout.mirrored()
	var other: String = InputActions.Layout.opposite(layout.stick_side)
	assert_eq(flipped.stick_side, other, "the stick must swap sides")
	for action: String in InputActions.ACTIONS:
		var pad: InputActions.Pad = layout.pad(action)
		assert_eq(pad.action, action, "every action needs a button")
		assert_ne(pad.side, layout.stick_side, "%s must not sit under the stick" % action)
		assert_true(pad.size_dp >= layout.min_target_dp, "%s must be at least 48 dp" % action)
		assert_eq(flipped.pad(action).side, InputActions.Layout.opposite(pad.side), "swap sides")
		assert_false(
			(layout.keyboard.get(action, []) as Array).is_empty(), "%s needs keys" % action
		)
		assert_false(
			(layout.gamepad.get(action, []) as Array).is_empty(), "%s needs a button" % action
		)


func test_keyboard_and_gamepad_share_the_touch_abstraction() -> void:
	var actions: InputActions = InputActions.new()
	var keys: GamepadKeyboard = GamepadKeyboard.new()
	keys.actions = actions
	add_child_autofree(keys)
	keys.poll_state({"j": true}, {}, Vector2.ZERO)
	assert_true(actions.is_down("attack"), "the keyboard must press the shared action")
	keys.poll_state({}, {}, Vector2.ZERO)
	assert_false(actions.is_down("attack"))
	keys.poll_state({}, {"x": true}, Vector2.ZERO)
	assert_true(actions.is_down("attack"), "the gamepad must press the same action")
	keys.poll_state({"d": true}, {}, Vector2.ZERO)
	_assert_vector(actions.move, Vector2.RIGHT, "the keyboard must move")
	keys.poll_state({}, {}, Vector2(0.0, 1.0))
	_assert_vector(actions.move, Vector2.DOWN, "the stick must move")


func test_touch_scene_is_mirrorable_and_reports_gestures() -> void:
	var touch: TouchControls = _touch()
	for action: String in InputActions.ACTIONS:
		assert_true(touch.target_size(action) >= InputActions.MIN_TARGET_DP, "%s dp" % action)
	assert_true(touch.button_center("attack").x > SCREEN.x * 0.5, "buttons start on the right")
	touch.set_mirrored(true)
	assert_true(touch.button_center("attack").x < SCREEN.x * 0.5, "mirroring moves buttons left")
	assert_true(touch.stick_center().x > SCREEN.x * 0.5, "mirroring moves the stick right")
	touch.set_mirrored(false)
	watch_signals(touch.actions)
	var point: Vector2 = touch.button_center("attack")
	_touch_event(touch, point, true)
	assert_true(touch.actions.is_down("attack"), "the attack button must press")
	_touch_event(touch, point, false)
	assert_signal_emit_count(touch.actions, "action_pressed", 1, "one tap is one event")
	_touch_event(touch, point, true)
	touch.actions.advance(touch.layout.hold_seconds + EPSILON)
	assert_signal_emit_count(touch.actions, "action_pressed", 2, "one hold is one event")
	_touch_event(touch, point, false)
	_touch_event(touch, point, true)
	var flick: Vector2 = point + Vector2(touch.dp(touch.layout.swipe_threshold_dp) + 8.0, 0.0)
	_drag_event(touch, flick)
	_touch_event(touch, flick, false)
	assert_eq(touch.actions.last_gesture(), InputActions.SWIPE, "a flick is a swipe")
	assert_eq(touch.actions.last_direction(), "right")
	assert_signal_emit_count(touch.actions, "action_pressed", 3, "one swipe is one event")
	var origin: Vector2 = Vector2(80.0, SCREEN.y * 0.5)
	_touch_event(touch, origin, true)
	_drag_event(touch, origin + Vector2(touch.dp(touch.layout.stick_radius_dp), 0.0))
	_assert_vector(touch.actions.move, Vector2.RIGHT, "the stick must move right")
	_touch_event(touch, origin, false)
	_assert_vector(touch.actions.move, Vector2.ZERO, "release must stop the move")


func test_arena_shares_one_abstraction_with_every_device() -> void:
	var arena: Arena = (load(ARENA_PATH) as PackedScene).instantiate() as Arena
	add_child_autofree(arena)
	assert_eq(arena.gamepad_keyboard.actions, arena.actions, "keyboard shares the actions")
	assert_eq(arena.touch_controls.actions, arena.actions, "touch shares the actions")
	assert_eq(arena.player.actions, arena.actions, "the hero reads the actions")
	assert_true(arena.actions.press("dodge"), "a dodge arrives as an action")
	assert_true(arena.dodge.is_rolling(), "the arena rolls on the shared action")


func test_assist_aims_simplifies_and_never_cuts_rewards() -> void:
	var config: Dictionary = AssistMode.load_config(ASSIST_PATH)
	assert_eq(int(config.get("version", 0)), 1, "assist.json must declare version 1")
	var assist: AssistMode = AssistMode.new()
	assert_eq(assist.display_name, "Assist", "assist is a play style")
	assert_false(assist.enabled, "assist is off until a profile enables it")
	assert_true(assist.timers_enabled(), "the base game keeps its timers")
	assert_almost_eq(assist.enemy_speed_scale(), 1.0, EPSILON, "base enemy speed")
	var orbs: Array[Vector2] = [Vector2(500.0, 0.0), Vector2(60.0, 0.0), Vector2(0.0, 90.0)]
	assert_eq(assist.target_index(Vector2.ZERO, orbs), -1, "no targeting without assist")
	assist.set_enabled(true)
	assert_false(assist.timers_enabled(), "assist removes timers")
	assert_true(assist.enemy_speed_scale() < 1.0, "assist slows enemies")
	assert_almost_eq(assist.reward_scale(), 1.0, EPSILON, "assist never cuts rewards")
	assert_eq(assist.target_index(Vector2.ZERO, orbs), 1, "the nearest orb wins")
	_assert_vector(assist.aim_direction(Vector2.ZERO, orbs), Vector2.RIGHT, "aim at the orb")
	var far: Array[Vector2] = [Vector2(assist.auto_target_radius + 10.0, 0.0)]
	assert_eq(assist.target_index(Vector2.ZERO, far), -1, "out of range orbs are ignored")
	var weapon: WeaponDefinition = WeaponDefinition.load_file(WEAPON_PATH)
	for step: WeaponDefinition.Step in weapon.steps:
		assert_eq(assist.input_for(step)["kind"], InputActions.TAP, "assist needs one tap")
		assert_eq(assist.input_for(step)["direction"], "", "assist needs no direction")
	var saved: Dictionary = assist.write_profile({"name": "Ada"})
	assert_eq(saved["assistMode"], true, "the profile stores the option")
	var loaded: AssistMode = AssistMode.new()
	loaded.apply_profile(saved)
	assert_true(loaded.enabled, "the profile restores the option")
	assert_false(AssistMode.new().enabled, "an empty profile starts without assist")


func _touch() -> TouchControls:
	var touch: TouchControls = TouchControls.new()
	add_child_autofree(touch)
	touch.set_anchors_preset(Control.PRESET_TOP_LEFT)
	touch.size = SCREEN
	touch.build()
	return touch


func _touch_event(touch: TouchControls, point: Vector2, pressed: bool) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = 0
	event.position = point
	event.pressed = pressed
	touch.handle_event(event)


func _drag_event(touch: TouchControls, point: Vector2) -> void:
	var event: InputEventScreenDrag = InputEventScreenDrag.new()
	event.index = 0
	event.position = point
	touch.handle_event(event)


func _assert_vector(actual: Vector2, expected: Vector2, message: String) -> void:
	assert_almost_eq(actual.x, expected.x, EPSILON, "%s (x)" % message)
	assert_almost_eq(actual.y, expected.y, EPSILON, "%s (y)" % message)
