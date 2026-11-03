extends GutTest
## Guards the multi-phase boss brain, per-phase checkpoints, mastery rounds, the
## greybox scene, and the bosses validator.

const BOSS_PATH: String = "res://data/combat/bosses.json"
const BANDS_PATH: String = "res://data/curriculum/bands.json"
const SCENE_PATH: String = "res://scenes/combat/boss.tscn"
const EPSILON: float = 0.001
const VALIDATOR_CODE: String = (
	"import sys;sys.path.insert(0, 'tools');"
	+ "from validate import bosses;"
	+ "print('\\n'.join(bosses.validate(__import__('pathlib').Path(sys.argv[1]))))"
)

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_document_declares_phases_with_island_bands() -> void:
	var boss: Dictionary = _boss()
	var island: String = String(boss.get("island", ""))
	var phases: Array = boss.get("phases", [])
	assert_false(island.is_empty(), "the boss needs an island")
	assert_true(phases.size() >= 2, "a boss needs multiple phases")
	var bands: Dictionary = _read_json(BANDS_PATH)
	for phase: Dictionary in phases:
		assert_gt(int(phase.get("hp", 0)), 0, "every phase needs hp")
		assert_gt(float(phase.get("duration", 0.0)), 0.0, "every phase needs a duration")
		assert_false(String(phase.get("pattern", "")).is_empty(), "every phase needs a pattern")
		for band_id: String in phase.get("bands", []):
			assert_eq(
				_band_island(bands, band_id), island, "%s must be from %s" % [band_id, island]
			)


func test_damage_advances_to_the_next_phase() -> void:
	var machine: BossStateMachine = _machine()
	var events: Array = []
	machine.phase_changed.connect(func(index: int, _phase_id: String) -> void: events.append(index))
	var first_id: String = machine.current_phase_id()
	var second_hp: int = int(machine.phases[1].get("hp", 0))
	assert_true(machine.damage(machine.phase_hp - 1), "damage inside a phase must land")
	assert_eq(machine.phase_index, 0, "the phase must not end early")
	assert_true(machine.damage(1), "the last point must land")
	assert_eq(machine.phase_index, 1, "the next phase must start")
	assert_ne(machine.current_phase_id(), first_id)
	assert_eq(machine.phase_hp, second_hp, "a new phase starts at full hp")
	assert_almost_eq(machine.phase_time, 0.0, EPSILON)
	assert_true(events.has(1), "the transition must be announced")
	var duration: float = machine.phase_duration
	machine.advance(duration / 2.0)
	assert_almost_eq(machine.phase_time, duration / 2.0, EPSILON)
	machine.advance(duration)
	assert_lt(machine.phase_time, duration, "the pattern must loop")
	assert_eq(machine.phase_index, 1, "a timed step never skips a phase")


func test_retry_restores_the_current_phase_checkpoint() -> void:
	var machine: BossStateMachine = _machine()
	var events: Array = []
	machine.phase_changed.connect(func(index: int, _phase_id: String) -> void: events.append(index))
	machine.damage(machine.phase_hp)
	assert_eq(machine.phase_index, 1)
	var checkpoint_hp: int = machine.phase_hp
	var full_health: int = machine.hp
	machine.damage(5)
	assert_lt(machine.hp, full_health)
	assert_true(machine.retry(), "a boss with phases can retry")
	assert_eq(machine.phase_index, 1, "a retry must not replay the first phase")
	assert_eq(machine.phase_hp, checkpoint_hp, "the phase restarts at its checkpoint")
	assert_eq(machine.hp, full_health, "completed phases stay completed")
	assert_false(events.has(0), "the retry must not re-enter phase zero")


func test_mastery_rounds_are_deterministic_and_from_the_island() -> void:
	var machine: BossStateMachine = _machine()
	var bands: Array[String] = machine.current_phase_bands()
	assert_false(bands.is_empty(), "the first phase needs bands")
	var first: Dictionary = machine.mastery_round(Rng.new(17))
	assert_eq(first, machine.mastery_round(Rng.new(17)), "the same seed picks the same band")
	assert_true(bands.has(String(first.get("band_id", ""))), "the band must be in the phase")
	assert_eq(String(first.get("island", "")), machine.island)
	assert_eq(String(first.get("phase_id", "")), machine.current_phase_id())
	for seed_value: int in 8:
		var round_result: Dictionary = machine.mastery_round(Rng.new(seed_value))
		assert_eq(
			String(round_result.get("island", "")), machine.island, "rounds stay in the island"
		)


func test_finishing_the_last_phase_announces_defeat() -> void:
	var machine: BossStateMachine = _machine()
	var defeats: Array = []
	machine.defeated.connect(func() -> void: defeats.append(true))
	for _step: int in 8:
		if machine.is_defeated():
			break
		machine.damage(machine.phase_hp)
	assert_true(machine.is_defeated(), "the last phase must end the fight")
	assert_eq(defeats.size(), 1, "defeat is announced once")
	assert_eq(machine.hp, 0)
	assert_false(machine.damage(1), "a defeated boss takes no more damage")


func test_boss_scene_instantiates_with_a_health_bar() -> void:
	var boss: BossStateMachine = (load(SCENE_PATH) as PackedScene).instantiate()
	assert_true(boss is BossStateMachine, "the scene root must run BossStateMachine")
	if boss == null:
		return
	add_child_autofree(boss)
	assert_not_null(boss.get_node_or_null("Body"), "the placeholder body is required")
	assert_not_null(boss.get_node_or_null("Hitbox/CollisionShape2D"), "the hitbox needs a shape")
	var bar: BossHealthBar = boss.get_node_or_null("BossHealthBar") as BossHealthBar
	assert_not_null(bar, "the boss needs a health bar")
	if bar == null:
		return
	assert_eq(bar.max_hp, boss.max_hp, "the bar binds on ready")
	assert_eq(bar.hp, boss.hp)
	boss.damage(10)
	assert_eq(bar.hp, boss.hp, "the bar follows damage")
	assert_almost_eq(bar.health_ratio(), float(boss.hp) / float(boss.max_hp), EPSILON)


func test_validator_accepts_a_valid_document() -> void:
	var output: String = _validate(_valid_document())
	assert_true(output.strip_edges().is_empty(), "a valid document must pass: %s" % output)


func test_validator_rejects_bad_islands_and_duplicate_phase_ids() -> void:
	var document: Dictionary = _valid_document()
	var phases: Array = _phases(document)
	(phases[0] as Dictionary)["bands"] = ["g2-within-100-no-carry"]
	assert_true(_validate(document).contains("belongs to island"), "a foreign band must fail")
	document = _valid_document()
	phases = _phases(document)
	(phases[1] as Dictionary)["id"] = (phases[0] as Dictionary)["id"]
	assert_true(_validate(document).contains("duplicate phase id"), "a repeated id must fail")


func _machine() -> BossStateMachine:
	var machine: BossStateMachine = BossStateMachine.new()
	add_child_autofree(machine)
	machine.apply_config(_boss())
	return machine


func _read_json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert_true(parsed is Dictionary, "%s must decode to an object" % path)
	return parsed as Dictionary if parsed is Dictionary else {}


func _boss() -> Dictionary:
	var bosses: Array = _read_json(BOSS_PATH).get("bosses", [])
	assert_false(bosses.is_empty(), "bosses.json must declare a boss")
	return bosses[0] as Dictionary if not bosses.is_empty() else {}


func _band_island(document: Dictionary, band_id: String) -> String:
	for band: Dictionary in document.get("bands", []):
		if String(band.get("id", "")) == band_id:
			return String(band.get("island", ""))
	return ""


func _phases(document: Dictionary) -> Array:
	return ((document.get("bosses", []) as Array)[0] as Dictionary).get("phases", [])


func _valid_document() -> Dictionary:
	var phases: Array = [
		{"id": "probe_one", "hp": 10, "bands": ["g1-within-10"], "pattern": "one", "duration": 5.0},
		{
			"id": "probe_two",
			"hp": 20,
			"bands": ["g1-within-20-carry"],
			"pattern": "two",
			"duration": 6.0
		},
	]
	return {
		"version": 1, "bosses": [{"id": "probe", "island": "grade-1", "hp": 30, "phases": phases}]
	}


func _validate(document: Dictionary) -> String:
	var root: String = _make_temp_dir("bosses")
	_write_text(root.path_join("data/combat/bosses.json"), JSON.stringify(document, "  "))
	_write_text(
		root.path_join("data/curriculum/bands.json"), FileAccess.get_file_as_string(BANDS_PATH)
	)
	var output: Array = []
	var arguments: PackedStringArray = PackedStringArray(["-c", VALIDATOR_CODE, root])
	assert_eq(
		OS.execute("python3", arguments, output, true), 0, "the validator must run: %s" % [output]
	)
	return "\n".join(PackedStringArray(output))


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("boss_probe")
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
	for relative: String in [
		"data/combat/bosses.json",
		"data/curriculum/bands.json",
		"data/combat",
		"data/curriculum",
		"data"
	]:
		DirAccess.remove_absolute(dir_path.path_join(relative))
	DirAccess.remove_absolute(dir_path)
