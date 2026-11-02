extends GutTest
## Guards data/curriculum/bands.json and tools/validate/curriculum.py.

const BANDS_PATH: String = "res://data/curriculum/bands.json"
const VALIDATE_TOOL: String = "tools/validate_data.py"
const BANDS_RELATIVE: String = "data/curriculum/bands.json"
const EXPECTED_BANDS: Dictionary = {
	"g1-within-10": 1,
	"g1-within-20-no-carry": 1,
	"g1-within-20-carry": 1,
	"g2-within-100-no-carry": 2,
	"g2-within-100-carry": 2,
	"g2-tables-2-5-10": 2,
	"g2-tables-3-4-division": 2,
	"g3-within-1000": 3,
	"g3-tables-to-10": 3,
	"g3-division-facts": 3,
	"g3-multiples-of-ten": 3,
	"g4-within-10000": 4,
	"g4-two-digit-by-one-digit": 4,
	"g4-three-digit-by-one-digit-division": 4,
	"g4-mixed-review": 4,
}

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_bands_file_holds_one_band_per_skill() -> void:
	var data: Dictionary = _bands()
	assert_eq(int(data.get("version", 0)), 1, "bands.json must declare version 1")
	var bands: Array = data.get("bands", [])
	assert_eq(bands.size(), EXPECTED_BANDS.size(), "one band per illustrative skill")
	var found: Dictionary = {}
	for band_value: Variant in bands:
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", ""))
		assert_false(found.has(band_id), "duplicate band id %s" % band_id)
		found[band_id] = int(band.get("grade", 0))
	for band_id: String in EXPECTED_BANDS:
		assert_true(found.has(band_id), "missing band %s" % band_id)
		if found.has(band_id):
			assert_eq(int(found[band_id]), int(EXPECTED_BANDS[band_id]), "%s grade" % band_id)
	var islands: Array = data.get("islands", [])
	assert_eq(islands.size(), 4, "one island per grade")
	var grades: PackedInt32Array = PackedInt32Array()
	for island_value: Variant in islands:
		grades.append(int((island_value as Dictionary).get("grade", 0)))
	grades.sort()
	assert_eq(grades, PackedInt32Array([1, 2, 3, 4]), "islands cover grades 1 to 4")


func test_every_band_declares_operands_and_safety_rules() -> void:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", "<missing>"))
		for field: String in ["operations", "maxResult", "answerFormat", "prerequisites", "island"]:
			assert_true(band.has(field), "%s is missing %s" % [band_id, field])
		var operations: Dictionary = band.get("operations", {})
		assert_true(operations.size() > 0, "%s must declare an operation" % band_id)
		for operation: String in operations:
			var operands: Dictionary = operations[operation]
			assert_true(
				operands.has("a") and operands.has("b"), "%s %s operands" % [band_id, operation]
			)
		if operations.has("subtraction"):
			assert_true(
				bool(band.get("noNegativeResults", false)), "%s forbids negatives" % band_id
			)
		if operations.has("division"):
			assert_true(bool(band.get("exactDivision", false)), "%s is exact" % band_id)


func test_the_real_project_passes_validation() -> void:
	var result: Dictionary = _run_python([VALIDATE_TOOL])
	assert_eq(int(result["exit_code"]), 0, "the project must validate: %s" % result["output"])
	assert_true(String(result["output"]).contains("curriculum"), result["output"])


func test_rejects_an_unknown_prerequisite() -> void:
	var band: Dictionary = _band()
	band["prerequisites"] = ["g1-missing"]
	_assert_rejected("unknown_prerequisite", band, "unknown prerequisite 'g1-missing'")


func test_rejects_an_invalid_island_assignment() -> void:
	var band: Dictionary = _band()
	band["island"] = "grade-9"
	_assert_rejected("invalid_island", band, "unknown island 'grade-9'")


func test_rejects_a_missing_required_field() -> void:
	var band: Dictionary = _band()
	band.erase("answerFormat")
	_assert_rejected("missing_field", band, "missing required field (field 'answerFormat')")


func test_rejects_subtraction_without_the_non_negative_rule() -> void:
	var band: Dictionary = _band()
	band["operations"] = {"subtraction": {"a": {"min": 1, "max": 5}, "b": {"min": 1, "max": 5}}}
	_assert_rejected("negative_subtraction", band, "noNegativeResults")


func test_rejects_division_without_the_exact_rule() -> void:
	var band: Dictionary = _band()
	band["operations"] = {"division": {"a": {"min": 2, "max": 100}, "b": {"min": 2, "max": 10}}}
	_assert_rejected("inexact_division", band, "exactDivision")


func test_rejects_an_invalid_free_entry_threshold() -> void:
	for invalid: Variant in [0, 1.5, true]:
		var band: Dictionary = _band()
		band["freeEntryMastery"] = invalid
		_assert_rejected(
			"invalid_free_entry_%s" % str(invalid),
			band,
			"freeEntryMastery must be a number in (0, 1]",
		)


func _assert_rejected(label: String, band: Dictionary, expected: String) -> void:
	var result: Dictionary = _run_validate(_make_project(label, band))
	assert_ne(int(result["exit_code"]), 0, "%s must fail validation" % label)
	assert_true(String(result["output"]).contains(expected), result["output"])


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


func _band() -> Dictionary:
	return {
		"id": "g1-within-10",
		"grade": 1,
		"island": "grade-1",
		"operations": {"addition": {"a": {"min": 1, "max": 5}, "b": {"min": 1, "max": 5}}},
		"maxResult": 10,
		"answerFormat": "multiple_choice",
		"prerequisites": [],
	}


func _make_project(label: String, band: Dictionary) -> String:
	var root: String = _make_temp_dir(label)
	var document: Dictionary = {
		"version": 1,
		"islands": [{"id": "grade-1", "name": "Sunny Shore", "grade": 1}],
		"bands": [band],
	}
	_write_text(root.path_join(BANDS_RELATIVE), JSON.stringify(document))
	return root


func _run_validate(root: String) -> Dictionary:
	return _run_python([VALIDATE_TOOL, "--root", root])


func _run_python(arguments: Array) -> Dictionary:
	var output: Array = []
	var exit_code: int = OS.execute("python3", PackedStringArray(arguments), output, true)
	var lines: PackedStringArray = PackedStringArray()
	for line: String in output:
		lines.append(str(line))
	return {"exit_code": exit_code, "output": "\n".join(lines)}


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("curriculum_probe")
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
