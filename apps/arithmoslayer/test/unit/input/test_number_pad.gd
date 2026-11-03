extends GutTest
## Guards the free-entry number pad, its time control, and its input validation.

const DATA_PATH: String = "res://data/input/number_pad.json"
const SCENE_PATH: String = "res://scenes/ui/number_pad.tscn"
const SCREEN: Vector2 = Vector2(1152.0, 648.0)
const EPSILON: float = 0.001


func after_each() -> void:
	Engine.time_scale = 1.0
	GameState.reset()


func test_data_defines_the_slow_scale_and_two_thumb_keys() -> void:
	var config: Dictionary = NumberPad.load_config(DATA_PATH)
	assert_eq(int(config.get("version", 0)), 1, "number_pad.json declares version 1")
	assert_almost_eq(float(config.get("slowScale", 0.0)), 0.15, EPSILON, "default slow scale")
	var keys: Array = config.get("keys", [])
	assert_true(keys.size() >= 12, "the pad ships ten digits plus delete and confirm")
	var ids: Array[String] = []
	for key: Dictionary in keys:
		ids.append(String(key.get("id", "")))
	for required: String in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "delete", "confirm"]:
		assert_true(ids.has(required), "missing key %s" % required)


func test_opening_slows_the_world_and_closing_restores_it() -> void:
	var pad: NumberPad = _pad()
	assert_false(pad.is_open(), "the pad starts closed")
	assert_almost_eq(pad.time_control.time_scale(), 1.0, EPSILON, "full speed before opening")
	assert_false(pad.time_control.timers_paused(), "timers run before opening")
	pad.open()
	assert_true(pad.is_open())
	assert_almost_eq(pad.time_control.time_scale(), 0.15, EPSILON, "opening slows to 15 percent")
	assert_true(pad.time_control.timers_paused(), "opening pauses timers")
	assert_almost_eq(Engine.time_scale, 0.15, EPSILON, "the engine world slow is applied")
	pad.close()
	assert_false(pad.is_open())
	assert_almost_eq(pad.time_control.time_scale(), 1.0, EPSILON, "closing restores full speed")
	assert_false(pad.time_control.timers_paused(), "closing resumes timers")
	assert_almost_eq(Engine.time_scale, 1.0, EPSILON, "the engine world slow is restored")


func test_time_control_separates_world_slow_from_timer_pause() -> void:
	var control: TimeControl = TimeControl.new()
	assert_eq(control.time_scale(), 1.0, "idle world runs full speed")
	assert_false(control.timers_paused(), "idle timers run")
	control.open()
	assert_almost_eq(control.time_scale(), control.slow_scale, EPSILON, "world runs slow")
	assert_true(control.timers_paused(), "timers freeze entirely")
	assert_almost_eq(control.scale_delta(0.1), 0.1 * control.slow_scale, EPSILON, "delta scales")
	control.close()
	assert_eq(control.time_scale(), 1.0, "world returns to full speed")
	assert_false(control.timers_paused(), "timers resume")


func test_time_control_supports_reentrant_requests() -> void:
	var control: TimeControl = TimeControl.new()
	control.open()
	control.open()
	control.close()
	assert_true(control.is_active(), "one of two requests is still open")
	control.close()
	assert_false(control.is_active(), "the last request releases the slow")


func test_non_numeric_input_is_rejected_and_five_digits_are_supported() -> void:
	var pad: NumberPad = _pad()
	assert_false(pad.press("a"), "a letter is rejected")
	assert_false(pad.press(""), "empty input is rejected")
	assert_false(pad.type("x"), "non-numeric text is rejected")
	assert_false(pad.type("1.5"), "multi-character text is rejected")
	assert_eq(pad.display_text(), "", "rejected input leaves the entry empty")
	for digit: String in ["1", "2", "3", "4", "5"]:
		assert_true(pad.press(digit), "digit %s is accepted" % digit)
	assert_eq(pad.display_text(), "12345")
	assert_false(pad.press("6"), "a sixth digit is rejected")
	assert_eq(pad.display_text(), "12345", "the sixth digit changes nothing")


func test_delete_and_confirm_submit_the_value() -> void:
	var pad: NumberPad = _pad()
	watch_signals(pad)
	assert_false(pad.press("delete"), "delete on an empty entry is a no-op")
	assert_false(pad.press("confirm"), "confirm on an empty entry submits nothing")
	assert_true(pad.press("4"))
	assert_true(pad.press("2"))
	assert_true(pad.press("delete"), "delete removes the last digit")
	assert_eq(pad.display_text(), "4")
	assert_true(pad.press("confirm"))
	assert_signal_emitted_with_parameters(pad, "confirmed", [4])
	assert_eq(pad.display_text(), "", "confirm clears the entry")
	assert_eq(pad.value(), -1, "the pad is empty after confirm")


func test_keys_emit_haptic_and_sound_hooks() -> void:
	var pad: NumberPad = _pad()
	watch_signals(pad)
	assert_true(pad.press("7"))
	assert_signal_emitted_with_parameters(pad, "haptic_requested", ["digit"])
	assert_signal_emitted_with_parameters(pad, "sound_requested", ["digit"])
	assert_true(pad.press("delete"))
	assert_signal_emitted_with_parameters(pad, "haptic_requested", ["delete"])
	assert_signal_emitted_with_parameters(pad, "sound_requested", ["delete"])
	assert_true(pad.press("1"))
	assert_true(pad.press("confirm"))
	assert_signal_emitted_with_parameters(pad, "haptic_requested", ["confirm"])
	assert_signal_emitted_with_parameters(pad, "sound_requested", ["confirm"])


func test_haptic_and_sound_hooks_are_data_gated() -> void:
	var pad: NumberPad = _pad()
	pad.haptic_enabled = false
	pad.sound_enabled = false
	watch_signals(pad)
	assert_true(pad.press("3"))
	assert_signal_not_emitted(pad, "haptic_requested")
	assert_signal_not_emitted(pad, "sound_requested")


func test_keys_are_large_and_split_across_two_thumbs() -> void:
	var pad: NumberPad = _pad()
	assert_true(pad.key_size() >= InputActions.MIN_TARGET_DP, "keys are at least 48 dp")
	assert_true(pad.key_size() >= 56.0, "keys are at least the data-defined 56 dp")
	var ids: Array[String] = pad.key_ids()
	assert_true(ids.has("delete"), "the pad has a delete key")
	assert_true(ids.has("confirm"), "the pad has a confirm key")
	for id: String in ids:
		var center: Vector2 = pad.key_center(id)
		if pad.key_thumb(id) == NumberPad.THUMB_LEFT:
			assert_true(center.x < SCREEN.x * 0.5, "%s sits under the left thumb" % id)
		else:
			assert_true(center.x > SCREEN.x * 0.5, "%s sits under the right thumb" % id)
	assert_eq(pad.key_thumb("delete"), NumberPad.THUMB_LEFT, "delete sits under the left thumb")
	assert_eq(pad.key_thumb("confirm"), NumberPad.THUMB_RIGHT, "confirm sits under the right thumb")


func test_scene_instantiates_and_builds_the_pad() -> void:
	var scene: PackedScene = load(SCENE_PATH) as PackedScene
	assert_not_null(scene, "the number pad scene loads")
	if scene == null:
		return
	var pad: NumberPad = scene.instantiate() as NumberPad
	assert_not_null(pad, "the scene instantiates a NumberPad")
	if pad == null:
		return
	add_child_autofree(pad)
	assert_true(pad.key_ids().size() >= 12, "the scene loads every key")
	assert_true(pad.get_child_count() >= 12, "the scene builds every key control")


func _pad() -> NumberPad:
	var pad: NumberPad = NumberPad.new()
	add_child_autofree(pad)
	pad.set_anchors_preset(Control.PRESET_TOP_LEFT)
	pad.size = SCREEN
	pad.build()
	return pad
