extends GutTest
## Guards answer orbs, the Chain, the Finisher, and their data.

const ORBS_PATH: String = "res://data/combat/orbs.json"
const CHAIN_PATH: String = "res://data/combat/chain.json"
const ORB_SCENE_PATH: String = "res://scenes/combat/answer_orb.tscn"
const VALIDATOR_CODE: String = (
	"import sys;sys.path.insert(0, 'tools');"
	+ "from validate import orbs_chain;"
	+ "print('\\n'.join(orbs_chain.validate(__import__('pathlib').Path(sys.argv[1]))))"
)
const PROBLEM: Dictionary = {"operation": "addition", "a": 3, "b": 4, "answer": 7}
const MC_BAND: Dictionary = {"answerFormat": "multiple_choice"}
const EPSILON: float = 0.001

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_orb_and_chain_data_are_playable() -> void:
	var orbs: Dictionary = _json(ORBS_PATH)
	assert_eq(int(orbs.get("version", 0)), 1)
	assert_eq(int(orbs.get("minOrbs", 0)), 2)
	assert_eq(int(orbs.get("maxOrbs", 0)), 4)
	var shapes: Array = orbs.get("shapes", [])
	assert_eq(shapes.size(), 4, "four distinct shapes")
	for shape: String in ["circle", "triangle", "square", "diamond"]:
		assert_true(shapes.has(shape), "missing shape %s" % shape)
	assert_gt(float((orbs.get("orbit", {}) as Dictionary).get("radiusPx", 0.0)), 0.0)
	assert_gt(float(orbs.get("hintChipSeconds", 0.0)), 0.0)
	assert_gt(float(orbs.get("wrongStrikeHastenSeconds", 0.0)), 0.0)
	var chain: Dictionary = _json(CHAIN_PATH)
	assert_eq(int(chain.get("version", 0)), 1)
	assert_gt(float(chain.get("finisherThreshold", 0.0)), 0.0)
	var tiers: Array = chain.get("tiers", [])
	assert_true(tiers.size() >= 2, "the chain needs tiers to climb")
	var previous: float = 0.0
	for tier_value: Variant in tiers:
		var multiplier: float = float((tier_value as Dictionary).get("shardMultiplier", 0.0))
		assert_gt(multiplier, previous, "tiers must pay more than the one below")
		assert_gt(float((tier_value as Dictionary).get("finisherCharge", 0.0)), 0.0)
		previous = multiplier


func test_a_presented_problem_shows_two_to_four_readable_orbs() -> void:
	var spawner: OrbSpawner = _spawner()
	var shown: Array[AnswerOrb] = spawner.present(PROBLEM, MC_BAND, 0.0)
	assert_between(shown.size(), 2, 4, "two to four orbs")
	var correct: int = 0
	var seen_shapes: Array[String] = []
	for orb: AnswerOrb in shown:
		if orb.is_correct:
			correct += 1
		assert_true(orb.readable_text().contains(str(orb.value)), "the number is readable")
		assert_true(orb.readable_text().contains(orb.shape), "the shape is readable")
		assert_false(seen_shapes.has(orb.shape), "every orb has its own shape")
		seen_shapes.append(orb.shape)
		assert_gt(orb.position.length(), 0.0, "orbs sit on the orbit")
	assert_eq(correct, 1, "exactly one orb is correct")
	var number_label: Label = shown[0].get_node_or_null("NumberLabel") as Label
	var polygon: Polygon2D = shown[0].get_node_or_null("Shape") as Polygon2D
	assert_not_null(number_label, "the scene shows a number label")
	assert_not_null(polygon, "the scene draws the shape")
	assert_not_null(shown[0].get_node_or_null("CollisionShape2D"), "the orb has a hitbox")
	if number_label != null:
		assert_eq(number_label.text, str(shown[0].value), "the number is readable")
	if polygon != null:
		var expected: int = AnswerOrb.shape_points(shown[0].shape, 1.0).size()
		assert_eq(polygon.polygon.size(), expected, "the polygon matches the shape")


func test_free_entry_opens_the_number_pad_instead_of_orbs() -> void:
	var spawner: OrbSpawner = _spawner()
	watch_signals(spawner)
	assert_eq(spawner.present(PROBLEM, MC_BAND, 1.0).size(), 0, "free entry shows no orbs")
	assert_signal_emitted(spawner, "open_number_pad")
	assert_eq(spawner.present(PROBLEM, {"answerFormat": "numeric"}, 0.0).size(), 0)


func test_a_correct_strike_unscrambles_and_raises_the_chain() -> void:
	var spawner: OrbSpawner = _spawner()
	spawner.present(PROBLEM, MC_BAND, 0.0)
	var before_multiplier: float = spawner.chain.shard_multiplier()
	_orb_with(spawner, true).strike()
	assert_true(spawner.is_unscrambled, "the correct orb unscrambles the Muddler")
	assert_eq(spawner.chain.tier(), 1, "a correct answer raises the chain")
	assert_gt(spawner.chain.shard_multiplier(), before_multiplier, "a higher tier pays more shards")
	assert_gt(spawner.finisher.charge, 0.0, "a correct answer charges the finisher")


func test_a_wrong_strike_pops_hints_drops_the_chain_and_hastens_the_muddler() -> void:
	var spawner: OrbSpawner = _spawner()
	var machine: EnemyStateMachine = EnemyStateMachine.new()
	add_child_autofree(machine)
	spawner.enemy = machine
	spawner.present(PROBLEM, MC_BAND, 0.0)
	spawner.chain.raise()
	_run_to_telegraph(machine)
	var remaining: float = machine.telegraph_remaining()
	var wrong: AnswerOrb = _orb_with(spawner, false)
	wrong.strike()
	assert_true(wrong.is_popped, "a wrong orb pops harmlessly")
	assert_false(wrong.visible, "a popped orb is hidden")
	assert_eq(spawner.chain.tier(), 0, "a wrong answer drops the chain one tier")
	assert_false(spawner.is_unscrambled, "a wrong answer never ends the fight")
	assert_true(
		spawner.hint_text.contains("3") and spawner.hint_text.contains("4"),
		"the hint restates the problem"
	)
	assert_gt(spawner.hint_chip_seconds, 0.0, "the hint chip has a duration")
	assert_lt(machine.telegraph_remaining(), remaining, "the Muddler attacks sooner")


func test_the_chain_never_drops_below_zero_and_charges_the_finisher() -> void:
	var chain: Chain = Chain.new()
	chain.raise()
	chain.raise()
	assert_eq(chain.tier(), 2)
	assert_gt(chain.shard_multiplier(), 1.0)
	for _step: int in 8:
		chain.drop()
	assert_eq(chain.tier(), 0, "a wrong answer never ends the fight")
	assert_almost_eq(chain.shard_multiplier(), 1.0, EPSILON)
	var finisher: Finisher = Finisher.new()
	assert_false(finisher.is_ready())
	finisher.add(finisher.threshold)
	assert_true(finisher.is_ready())
	assert_almost_eq(finisher.progress(), 1.0, EPSILON)
	assert_true(finisher.trigger(), "a full finisher fires")
	assert_false(finisher.trigger(), "an empty finisher cannot fire twice")
	assert_almost_eq(finisher.charge, 0.0, EPSILON)


func test_the_validator_accepts_the_shipped_data_and_rejects_a_flat_chain() -> void:
	var accepted: String = _run_validator(ProjectSettings.globalize_path("res://"))
	assert_true(accepted.strip_edges().is_empty(), "the shipped data must pass: %s" % accepted)
	var flat: Dictionary = {
		"version": 1,
		"startTier": 0,
		"finisherThreshold": 3.0,
		"tiers":
		[
			{"shardMultiplier": 2.0, "finisherCharge": 1.0},
			{"shardMultiplier": 1.0, "finisherCharge": 1.0},
		],
	}
	var rejected: String = _run_validator(_probe_root(flat))
	assert_true(rejected.contains("must rise above"), rejected)


func _spawner() -> OrbSpawner:
	var spawner: OrbSpawner = OrbSpawner.new(Rng.new(7))
	add_child_autofree(spawner)
	return spawner


func _orb_with(spawner: OrbSpawner, correct: bool) -> AnswerOrb:
	for orb: AnswerOrb in spawner.orbs:
		if orb.is_correct == correct:
			return orb
	return null


func _run_to_telegraph(machine: EnemyStateMachine) -> void:
	for _step: int in 16:
		if machine.state == EnemyStateMachine.State.TELEGRAPH:
			return
		machine.advance(machine.duration_for(machine.state) + EPSILON)


func _json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert_true(parsed is Dictionary, "%s must decode to an object" % path)
	return parsed as Dictionary


func _run_validator(root: String) -> String:
	var output: Array = []
	var arguments: PackedStringArray = PackedStringArray(["-c", VALIDATOR_CODE, root])
	var exit_code: int = OS.execute("python3", arguments, output, true)
	assert_eq(exit_code, 0, "the orbs_chain validator must run: %s" % [output])
	return "\n".join(PackedStringArray(output))


func _probe_root(chain: Dictionary) -> String:
	var root: String = ProjectSettings.globalize_path("user://").path_join("orb_probe")
	root = root.path_join("run_%d" % Time.get_ticks_usec())
	var path: String = root.path_join("data/combat/chain.json")
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "could not write %s" % path)
	if file != null:
		file.store_string(JSON.stringify(chain, "  "))
		file.close()
	_temp_dirs.append(root)
	return root


func _remove_tree(dir_path: String) -> void:
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		return
	for entry: String in dir.get_files():
		DirAccess.remove_absolute(dir_path.path_join(entry))
	for entry: String in dir.get_directories():
		_remove_tree(dir_path.path_join(entry))
	DirAccess.remove_absolute(dir_path)
