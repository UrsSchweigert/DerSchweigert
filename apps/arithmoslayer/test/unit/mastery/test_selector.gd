extends GutTest
## Guards the adaptive selector and data/session/selection.json.

const BANDS_PATH: String = "res://data/curriculum/bands.json"
const SELECTION_PATH: String = "res://data/session/selection.json"


func test_the_real_selection_file_declares_the_knobs() -> void:
	var config: Dictionary = Selector.load_config(SELECTION_PATH)
	assert_eq(int(config.get("version", 0)), 1, "selection.json declares version 1")
	assert_eq(float(config.get("targetAccuracy", 0.0)), 0.8)
	assert_eq(int(config.get("windowSize", 0)), 20)
	assert_eq(float(config.get("masteryThreshold", 0.0)), 0.75)
	assert_true(bool(config.get("interleaveOperations", false)), "operations are interleaved")
	assert_eq(config.get("weights", {}).keys(), ["new", "review", "challenge"])


func test_the_selector_is_plain_refcounted_logic() -> void:
	var selector: Selector = _selector(1, MasteryModel.new())
	assert_true(selector is RefCounted, "the selector is a plain RefCounted object")


func test_only_bands_with_mastered_prerequisites_are_unlocked() -> void:
	var model: MasteryModel = MasteryModel.new()
	var selector: Selector = _selector(1, model)
	var unlocked: Array[String] = selector.unlocked_band_ids()
	assert_true(unlocked.has("g1-within-10"), "the entry band is always unlocked")
	assert_false(unlocked.has("g1-within-20-no-carry"), "an unmastered prerequisite stays locked")
	for _attempt: int in 9:
		model.record("g1-within-10", true, 500)
	unlocked = selector.unlocked_band_ids()
	assert_true(unlocked.has("g1-within-20-no-carry"), "mastery unlocks the next band")


func test_recent_accuracy_counts_the_last_window() -> void:
	var selector: Selector = _selector(1, MasteryModel.new())
	for index: int in 20:
		selector.record_result(index % 5 != 0)
	assert_eq(selector.recent_accuracy(), 16.0 / 20.0, "16 of the last 20 were correct")


func test_the_mix_nudges_toward_the_target_accuracy() -> void:
	var model: MasteryModel = MasteryModel.new()
	var selector: Selector = _selector(1, model)
	var base: Dictionary = selector.effective_weights()
	for _attempt: int in 20:
		selector.record_result(true)
	var confident: Dictionary = selector.effective_weights()
	assert_gt(
		float(confident["challenge"]), float(base["challenge"]), "doing well raises challenge"
	)
	var struggling: Selector = _selector(1, MasteryModel.new())
	for _attempt: int in 20:
		struggling.record_result(false)
	var easing: Dictionary = struggling.effective_weights()
	assert_lt(float(easing["challenge"]), float(base["challenge"]), "struggling lowers challenge")


func test_select_mixes_new_review_and_challenge_bands() -> void:
	var model: MasteryModel = MasteryModel.new()
	_master(model, "entry")
	model.record("step", false, 500)
	var selector: Selector = Selector.new(
		Rng.new(11), ProblemGenerator.new(Rng.new(11)), model, _three_bands()
	)
	var seen: Dictionary = {}
	for _attempt: int in 200:
		var pick: Dictionary = selector.select()
		assert_false(pick.is_empty(), "an unlocked band always yields a problem")
		seen[String(pick.get("category", ""))] = true
	assert_true(seen.has("new"), "the mix draws new bands")
	assert_true(seen.has("review"), "the mix draws review bands")
	assert_true(seen.has("challenge"), "the mix draws challenge bands")


func test_select_interleaves_operations() -> void:
	var bands: Array[Dictionary] = [_band("plus", "addition"), _band("times", "multiplication")]
	var selector: Selector = Selector.new(
		Rng.new(5), ProblemGenerator.new(Rng.new(5)), MasteryModel.new(), bands
	)
	var last: String = ""
	var seen_operations: Dictionary = {}
	for _attempt: int in 40:
		var pick: Dictionary = selector.select()
		var operation: String = String(pick.get("problem", {}).get("operation", ""))
		seen_operations[operation] = true
		if last != "":
			assert_ne(operation, last, "consecutive picks interleave operations")
		last = operation
	assert_true(seen_operations.size() > 1, "more than one operation appears")


func test_replaying_the_same_seed_yields_the_same_sequence() -> void:
	var model: MasteryModel = MasteryModel.new()
	_master(model, "entry")
	var first: Array[Dictionary] = _run(_selector_with(42, model, _three_bands()), 30)
	var second: Array[Dictionary] = _run(_selector_with(42, model, _three_bands()), 30)
	assert_eq(first, second, "the same seed replays the same selection sequence")


func _run(selector: Selector, count: int) -> Array[Dictionary]:
	var picks: Array[Dictionary] = []
	for _attempt: int in count:
		picks.append(selector.select())
	return picks


func _master(model: MasteryModel, band_id: String) -> void:
	for _attempt: int in 10:
		model.record(band_id, true, 400)


func _band(band_id: String, operation: String) -> Dictionary:
	var maximum: int = 10 if operation == "addition" else 25
	return {
		"id": band_id,
		"grade": 1,
		"island": "grade-1",
		"operations": {operation: {"a": {"min": 1, "max": 5}, "b": {"min": 1, "max": 5}}},
		"maxResult": maximum,
		"answerFormat": "numeric",
		"prerequisites": [],
	}


func _three_bands() -> Array[Dictionary]:
	var step: Dictionary = _band("step", "addition")
	step["prerequisites"] = ["entry"]
	var top: Dictionary = _band("top", "multiplication")
	top["prerequisites"] = ["entry"]
	return [_band("entry", "addition"), step, top]


func _selector(seed: int, model: MasteryModel) -> Selector:
	return _selector_with(seed, model, _bands())


func _selector_with(seed: int, model: MasteryModel, bands: Array) -> Selector:
	return Selector.new(Rng.new(seed), ProblemGenerator.new(Rng.new(seed)), model, bands)


func _bands() -> Array:
	var file: FileAccess = FileAccess.open(BANDS_PATH, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return (parsed as Dictionary).get("bands", [])
