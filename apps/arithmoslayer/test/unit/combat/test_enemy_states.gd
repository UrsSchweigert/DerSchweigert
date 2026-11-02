extends GutTest
## Guards the seven-state Muddler brain, its eight archetypes, and the validator.

const ENEMIES_DIR: String = "res://data/enemies"
const SCENE_PATH: String = "res://scenes/combat/muddler.tscn"
const MIN_TELEGRAPH: float = 0.4
const EPSILON: float = 0.001
const REQUIRED_STATES: Array = [
	"idle", "patrol", "chase", "telegraph", "attack", "stagger", "unscramble"
]
const EXPECTED_BIOMES: Array = [
	"meadow", "desert", "tundra", "forest", "swamp", "cavern", "volcano", "reef"
]
const VALIDATOR_CODE: String = (
	"import sys;sys.path.insert(0, 'tools');"
	+ "from validate import enemies;"
	+ "print('\\n'.join(enemies.validate(__import__('pathlib').Path(sys.argv[1]))))"
)

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_eight_archetypes_span_eight_biomes() -> void:
	var documents: Array[Dictionary] = _enemy_documents()
	assert_eq(documents.size(), EXPECTED_BIOMES.size(), "eight archetypes are required")
	var biomes: Array[String] = []
	for document: Dictionary in documents:
		biomes.append(String(document.get("biome", "")))
	for biome: String in EXPECTED_BIOMES:
		assert_true(biomes.has(biome), "missing biome %s" % biome)
	assert_eq(_unique(biomes).size(), EXPECTED_BIOMES.size(), "every biome must be distinct")


func test_every_archetype_declares_the_seven_states() -> void:
	for document: Dictionary in _enemy_documents():
		var states: Array = document.get("states", [])
		for state: String in REQUIRED_STATES:
			assert_true(
				states.has(state),
				"%s must declare state %s" % [document.get("id"), state],
			)


func test_every_archetype_has_a_readable_telegraph() -> void:
	for document: Dictionary in _enemy_documents():
		var telegraph: float = float(document.get("telegraph", 0.0))
		assert_true(
			telegraph >= MIN_TELEGRAPH,
			"%s must telegraph for at least 0.4s" % document.get("id"),
		)
		var machine: EnemyStateMachine = _machine(document)
		assert_true(machine.telegraph_duration >= MIN_TELEGRAPH, "the machine must keep the floor")
		assert_almost_eq(
			machine.duration_for(EnemyStateMachine.State.TELEGRAPH),
			telegraph,
			EPSILON,
			"%s must use its document telegraph" % document.get("id"),
		)


func test_every_archetype_has_distinct_movement_and_attack_patterns() -> void:
	var movements: Array[String] = []
	var attacks: Array[String] = []
	for document: Dictionary in _enemy_documents():
		movements.append(String(document.get("movement", "")))
		attacks.append(String(document.get("attack", "")))
	assert_eq(_unique(movements).size(), movements.size(), "movement patterns must be unique")
	assert_eq(_unique(attacks).size(), attacks.size(), "attack patterns must be unique")


func test_machine_reads_the_archetype_document() -> void:
	var document: Dictionary = _enemy_documents()[0]
	var machine: EnemyStateMachine = _machine(document)
	assert_eq(machine.archetype_id, String(document.get("id", "")))
	assert_eq(machine.biome, String(document.get("biome", "")))
	assert_eq(machine.hp, int(document.get("hp", 0)))
	assert_eq(machine.max_hp, int(document.get("hp", 0)))
	assert_almost_eq(machine.speed, float(document.get("speed", 0.0)), EPSILON)
	assert_eq(machine.movement_pattern, String(document.get("movement", "")))
	assert_eq(machine.attack_pattern, String(document.get("attack", "")))
	assert_eq(machine.declared_states.size(), REQUIRED_STATES.size())


func test_machine_walks_all_seven_states() -> void:
	var machine: EnemyStateMachine = _machine(_enemy_documents()[0])
	var seen: Array[int] = [machine.state]
	assert_eq(machine.state, EnemyStateMachine.State.IDLE, "a fresh brain starts idle")
	for _step: int in 8:
		machine.advance(machine.duration_for(machine.state) + EPSILON)
		if not seen.has(machine.state):
			seen.append(machine.state)
	assert_eq(
		seen.size(),
		EnemyStateMachine.STATE_NAMES.size(),
		"all seven states must run: %s" % [seen],
	)
	for state_id: int in seen:
		assert_true(
			EnemyStateMachine.state_name(state_id) != "unknown",
			"state %d must be named" % state_id,
		)


func test_telegraph_holds_for_at_least_the_floor() -> void:
	var machine: EnemyStateMachine = _machine(_enemy_documents()[0])
	_run_to(machine, EnemyStateMachine.State.TELEGRAPH)
	assert_true(machine.is_telegraphing(), "the brain must reach the telegraph")
	var elapsed: float = 0.0
	var limit: float = machine.duration_for(EnemyStateMachine.State.TELEGRAPH) + 0.05
	while machine.is_telegraphing() and elapsed < 2.0:
		machine.advance(0.01)
		elapsed += 0.01
	assert_true(elapsed >= MIN_TELEGRAPH, "telegraph lasted %s seconds" % elapsed)
	assert_true(elapsed < limit, "telegraph must end promptly, lasted %s" % elapsed)


func test_machine_clamps_a_short_telegraph() -> void:
	var machine: EnemyStateMachine = EnemyStateMachine.new()
	add_child_autofree(machine)
	machine.apply_config({"telegraph": 0.1})
	assert_almost_eq(machine.telegraph_duration, MIN_TELEGRAPH, EPSILON)
	assert_almost_eq(
		machine.duration_for(EnemyStateMachine.State.TELEGRAPH), MIN_TELEGRAPH, EPSILON
	)


func test_muddler_scene_instantiates_with_placeholder_parts() -> void:
	var scene: PackedScene = load(SCENE_PATH) as PackedScene
	assert_not_null(scene, "muddler.tscn must load")
	if scene == null:
		return
	var muddler: EnemyStateMachine = scene.instantiate() as EnemyStateMachine
	assert_not_null(muddler, "the scene root must run EnemyStateMachine")
	if muddler == null:
		return
	add_child_autofree(muddler)
	assert_not_null(muddler.get_node_or_null("Body"), "the placeholder body is required")
	assert_not_null(muddler.get_node_or_null("Hitbox/CollisionShape2D"), "the hitbox needs a shape")
	assert_eq(muddler.state, EnemyStateMachine.State.IDLE)


func test_validator_accepts_a_valid_document() -> void:
	var output: String = _validate_enemy_documents({"muddler_meadow.json": _valid_enemy("meadow")})
	assert_true(output.strip_edges().is_empty(), "a valid document must pass: %s" % output)


func test_validator_rejects_a_missing_state() -> void:
	var document: Dictionary = _valid_enemy("meadow")
	document["states"] = ["idle", "patrol", "chase", "telegraph", "attack", "stagger"]
	var output: String = _validate_enemy_documents({"muddler_meadow.json": document})
	assert_true(output.contains("missing state 'unscramble'"), output)


func test_validator_rejects_a_short_telegraph() -> void:
	var document: Dictionary = _valid_enemy("meadow")
	document["telegraph"] = 0.39
	var output: String = _validate_enemy_documents({"muddler_meadow.json": document})
	assert_true(output.contains("telegraph must be a number of at least 0.4 seconds"), output)


func test_validator_rejects_duplicate_patterns() -> void:
	var meadow: Dictionary = _valid_enemy("meadow")
	var desert: Dictionary = _valid_enemy("desert")
	desert["movement"] = meadow["movement"]
	desert["attack"] = meadow["attack"]
	var output: String = _validate_enemy_documents(
		{"muddler_meadow.json": meadow, "muddler_desert.json": desert}
	)
	assert_true(output.contains("duplicate movement pattern"), output)
	assert_true(output.contains("duplicate attack pattern"), output)


func _machine(document: Dictionary) -> EnemyStateMachine:
	var machine: EnemyStateMachine = EnemyStateMachine.new()
	add_child_autofree(machine)
	machine.apply_config(document)
	return machine


func _run_to(machine: EnemyStateMachine, target: int) -> void:
	for _step: int in 16:
		if machine.state == target:
			return
		machine.advance(machine.duration_for(machine.state) + EPSILON)


func _enemy_documents() -> Array[Dictionary]:
	var names: Array[String] = []
	for file_name: String in DirAccess.get_files_at(ENEMIES_DIR):
		if file_name.ends_with(".json"):
			names.append(file_name)
	names.sort()
	var documents: Array[Dictionary] = []
	for file_name: String in names:
		var parsed: Variant = JSON.parse_string(
			FileAccess.get_file_as_string(ENEMIES_DIR.path_join(file_name))
		)
		assert_true(parsed is Dictionary, "%s must decode to an object" % file_name)
		if parsed is Dictionary:
			documents.append(parsed as Dictionary)
	return documents


func _unique(values: Array[String]) -> Array[String]:
	var unique: Array[String] = []
	for value: String in values:
		if not unique.has(value):
			unique.append(value)
	return unique


func _valid_enemy(biome: String) -> Dictionary:
	return {
		"version": 1,
		"id": "muddler_%s" % biome,
		"biome": biome,
		"states": REQUIRED_STATES.duplicate(),
		"telegraph": 0.5,
		"speed": 60.0,
		"hp": 20,
		"movement": "pattern_%s" % biome,
		"attack": "attack_%s" % biome,
	}


func _validate_enemy_documents(files: Dictionary) -> String:
	var root: String = _make_enemy_project(files)
	var output: Array = []
	var arguments: PackedStringArray = PackedStringArray(["-c", VALIDATOR_CODE, root])
	var exit_code: int = OS.execute("python3", arguments, output, true)
	assert_eq(exit_code, 0, "the enemies validator must run: %s" % [output])
	var lines: PackedStringArray = PackedStringArray()
	for line: Variant in output:
		lines.append(str(line))
	return "\n".join(lines)


func _make_enemy_project(files: Dictionary) -> String:
	var root: String = _make_temp_dir("enemies")
	for file_name: String in files:
		var document: Dictionary = files[file_name] as Dictionary
		var path: String = root.path_join("data/enemies").path_join(file_name)
		_write_text(path, JSON.stringify(document, "  "))
	return root


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("enemy_probe")
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
			DirAccess.remove_absolute(full_path)
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(dir_path)
