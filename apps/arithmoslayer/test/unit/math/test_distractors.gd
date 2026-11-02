extends GutTest
## Property tests for distractor generation.
##
## Every band runs 10,000 seeds so a rare problem cannot slip past the
## distinctness, non-negativity, and error-model coverage rules.

const BANDS_PATH: String = "res://data/curriculum/bands.json"
const DISTRACTORS_SCRIPT: String = "res://scripts/core/math/distractors.gd"
const SEEDS_PER_BAND: int = 10000
const SAMPLE_LIMIT: int = 5
const MAX_DISTRACTORS: int = 3
const MODELS: Array[String] = [
	"off_by_one",
	"off_by_ten",
	"wrong_operation",
	"missed_carry_or_borrow",
	"neighboring_table_fact",
	"transposed_digits",
]


func test_the_distractor_builder_is_plain_refcounted_logic() -> void:
	assert_true(FileAccess.file_exists(DISTRACTORS_SCRIPT), "distractors.gd must exist")
	var builder: Distractors = Distractors.new(Rng.new(1))
	assert_true(builder is RefCounted, "the builder is a plain RefCounted object")
	var instance: Object = builder
	assert_false(instance is Node, "the builder must not depend on the scene tree")
	var problem: Dictionary = {"operation": "addition", "a": 3, "b": 4, "answer": 7}
	assert_eq(builder.generate(problem).size(), MAX_DISTRACTORS, "three distractors fit")


func test_an_unknown_problem_yields_no_distractors() -> void:
	var builder: Distractors = Distractors.new(Rng.new(1))
	assert_true(builder.generate({}).is_empty(), "an empty problem has no distractors")
	assert_true(
		builder.generate({"operation": "power", "a": 2, "b": 3, "answer": 8}).is_empty(),
		"an unknown operation has no distractors",
	)


func test_the_count_is_clamped_to_three() -> void:
	var builder: Distractors = Distractors.new(Rng.new(2))
	var problem: Dictionary = {"operation": "multiplication", "a": 6, "b": 7, "answer": 42}
	assert_eq(builder.generate(problem, 0).size(), 0, "a zero count yields nothing")
	assert_eq(builder.generate(problem, 9).size(), MAX_DISTRACTORS, "at most three distractors")


func test_the_same_seed_replays_the_same_distractors() -> void:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", "<missing>"))
		for seed_value: int in [0, 1, 42, 9999]:
			var first: Array[Dictionary] = _distractors_for(band, seed_value)
			var second: Array[Dictionary] = _distractors_for(band, seed_value)
			assert_eq(
				first, second, "%s seed %d must replay the same distractors" % [band_id, seed_value]
			)


func test_addition_models_propose_the_error_they_name() -> void:
	var found: Dictionary = _collect_models(
		{"operation": "addition", "a": 28, "b": 15, "answer": 43}
	)
	assert_true(absi(int(found.get("off_by_one", -1)) - 43) == 1, "off by one")
	assert_true(absi(int(found.get("off_by_ten", -1)) - 43) == 10, "off by ten")
	assert_eq(int(found.get("wrong_operation", -1)), 13, "subtracted instead of added")
	assert_eq(int(found.get("missed_carry_or_borrow", -1)), 33, "forgot the carry")
	assert_eq(int(found.get("transposed_digits", -1)), 34, "swapped the digits")
	assert_false(found.has("neighboring_table_fact"), "addition has no table fact")


func test_subtraction_models_propose_the_error_they_name() -> void:
	var found: Dictionary = _collect_models(
		{"operation": "subtraction", "a": 32, "b": 15, "answer": 17}
	)
	assert_true(absi(int(found.get("off_by_one", -1)) - 17) == 1, "off by one")
	assert_true(absi(int(found.get("off_by_ten", -1)) - 17) == 10, "off by ten")
	assert_eq(int(found.get("wrong_operation", -1)), 47, "added instead of subtracted")
	assert_eq(int(found.get("missed_carry_or_borrow", -1)), 27, "forgot the borrow")
	assert_eq(int(found.get("transposed_digits", -1)), 71, "swapped the digits")
	assert_false(found.has("neighboring_table_fact"), "subtraction has no table fact")


func test_multiplication_models_propose_the_error_they_name() -> void:
	var found: Dictionary = _collect_models(
		{"operation": "multiplication", "a": 6, "b": 7, "answer": 42}
	)
	assert_true(absi(int(found.get("off_by_one", -1)) - 42) == 1, "off by one")
	assert_true(absi(int(found.get("off_by_ten", -1)) - 42) == 10, "off by ten")
	assert_eq(int(found.get("wrong_operation", -1)), 13, "added instead of multiplied")
	var neighbor_delta: int = absi(int(found.get("neighboring_table_fact", -1)) - 42)
	assert_true(neighbor_delta == 6 or neighbor_delta == 7, "a neighbouring factor")
	assert_eq(int(found.get("transposed_digits", -1)), 24, "swapped the digits")
	assert_false(found.has("missed_carry_or_borrow"), "multiplication has no carry")


func test_division_models_propose_the_error_they_name() -> void:
	var found: Dictionary = _collect_models({"operation": "division", "a": 24, "b": 4, "answer": 6})
	assert_true(absi(int(found.get("off_by_one", -1)) - 6) == 1, "off by one")
	assert_true(absi(int(found.get("off_by_ten", -1)) - 6) == 10, "off by ten")
	assert_eq(int(found.get("wrong_operation", -1)), 96, "multiplied instead of divided")
	assert_true(absi(int(found.get("neighboring_table_fact", -1)) - 6) == 1, "a neighbouring fact")
	assert_false(found.has("transposed_digits"), "a one-digit answer cannot transpose")
	assert_false(found.has("missed_carry_or_borrow"), "division has no carry")


func test_every_band_holds_its_distractor_rules_for_ten_thousand_seeds() -> void:
	var bands: Array = _bands().get("bands", [])
	assert_eq(bands.size(), 15, "every curriculum band is covered")
	for band_value: Variant in bands:
		_assert_band_property(band_value as Dictionary)


func _assert_band_property(band: Dictionary) -> void:
	var band_id: String = String(band.get("id", "<missing>"))
	var failures: Array[String] = []
	var seen: Dictionary = {}
	var problem_rng: Rng = Rng.new(0)
	var generator: ProblemGenerator = ProblemGenerator.new(problem_rng)
	var distractor_rng: Rng = Rng.new(0)
	var builder: Distractors = Distractors.new(distractor_rng)
	for seed_value: int in SEEDS_PER_BAND:
		problem_rng.set_seed(seed_value)
		var problem: Dictionary = generator.generate(band)
		if problem.is_empty():
			_record(failures, "seed %d produced no problem" % seed_value)
			continue
		distractor_rng.set_seed(seed_value)
		var distractors: Array[Dictionary] = builder.generate(problem)
		var answer: int = int(problem.get("answer", -1))
		if distractors.size() > MAX_DISTRACTORS:
			_record(failures, "seed %d returned %d distractors" % [seed_value, distractors.size()])
		if distractors.is_empty():
			_record(failures, "seed %d returned no distractor" % seed_value)
		var values: Dictionary = {}
		for distractor_value: Variant in distractors:
			var distractor: Dictionary = distractor_value
			var value: int = int(distractor.get("value", -1))
			var model: String = String(distractor.get("model", ""))
			if not MODELS.has(model):
				_record(failures, "seed %d has unknown model '%s'" % [seed_value, model])
			if value < 0:
				_record(failures, "seed %d has negative distractor %d" % [seed_value, value])
			if value == answer:
				_record(failures, "seed %d distractor equals answer %d" % [seed_value, answer])
			if values.has(value):
				_record(failures, "seed %d repeats distractor %d" % [seed_value, value])
			values[value] = true
			seen[model] = true
	assert_eq(failures.size(), 0, "%s: %s" % [band_id, "\n".join(failures)])
	for model: String in _applicable_models(band):
		assert_true(seen.has(model), "%s never produced model '%s'" % [band_id, model])


## Returns the error models a band can exercise. A no-carry band never crosses
## a ten boundary, so the missed carry or borrow model does not apply to it.
func _applicable_models(band: Dictionary) -> Array[String]:
	var models: Array[String] = ["off_by_one", "off_by_ten", "wrong_operation", "transposed_digits"]
	var operations: Dictionary = band.get("operations", {})
	if operations.has("multiplication") or operations.has("division"):
		models.append("neighboring_table_fact")
	if (
		(operations.has("addition") or operations.has("subtraction"))
		and band.get("crossesTens", true) != false
	):
		models.append("missed_carry_or_borrow")
	return models


func _distractors_for(band: Dictionary, seed_value: int) -> Array[Dictionary]:
	var problem: Dictionary = ProblemGenerator.new(Rng.new(seed_value)).generate(band)
	var builder: Distractors = Distractors.new(Rng.new(seed_value))
	return builder.generate(problem)


## Returns the first value each model proposes for [param problem] across seeds.
func _collect_models(problem: Dictionary) -> Dictionary:
	var found: Dictionary = {}
	for seed_value: int in 256:
		var builder: Distractors = Distractors.new(Rng.new(seed_value))
		for distractor_value: Variant in builder.generate(problem):
			var distractor: Dictionary = distractor_value
			var model: String = String(distractor.get("model", ""))
			if not found.has(model):
				found[model] = int(distractor.get("value", -1))
	return found


func _record(failures: Array[String], message: String) -> void:
	if failures.size() < SAMPLE_LIMIT:
		failures.append(message)


func _bands() -> Dictionary:
	var file: FileAccess = FileAccess.open(BANDS_PATH, FileAccess.READ)
	assert_not_null(file, "bands.json must exist")
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	assert_true(parsed is Dictionary, "bands.json must decode to an object")
	if not (parsed is Dictionary):
		return {}
	return parsed as Dictionary
