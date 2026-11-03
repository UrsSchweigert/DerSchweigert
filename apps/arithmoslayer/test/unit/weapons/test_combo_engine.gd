extends GutTest
## Guards the data-only weapon format and the fixed-timestep combo engine.

const WEAPON_DIR: String = "res://data/weapons"
const SCHEMA_NAME: String = "schema.json"
const EPSILON: float = 0.001
const MAX_FRAMES: int = 2000


func test_every_shipped_weapon_loads_as_an_ordered_graph() -> void:
	var paths: Array[String] = _weapon_paths()
	assert_gt(paths.size(), 0, "at least one weapon must ship")
	for path: String in paths:
		var weapon: WeaponDefinition = WeaponDefinition.load_file(path)
		assert_true(weapon.is_valid(), "%s: %s" % [path, [weapon.errors]])
		var raw_steps: Array = _json(path)["steps"]
		assert_eq(weapon.steps.size(), raw_steps.size(), "%s must load every step" % path)
		for index: int in weapon.steps.size():
			var step: WeaponDefinition.Step = weapon.steps[index]
			assert_eq(weapon.step_ids().count(step.id), 1, "step ids must be unique")
			assert_true(WeaponDefinition.INPUT_KINDS.has(step.input_kind), step.id)
			assert_between(step.input_touches, 1, ComboEngine.MAX_TOUCHES, step.id)
			assert_eq(ComboEngine.required_touches(step), step.input_touches, step.id)
			_assert_step(step, raw_steps[index])
		assert_true(weapon.is_finisher(weapon.step_ids()[-1]), "%s must end on a finisher" % path)
		assert_eq(weapon.step_after(weapon.step_ids()[-1]), "", "a finisher has no successor")


func test_at_most_two_simultaneous_touches_are_supported() -> void:
	assert_eq(ComboEngine.MAX_TOUCHES, 2, "the design allows two simultaneous touches")


func test_loader_rejects_unknown_fields_at_every_level() -> void:
	var top_level: Dictionary = _json(_weapon_paths()[0])
	top_level["surprise"] = true
	var top_weapon: WeaponDefinition = WeaponDefinition.from_dictionary(top_level)
	assert_false(top_weapon.is_valid(), "an unknown top-level field must fail")
	assert_true(_has_error(top_weapon, "unknown field 'surprise'"))
	var nested: Dictionary = _json(_weapon_paths()[0])
	(nested["steps"][0]["hitbox"] as Dictionary)["colour"] = "red"
	var nested_weapon: WeaponDefinition = WeaponDefinition.from_dictionary(nested)
	assert_false(nested_weapon.is_valid(), "an unknown nested field must fail")
	assert_true(_has_error(nested_weapon, "unknown field 'colour'"))


func test_engine_starts_and_advances_on_fixed_frames() -> void:
	var weapon: WeaponDefinition = _weapon()
	var engine: ComboEngine = ComboEngine.new(weapon)
	assert_true(engine.start(), "a valid weapon must start")
	assert_eq(engine.state, ComboEngine.State.ACTIVE)
	assert_eq(engine.step_id, weapon.step_ids()[0])
	engine.advance(Timestep.FIXED_DELTA)
	assert_eq(engine.frame, 1, "one fixed step must advance one frame")
	engine.advance(Timestep.FIXED_DELTA * 2.0)
	assert_eq(engine.frame, 3, "a larger delta must consume whole fixed steps")


func test_hit_confirmation_gates_the_next_step_and_dropped_hits_restart() -> void:
	var weapon: WeaponDefinition = _weapon()
	var engine: ComboEngine = ComboEngine.new(weapon)
	engine.start()
	var first: WeaponDefinition.Step = engine.current_step()
	assert_false(engine.confirm_hit(), "startup frames must not confirm a hit")
	for _index: int in first.startup:
		engine.tick()
	assert_true(engine.confirm_hit(), "active frames must confirm a hit")
	for _index: int in first.total_frames() - first.startup:
		engine.tick()
	assert_eq(engine.step_id, weapon.step_ids()[1], "a confirmed hit must advance the graph")
	var dropped: ComboEngine = ComboEngine.new(weapon)
	dropped.start()
	for _index: int in first.total_frames():
		dropped.tick()
	assert_eq(dropped.step_id, first.id, "a dropped hit must restart the combo")


func test_cancel_window_jumps_and_early_input_stays_buffered() -> void:
	var engine: ComboEngine = ComboEngine.new(_weapon())
	engine.start()
	var first: WeaponDefinition.Step = engine.current_step()
	var target: WeaponDefinition.Step = engine.weapon.step(first.cancel_into[0])
	engine.push_input(target.input_kind, target.input_direction)
	for _index: int in first.cancel_start - 1:
		engine.tick()
	assert_eq(engine.step_id, first.id, "an early cancel input must not jump")
	assert_eq(engine.buffered_count(), 1, "the early input must stay buffered")
	engine.tick()
	assert_eq(engine.step_id, first.cancel_into[0], "the cancel window must jump to its target")
	assert_eq(engine.frame, 0, "the cancel must restart the frame counter")


func test_input_buffer_holds_two_touches_and_expires() -> void:
	var engine: ComboEngine = ComboEngine.new(_weapon())
	engine.start()
	assert_true(engine.push_input("tap"))
	assert_true(engine.push_input("tap"))
	assert_false(engine.push_input("tap"), "a third simultaneous touch must be rejected")
	assert_eq(engine.buffered_count(), 2)
	for _index: int in engine.buffer_frames + 1:
		engine.tick()
	assert_eq(engine.buffered_count(), 0, "buffered input must expire")


func test_finisher_ends_every_shipped_combo() -> void:
	for path: String in _weapon_paths():
		var weapon: WeaponDefinition = WeaponDefinition.load_file(path)
		var engine: ComboEngine = ComboEngine.new(weapon)
		var finished: Array[int] = []
		engine.combo_finished.connect(func() -> void: finished.append(1))
		assert_true(engine.start(), "%s must start" % path)
		var guard: int = 0
		while engine.state == ComboEngine.State.ACTIVE and guard < MAX_FRAMES:
			if engine.frame == engine.current_step().startup:
				engine.confirm_hit()
			engine.tick()
			guard += 1
		assert_eq(engine.state, ComboEngine.State.FINISHED, "%s must reach its finisher" % path)
		assert_true(engine.current_step().finisher, "%s must finish on the finisher" % path)
		assert_eq(finished.size(), 1, "%s must emit combo_finished once" % path)


func _assert_step(step: WeaponDefinition.Step, raw: Dictionary) -> void:
	var frames: Dictionary = raw["frames"]
	assert_eq(step.startup, int(frames["startup"]), "%s startup" % step.id)
	assert_eq(step.active, int(frames["active"]), "%s active" % step.id)
	assert_eq(step.recovery, int(frames["recovery"]), "%s recovery" % step.id)
	var hitbox: Dictionary = raw["hitbox"]
	assert_eq(step.hitbox_shape, String(hitbox["shape"]), "%s hitbox shape" % step.id)
	var size: Array = hitbox["size"]
	assert_eq(step.hitbox_size, Vector2(size[0], size[1]), "%s hitbox size" % step.id)
	assert_eq(step.orb, String(raw["orb"]), "%s orb" % step.id)
	assert_eq(step.finisher, bool(raw["finisher"]), "%s finisher" % step.id)
	var impulse: Array = raw["impulse"]
	assert_eq(step.impulse, Vector2(impulse[0], impulse[1]), "%s impulse" % step.id)
	assert_almost_eq(step.knockback, float(raw["knockback"]), EPSILON, "%s knockback" % step.id)
	var cancel: Dictionary = raw["cancel"]
	assert_eq(step.cancel_start, int(cancel["startFrame"]), "%s cancel start" % step.id)
	assert_eq(step.cancel_end, int(cancel["endFrame"]), "%s cancel end" % step.id)
	assert_eq(str(step.cancel_into), str(cancel["into"]), "%s cancel targets" % step.id)
	assert_eq(str(step.effects), str(raw["effects"]), "%s effects" % step.id)
	assert_eq(str(step.sounds), str(raw["sounds"]), "%s sounds" % step.id)


func _weapon_paths() -> Array[String]:
	var paths: Array[String] = []
	var directory: DirAccess = DirAccess.open(WEAPON_DIR)
	if directory == null:
		return paths
	for file_name: String in directory.get_files():
		if file_name.ends_with(".json") and file_name != SCHEMA_NAME:
			paths.append(WEAPON_DIR.path_join(file_name))
	paths.sort()
	return paths


func _weapon() -> WeaponDefinition:
	var weapon: WeaponDefinition = WeaponDefinition.load_file(
		WEAPON_DIR.path_join("sum_blade.json")
	)
	assert_true(weapon.is_valid(), "the fixture must load: %s" % [weapon.errors])
	return weapon


func _json(path: String) -> Dictionary:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_not_null(file, "%s must exist" % path)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	assert_true(parsed is Dictionary, "%s must decode to an object" % path)
	return parsed as Dictionary if parsed is Dictionary else {}


func _has_error(weapon: WeaponDefinition, needle: String) -> bool:
	return weapon.errors.any(func(message: String) -> bool: return message.contains(needle))
