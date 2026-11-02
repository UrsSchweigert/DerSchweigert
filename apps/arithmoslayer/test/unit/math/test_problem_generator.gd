extends GutTest
## Property tests for the seedable problem generator.
##
## Every band in [code]data/curriculum/bands.json[/code] runs 10,000 seeds so a
## rare draw cannot slip past the operation, range, and safety rules.

const BANDS_PATH: String = "res://data/curriculum/bands.json"
const GENERATOR_SCRIPT: String = "res://scripts/core/math/problem_generator.gd"
const SEEDS_PER_BAND: int = 10000
const SAMPLE_LIMIT: int = 5
const MIN_DISTINCT_ANSWERS: int = 5
const CARRY_OPERATIONS: Array[String] = ["addition", "subtraction"]


func test_the_generator_is_plain_refcounted_logic() -> void:
	assert_true(FileAccess.file_exists(GENERATOR_SCRIPT), "problem_generator.gd must exist")
	var generator: ProblemGenerator = ProblemGenerator.new(Rng.new(1))
	assert_true(generator is RefCounted, "the generator is a plain RefCounted object")
	var instance: Object = generator
	assert_false(instance is Node, "the generator must not depend on the scene tree")
	var problem: Dictionary = generator.generate(_band("g1-within-10"))
	assert_false(problem.is_empty(), "a band with operations must yield a problem")


func test_a_band_without_operations_yields_no_problem() -> void:
	var generator: ProblemGenerator = ProblemGenerator.new(Rng.new(3))
	assert_true(generator.generate({}).is_empty(), "an empty band cannot be generated")
	var band: Dictionary = {"id": "empty", "operations": {}, "maxResult": 10}
	assert_true(
		generator.generate(band).is_empty(), "a band without operations cannot be generated"
	)


func test_every_band_holds_its_invariants_for_ten_thousand_seeds() -> void:
	var bands: Array = _bands().get("bands", [])
	assert_eq(bands.size(), 15, "every curriculum band is covered")
	for band_value: Variant in bands:
		var band: Dictionary = band_value
		_assert_band_property(band)


func test_the_same_seed_replays_the_same_problem() -> void:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", "<missing>"))
		for seed_value: int in [0, 1, 42, 9999]:
			var first: Dictionary = ProblemGenerator.new(Rng.new(seed_value)).generate(band)
			var second: Dictionary = ProblemGenerator.new(Rng.new(seed_value)).generate(band)
			assert_eq(
				first, second, "%s seed %d must replay the same problem" % [band_id, seed_value]
			)


func test_different_seeds_explore_the_band() -> void:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", "<missing>"))
		var rng: Rng = Rng.new(0)
		var generator: ProblemGenerator = ProblemGenerator.new(rng)
		var problems: Dictionary = {}
		for seed_value: int in 64:
			rng.set_seed(seed_value)
			problems[str(generator.generate(band))] = true
		assert_true(
			problems.size() > 1, "%s must produce more than one problem across seeds" % band_id
		)


func _assert_band_property(band: Dictionary) -> void:
	var band_id: String = String(band.get("id", "<missing>"))
	var declared: Dictionary = band.get("operations", {})
	var seen: Dictionary = {}
	var answers: Dictionary = {}
	var failures: Array[String] = []
	var rng: Rng = Rng.new(0)
	var generator: ProblemGenerator = ProblemGenerator.new(rng)
	for seed_value: int in SEEDS_PER_BAND:
		rng.set_seed(seed_value)
		var problem: Dictionary = generator.generate(band)
		if problem.is_empty():
			_record(failures, "seed %d produced no problem" % seed_value)
			continue
		seen[String(problem.get("operation", ""))] = true
		answers[int(problem.get("answer", -1))] = true
		var complaint: String = _check_problem(band, problem)
		if complaint != "":
			_record(failures, "seed %d: %s" % [seed_value, complaint])
	assert_eq(failures.size(), 0, "%s: %s" % [band_id, "\n".join(failures)])
	for operation: String in declared:
		assert_true(seen.has(operation), "%s never generated %s" % [band_id, operation])
	assert_true(
		answers.size() >= MIN_DISTINCT_ANSWERS,
		"%s produced only %d distinct answers" % [band_id, answers.size()],
	)


## Returns an empty string when [param problem] obeys every rule of
## [param band], otherwise a one-line description of the first broken rule.
func _check_problem(band: Dictionary, problem: Dictionary) -> String:
	var operation: String = String(problem.get("operation", ""))
	var declared: Dictionary = band.get("operations", {})
	var operands: Dictionary = declared.get(operation, {})
	var a: int = int(problem.get("a", -1))
	var b: int = int(problem.get("b", -1))
	var answer: int = int(problem.get("answer", -1))
	var max_result: int = int(band.get("maxResult", 0))
	var expected: int = _expected_answer(operation, a, b)
	var complaint: String = ""
	if not declared.has(operation):
		complaint = "operation '%s' is not declared by the band" % operation
	elif not _in_pool(operands.get("a", {}), a):
		complaint = "a=%d is outside the band's a range" % a
	elif not _in_pool(operands.get("b", {}), b):
		complaint = "b=%d is outside the band's b range" % b
	elif answer < 0:
		complaint = "answer %d is negative" % answer
	elif answer > max_result:
		complaint = "answer %d exceeds maxResult %d" % [answer, max_result]
	elif expected != answer:
		complaint = "%s %d and %d has answer %d, expected %d" % [operation, a, b, answer, expected]
	elif CARRY_OPERATIONS.has(operation) and band.get("crossesTens") is bool:
		var wanted: bool = bool(band["crossesTens"])
		var actual: bool = _crosses_ten(operation, a, b)
		if actual != wanted:
			complaint = (
				"%s %d and %d crosses a ten boundary: %s, band wants %s"
				% [operation, a, b, actual, wanted]
			)
	return complaint


func _expected_answer(operation: String, a: int, b: int) -> int:
	match operation:
		"addition":
			return a + b
		"subtraction":
			return a - b if a >= b else -1
		"multiplication":
			return a * b
		"division":
			return a / b if b > 0 and a % b == 0 else -1
	return -1


func _crosses_ten(operation: String, a: int, b: int) -> bool:
	if operation == "addition":
		return posmod(a, 10) + posmod(b, 10) >= 10
	return posmod(a, 10) < posmod(b, 10)


func _in_pool(spec: Variant, value: int) -> bool:
	if not (spec is Dictionary):
		return false
	var pool: Dictionary = spec
	if pool.has("values"):
		for candidate: Variant in pool["values"]:
			if int(candidate) == value:
				return true
		return false
	return value >= int(pool.get("min", 0)) and value <= int(pool.get("max", 0))


func _record(failures: Array[String], message: String) -> void:
	if failures.size() < SAMPLE_LIMIT:
		failures.append(message)


func _band(band_id: String) -> Dictionary:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		if String(band.get("id", "")) == band_id:
			return band
	return {}


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
