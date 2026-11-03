extends GutTest
## Guards the five strike effects, their data, and the reduced-effects path.

const FEEL_PATH: String = "res://data/combat/feel.json"
const EPSILON: float = 0.001
const PROBLEM: Dictionary = {"operation": "addition", "a": 3, "b": 4, "answer": 7}
const MC_BAND: Dictionary = {"answerFormat": "multiple_choice"}
const VALIDATOR_CODE: String = (
	"import sys;sys.path.insert(0, 'tools');"
	+ "from validate import feel;"
	+ "print('\\n'.join(feel.validate(__import__('pathlib').Path(sys.argv[1]))))"
)

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_feel_data_defines_every_strike_effect() -> void:
	var config: Dictionary = _json(FEEL_PATH)
	assert_eq(int(config.get("version", 0)), 1, "feel.json must declare version 1")
	var reduced: Dictionary = config.get("reducedEffects", {}) as Dictionary
	var intensity_scale: float = float(reduced.get("intensityScale", -1.0))
	var duration_scale: float = float(reduced.get("durationScale", -1.0))
	assert_between(intensity_scale, 0.0, 1.0, "the reduced intensity scale must be a scale")
	assert_between(duration_scale, 0.0, 1.0, "the reduced duration scale must be a scale")
	assert_true(
		intensity_scale < 1.0 or duration_scale < 1.0,
		"reduced effects must soften at least one scale",
	)
	var hit_stop: Dictionary = config.get("hitStop", {}) as Dictionary
	assert_gt(float(hit_stop.get("seconds", 0.0)), 0.0, "hit-stop needs a duration")
	var knockback: Dictionary = config.get("knockback", {}) as Dictionary
	assert_gt(float(knockback.get("distancePx", 0.0)), 0.0, "knockback needs a distance")
	assert_gt(float(knockback.get("seconds", 0.0)), 0.0, "knockback needs a duration")
	var body: Dictionary = config.get("squashStretch", {}) as Dictionary
	assert_gt(float(body.get("squash", 0.0)), 0.0, "a strike needs squash")
	assert_gt(float(body.get("stretch", 0.0)), 0.0, "a strike needs stretch")
	assert_gt(float(body.get("seconds", 0.0)), 0.0, "squash and stretch need a duration")
	var punch: Dictionary = config.get("cameraPunch", {}) as Dictionary
	assert_gt(float(punch.get("distancePx", 0.0)), 0.0, "the camera punch needs a distance")
	assert_gt(float(punch.get("seconds", 0.0)), 0.0, "the camera punch needs a duration")
	var shake: Dictionary = config.get("screenShake", {}) as Dictionary
	assert_gt(float(shake.get("amplitudePx", 0.0)), 0.0, "shake needs an amplitude")
	assert_gt(float(shake.get("seconds", 0.0)), 0.0, "shake needs a duration")
	assert_gt(float(shake.get("frequency", 0.0)), 0.0, "shake needs a frequency")


func test_a_strike_fires_every_effect_with_its_data_intensity() -> void:
	var feel: GameFeel = GameFeel.new()
	var effects: Dictionary = feel.strike(Vector2.RIGHT)
	var hit_stop: Dictionary = effects["hitStop"] as Dictionary
	assert_almost_eq(float(hit_stop["seconds"]), feel.hit_stop_seconds, EPSILON)
	assert_true(feel.is_hit_stopping(), "a strike stops the frame")
	var knockback: Dictionary = effects["knockback"] as Dictionary
	assert_almost_eq((knockback["offset"] as Vector2).length(), feel.knockback_distance, EPSILON)
	assert_almost_eq(float(knockback["seconds"]), feel.knockback_seconds, EPSILON)
	assert_almost_eq(feel.knockback_offset().length(), feel.knockback_distance, EPSILON)
	var body: Dictionary = effects["squashStretch"] as Dictionary
	assert_almost_eq(float(body["squash"]), feel.squash, EPSILON)
	assert_almost_eq(float(body["stretch"]), feel.stretch, EPSILON)
	assert_almost_eq(float(body["seconds"]), feel.squash_seconds, EPSILON)
	var punch: Dictionary = effects["cameraPunch"] as Dictionary
	assert_almost_eq((punch["offset"] as Vector2).length(), feel.camera_punch_distance, EPSILON)
	assert_almost_eq(float(punch["seconds"]), feel.camera_punch_seconds, EPSILON)
	var shake: Dictionary = effects["screenShake"] as Dictionary
	assert_almost_eq(float(shake["amplitude"]), feel.shake_amplitude, EPSILON)
	assert_almost_eq(float(shake["seconds"]), feel.shake_seconds, EPSILON)
	assert_almost_eq(float(shake["frequency"]), feel.shake_frequency, EPSILON)
	assert_gt(feel.camera_offset().length(), 0.0, "the camera moves on a strike")


func test_squash_then_stretch_follows_the_data_duration() -> void:
	var feel: GameFeel = GameFeel.new()
	feel.strike(Vector2.UP)
	feel.advance(feel.squash_seconds * 0.4)
	var squashed: Vector2 = feel.squash_scale()
	assert_gt(squashed.x, 1.0, "the body squashes wide first")
	assert_lt(squashed.y, 1.0, "the body squashes short first")
	feel.advance(feel.squash_seconds * 0.3)
	var stretched: Vector2 = feel.squash_scale()
	assert_lt(stretched.x, 1.0, "the body then stretches narrow")
	assert_gt(stretched.y, 1.0, "the body then stretches tall")


func test_every_effect_expires_on_its_data_duration() -> void:
	var feel: GameFeel = GameFeel.new()
	feel.strike(Vector2.DOWN)
	var longest: float = maxf(
		feel.hit_stop_seconds,
		maxf(
			feel.knockback_seconds,
			maxf(
				feel.squash_seconds,
				maxf(feel.camera_punch_seconds, feel.shake_seconds),
			),
		),
	)
	feel.advance(longest + EPSILON)
	assert_false(feel.is_hit_stopping(), "hit-stop ends on its duration")
	assert_eq(feel.knockback_offset(), Vector2.ZERO, "knockback ends on its duration")
	assert_eq(feel.squash_scale(), Vector2.ONE, "the body settles on its duration")
	assert_eq(feel.camera_offset(), Vector2.ZERO, "the camera settles on its duration")


func test_reduced_effects_soften_and_shorten_every_effect() -> void:
	var full: GameFeel = GameFeel.new()
	var reduced: GameFeel = GameFeel.new()
	reduced.set_reduced_effects(true)
	assert_true(reduced.reduced_effects)
	var full_effects: Dictionary = full.strike(Vector2.RIGHT)
	var reduced_effects: Dictionary = reduced.strike(Vector2.RIGHT)
	var scale: float = reduced.reduced_intensity_scale
	var shorter: float = reduced.reduced_duration_scale
	var full_hit_stop: Dictionary = full_effects["hitStop"] as Dictionary
	var reduced_hit_stop: Dictionary = reduced_effects["hitStop"] as Dictionary
	assert_lt(float(reduced_hit_stop["seconds"]), float(full_hit_stop["seconds"]))
	assert_almost_eq(
		float(reduced_hit_stop["seconds"]), float(full_hit_stop["seconds"]) * shorter, EPSILON
	)
	var full_knockback: Dictionary = full_effects["knockback"] as Dictionary
	var reduced_knockback: Dictionary = reduced_effects["knockback"] as Dictionary
	assert_lt(
		(reduced_knockback["offset"] as Vector2).length(),
		(full_knockback["offset"] as Vector2).length(),
	)
	assert_almost_eq(
		(reduced_knockback["offset"] as Vector2).length(),
		(full_knockback["offset"] as Vector2).length() * scale,
		EPSILON,
	)
	assert_almost_eq(
		float(reduced_knockback["seconds"]),
		float(full_knockback["seconds"]) * shorter,
		EPSILON,
	)
	var full_body: Dictionary = full_effects["squashStretch"] as Dictionary
	var reduced_body: Dictionary = reduced_effects["squashStretch"] as Dictionary
	assert_lt(float(reduced_body["squash"]), float(full_body["squash"]))
	assert_lt(float(reduced_body["stretch"]), float(full_body["stretch"]))
	assert_almost_eq(float(reduced_body["squash"]), float(full_body["squash"]) * scale, EPSILON)
	assert_almost_eq(float(reduced_body["seconds"]), float(full_body["seconds"]) * shorter, EPSILON)
	var full_punch: Dictionary = full_effects["cameraPunch"] as Dictionary
	var reduced_punch: Dictionary = reduced_effects["cameraPunch"] as Dictionary
	assert_lt(
		(reduced_punch["offset"] as Vector2).length(),
		(full_punch["offset"] as Vector2).length(),
	)
	assert_almost_eq(
		float(reduced_punch["seconds"]), float(full_punch["seconds"]) * shorter, EPSILON
	)
	var full_shake: Dictionary = full_effects["screenShake"] as Dictionary
	var reduced_shake: Dictionary = reduced_effects["screenShake"] as Dictionary
	assert_lt(float(reduced_shake["amplitude"]), float(full_shake["amplitude"]))
	assert_almost_eq(
		float(reduced_shake["amplitude"]), float(full_shake["amplitude"]) * scale, EPSILON
	)
	assert_almost_eq(
		float(reduced_shake["seconds"]), float(full_shake["seconds"]) * shorter, EPSILON
	)


func test_reduced_effects_round_trip_through_the_profile() -> void:
	var feel: GameFeel = GameFeel.new()
	assert_false(feel.reduced_effects, "effects are full by default")
	var profile: Dictionary = feel.write_profile({"settings": {}})
	assert_false(bool(profile[GameFeel.PROFILE_KEY]))
	profile[GameFeel.PROFILE_KEY] = true
	var restored: GameFeel = GameFeel.new()
	restored.apply_profile(profile)
	assert_true(restored.reduced_effects, "the profile turns reduced effects on")


func test_an_orb_strike_fires_the_effects() -> void:
	var spawner: OrbSpawner = OrbSpawner.new(Rng.new(7))
	add_child_autofree(spawner)
	watch_signals(spawner)
	spawner.present(PROBLEM, MC_BAND, 0.0)
	var correct: AnswerOrb = null
	for orb: AnswerOrb in spawner.orbs:
		if orb.is_correct:
			correct = orb
	assert_not_null(correct, "the problem needs a correct orb")
	if correct == null:
		return
	correct.strike()
	assert_signal_emitted(spawner, "felt_strike")
	assert_true(spawner.feel.is_hit_stopping(), "a correct strike stops the frame")
	assert_gt(spawner.feel.knockback_offset().length(), 0.0, "a correct strike knocks back")
	assert_gt(spawner.feel.camera_offset().length(), 0.0, "a correct strike punches the camera")
	var effects: Array = get_signal_parameters(spawner, "felt_strike", 0)
	assert_eq(effects.size(), 1, "the payload carries the effects")
	if not effects.is_empty():
		assert_true(effects[0] is Dictionary)


func test_the_validator_accepts_shipped_data_and_rejects_an_amplified_reduction() -> void:
	var accepted: String = _run_validator(ProjectSettings.globalize_path("res://"))
	assert_true(accepted.strip_edges().is_empty(), "the shipped data must pass: %s" % accepted)
	var amplified: Dictionary = _valid_feel()
	(amplified["reducedEffects"] as Dictionary)["intensityScale"] = 1.5
	var rejected: String = _run_validator(_probe_root(amplified))
	assert_true(rejected.contains("between zero and one"), rejected)
	var inert: Dictionary = _valid_feel()
	inert["reducedEffects"] = {"intensityScale": 1.0, "durationScale": 1.0}
	var inert_result: String = _run_validator(_probe_root(inert))
	assert_true(inert_result.contains("soften at least one scale"), inert_result)


func _valid_feel() -> Dictionary:
	return {
		"version": 1,
		"reducedEffects": {"intensityScale": 0.25, "durationScale": 0.5},
		"hitStop": {"seconds": 0.06},
		"knockback": {"distancePx": 28.0, "seconds": 0.18},
		"squashStretch": {"squash": 0.22, "stretch": 0.3, "seconds": 0.16},
		"cameraPunch": {"distancePx": 6.0, "seconds": 0.12},
		"screenShake": {"amplitudePx": 4.0, "seconds": 0.2, "frequency": 22.0},
	}


func _json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert_true(parsed is Dictionary, "%s must decode to an object" % path)
	return parsed as Dictionary


func _run_validator(root: String) -> String:
	var output: Array = []
	var arguments: PackedStringArray = PackedStringArray(["-c", VALIDATOR_CODE, root])
	var exit_code: int = OS.execute("python3", arguments, output, true)
	assert_eq(exit_code, 0, "the feel validator must run: %s" % [output])
	return "\n".join(PackedStringArray(output))


func _probe_root(document: Dictionary) -> String:
	var root: String = _make_temp_dir("feel")
	_write_text(root.path_join("data/combat/feel.json"), JSON.stringify(document, "  "))
	return root


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("feel_probe")
	var dir_path: String = base.path_join("%s_%d" % [label, Time.get_ticks_usec()])
	DirAccess.make_dir_recursive_absolute(dir_path)
	_temp_dirs.append(dir_path)
	return dir_path


func _write_text(path: String, content: String) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "could not write %s" % path)
	if file == null:
		return
	file.store_string(content)
	file.close()


func _remove_tree(dir_path: String) -> void:
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full_path: String = dir_path.path_join(entry)
		if dir.current_is_dir():
			_remove_tree(full_path)
		else:
			dir.remove(entry)
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(dir_path)
