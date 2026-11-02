extends GutTest
## Guards the band-defined answer mode and the free-entry input model.

const BANDS_PATH: String = "res://data/curriculum/bands.json"


func test_numeric_bands_always_use_free_entry() -> void:
	var mode: AnswerMode = AnswerMode.new()
	var band: Dictionary = {"answerFormat": "numeric"}
	for mastery: float in [0.0, 0.5, 1.0]:
		var resolved: Dictionary = mode.resolve(band, mastery)
		assert_eq(String(resolved.get("kind", "")), AnswerMode.KIND_NUMERIC)
		assert_eq(int(resolved.get("orbs", -1)), 0)


func test_multiple_choice_bands_start_with_orbs() -> void:
	var mode: AnswerMode = AnswerMode.new()
	var band: Dictionary = {"answerFormat": "multiple_choice"}
	var resolved: Dictionary = mode.resolve(band, 0.0)
	assert_eq(String(resolved.get("kind", "")), AnswerMode.KIND_ORBS)
	assert_eq(int(resolved.get("orbs", 0)), 4)


func test_orbs_are_clamped_between_two_and_four() -> void:
	var mode: AnswerMode = AnswerMode.new()
	assert_eq(mode.orb_count(0), 2, "a band always shows at least two orbs")
	assert_eq(mode.orb_count(1), 2)
	assert_eq(mode.orb_count(2), 3)
	assert_eq(mode.orb_count(3), 4)
	assert_eq(mode.orb_count(9), 4, "a band never shows more than four orbs")


func test_mastery_switches_multiple_choice_to_free_entry() -> void:
	var mode: AnswerMode = AnswerMode.new()
	var band: Dictionary = {"answerFormat": "multiple_choice", "freeEntryMastery": 0.6}
	assert_eq(String(mode.resolve(band, 0.59).get("kind")), AnswerMode.KIND_ORBS)
	assert_eq(String(mode.resolve(band, 0.6).get("kind")), AnswerMode.KIND_NUMERIC)
	assert_eq(String(mode.resolve(band, 0.99).get("kind")), AnswerMode.KIND_NUMERIC)


func test_the_default_threshold_is_three_quarters() -> void:
	var mode: AnswerMode = AnswerMode.new()
	var band: Dictionary = {"answerFormat": "multiple_choice"}
	assert_eq(mode.free_entry_mastery(band), 0.75)
	assert_eq(String(mode.resolve(band, 0.74).get("kind")), AnswerMode.KIND_ORBS)
	assert_eq(String(mode.resolve(band, 0.75).get("kind")), AnswerMode.KIND_NUMERIC)


func test_the_real_bands_define_their_mode_and_threshold() -> void:
	for band_value: Variant in _bands().get("bands", []):
		var band: Dictionary = band_value
		var band_id: String = String(band.get("id", "<missing>"))
		var mode: AnswerMode = AnswerMode.new()
		var start: Dictionary = mode.resolve(band, 0.0, 3)
		var finish: Dictionary = mode.resolve(band, 1.0, 3)
		if String(band.get("answerFormat", "")) == AnswerMode.MULTIPLE_CHOICE:
			assert_eq(String(start.get("kind", "")), AnswerMode.KIND_ORBS, band_id)
			assert_true(band.has("freeEntryMastery"), "%s declares a threshold" % band_id)
			var threshold: float = mode.free_entry_mastery(band)
			assert_true(threshold > 0.0 and threshold <= 1.0, "%s threshold is in (0, 1]" % band_id)
		else:
			assert_eq(String(start.get("kind", "")), AnswerMode.KIND_NUMERIC, band_id)
		assert_eq(String(finish.get("kind", "")), AnswerMode.KIND_NUMERIC, band_id)


func test_numeric_entry_rejects_non_numeric_input() -> void:
	var entry: AnswerMode.NumericEntry = AnswerMode.NumericEntry.new()
	for character: String in ["a", "", " ", "-", "+", "1.5", "١"]:
		assert_false(entry.push(character), "must reject %s" % character)
	assert_eq(entry.text(), "", "rejected input leaves the entry empty")
	assert_true(entry.push("7"), "a decimal digit is accepted")
	assert_eq(entry.text(), "7")


func test_numeric_entry_stops_at_five_digits() -> void:
	var entry: AnswerMode.NumericEntry = AnswerMode.NumericEntry.new()
	for character: String in ["1", "2", "3", "4", "5"]:
		assert_true(entry.push(character), "the first five digits are accepted")
	assert_true(entry.is_full())
	assert_false(entry.push("6"), "a sixth digit is rejected")
	assert_eq(entry.text(), "12345")
	assert_eq(entry.confirm(), 12345)


func test_numeric_entry_supports_delete_and_confirm() -> void:
	var entry: AnswerMode.NumericEntry = AnswerMode.NumericEntry.new()
	assert_eq(entry.confirm(), -1, "an empty entry has no value")
	assert_false(entry.delete(), "delete on an empty entry is a no-op")
	assert_true(entry.push("4"))
	assert_true(entry.push("2"))
	assert_true(entry.delete(), "delete removes the last digit")
	assert_eq(entry.text(), "4")
	assert_eq(entry.confirm(), 4)
	entry.clear()
	assert_true(entry.is_empty(), "clear removes every digit")


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
