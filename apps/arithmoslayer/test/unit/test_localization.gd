extends GutTest
## Guards the translation table, the localization autoload, and the shell text.

const TABLE_PATH: String = "res://data/i18n/strings.csv"
const MAIN_SCENE_PATH: String = "res://scenes/main.tscn"
const MAIN_SCRIPT_PATH: String = "res://scripts/main.gd"
const VALIDATE_TOOL: String = "tools/validate_data.py"
const COLUMN_COUNT: int = 3
const COLUMN_NAMES: Array[String] = ["key", "en", "de"]
const ENGLISH_TAGLINE: String = "Slice the numbers. Master the math."
const GERMAN_TAGLINE: String = "Zerschneide die Zahlen. Meistere die Mathematik."

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()
	var localization: Node = get_node_or_null("/root/Localization")
	if localization != null:
		localization.select_locale(OS.get_locale())


func test_table_header_has_key_en_de_columns() -> void:
	var rows: Array[PackedStringArray] = _read_rows(TABLE_PATH)
	assert_gt(rows.size(), 1, "the table must contain at least one translation")
	if rows.is_empty():
		return
	assert_eq(rows[0].size(), COLUMN_COUNT, "the header must have key,en,de")
	assert_eq(",".join(rows[0]), "key,en,de")


func test_every_row_has_english_and_german() -> void:
	var rows: Array[PackedStringArray] = _read_rows(TABLE_PATH)
	for index: int in range(1, rows.size()):
		var row: PackedStringArray = rows[index]
		assert_eq(row.size(), COLUMN_COUNT, "row %d must have key,en,de" % index)
		if row.size() != COLUMN_COUNT:
			continue
		for column: int in range(1, COLUMN_COUNT):
			assert_false(
				row[column].strip_edges().is_empty(),
				"row %d (key '%s') is missing %s" % [index, row[0], COLUMN_NAMES[column]],
			)


func test_english_and_german_key_sets_match() -> void:
	var localization: Node = get_node("/root/Localization")
	assert_eq(
		localization.keys_for_locale(&"en"),
		localization.keys_for_locale(&"de"),
		"the English and German key sets must match",
	)


func test_table_reports_a_missing_translation() -> void:
	var path: String = _write_temp_file("missing_de.csv", "key,en,de\napp.title,Arithmo Slayer,\n")
	var table: LocalizationTable = LocalizationTable.new()
	assert_eq(table.load_csv(path), OK)
	assert_true(table.missing_keys().has("de"))
	assert_true(table.missing_keys()["de"].has("app.title"))
	assert_false(table.keys_for_locale(&"de").has(&"app.title"))


func test_table_rejects_duplicate_keys() -> void:
	var path: String = _write_temp_file(
		"duplicate.csv", "key,en,de\napp.title,A,A\napp.title,B,B\n"
	)
	var table: LocalizationTable = LocalizationTable.new()
	assert_ne(table.load_csv(path), OK, "duplicate keys must not load")


func test_autoload_selects_the_device_language() -> void:
	var localization: Node = get_node_or_null("/root/Localization")
	assert_not_null(localization, "the Localization autoload must be registered")
	if localization == null:
		return
	assert_eq(localization.get_locale(), LocalizationTable.resolve_locale(OS.get_locale()))


func test_autoload_translates_known_keys() -> void:
	var localization: Node = get_node("/root/Localization")
	localization.select_locale("de_DE")
	assert_eq(localization.get_locale(), &"de")
	assert_eq(localization.tr_key(&"app.title"), "Arithmo Slayer")
	assert_eq(localization.tr_key(&"shell.tagline"), GERMAN_TAGLINE)


func test_autoload_falls_back_to_english() -> void:
	var localization: Node = get_node("/root/Localization")
	assert_eq(localization.select_locale("fr_FR"), &"en")
	assert_eq(localization.tr_key(&"shell.tagline"), ENGLISH_TAGLINE)


func test_autoload_returns_unknown_keys_unchanged() -> void:
	var localization: Node = get_node("/root/Localization")
	assert_eq(localization.tr_key(&"missing.key"), "missing.key")


func test_shell_labels_use_translations() -> void:
	var localization: Node = get_node("/root/Localization")
	localization.select_locale("de")
	var scene: PackedScene = load(MAIN_SCENE_PATH) as PackedScene
	assert_not_null(scene, "the main scene must load")
	if scene == null:
		return
	var instance: Node = scene.instantiate()
	add_child_autofree(instance)
	var title: Label = instance.get_node("Ui/Root/TitleLabel") as Label
	var tagline: Label = instance.get_node("Ui/Root/TaglineLabel") as Label
	assert_eq(title.text, localization.tr_key(&"app.title"))
	assert_eq(tagline.text, GERMAN_TAGLINE)


func test_shell_does_not_hard_code_text() -> void:
	var scene_pattern: RegEx = RegEx.new()
	assert_eq(scene_pattern.compile('(?m)^\\s*text\\s*=\\s*"[^"]+"'), OK)
	assert_eq(
		scene_pattern.search_all(_read_text(MAIN_SCENE_PATH)).size(),
		0,
		"main.tscn must not hard-code user-visible text",
	)
	var script_pattern: RegEx = RegEx.new()
	assert_eq(script_pattern.compile('\\.text\\s*=\\s*"[^"]+"'), OK)
	assert_eq(
		script_pattern.search_all(_read_text(MAIN_SCRIPT_PATH)).size(),
		0,
		"main.gd must not hard-code user-visible text",
	)


func test_validate_data_passes_for_this_project() -> void:
	var result: Dictionary = _run_python([VALIDATE_TOOL])
	assert_eq(result["exit_code"], 0, "validate_data must pass: %s" % result["output"])


func test_validate_data_reports_a_missing_translation() -> void:
	var root: String = _make_temp_dir("missing_translation")
	_write_text(
		root.path_join("data/i18n/strings.csv"),
		"key,en,de\napp.title,Arithmo Slayer,\n",
	)
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "a missing translation must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/i18n/strings.csv"), output)
	assert_true(output.contains("app.title"), output)
	assert_true(output.contains("'de'"), output)


func test_validate_data_reports_a_missing_referenced_key() -> void:
	var root: String = _make_temp_dir("missing_reference")
	_write_text(
		root.path_join("data/i18n/strings.csv"),
		"key,en,de\napp.title,Arithmo Slayer,Arithmo Slayer\n",
	)
	_write_text(
		root.path_join("scripts/main.gd"),
		'func title() -> String:\n\treturn Localization.tr_key(&"missing.key")\n',
	)
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "an unknown referenced key must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("scripts/main.gd:2"), output)
	assert_true(output.contains("missing.key"), output)
	assert_true(output.contains("'key'"), output)


func test_validate_data_reports_a_bad_header() -> void:
	var root: String = _make_temp_dir("bad_header")
	_write_text(
		root.path_join("data/i18n/strings.csv"),
		"key,en\napp.title,Arithmo Slayer\n",
	)
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "a wrong header must fail validation")
	assert_true(String(result["output"]).contains("expected header"), String(result["output"]))


func _read_rows(path: String) -> Array[PackedStringArray]:
	var rows: Array[PackedStringArray] = []
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_not_null(file, "could not open %s" % path)
	if file == null:
		return rows
	while not file.eof_reached():
		var row: PackedStringArray = file.get_csv_line()
		if row.size() == 1 and row[0].is_empty():
			continue
		rows.append(row)
	file.close()
	return rows


func _read_text(path: String) -> String:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_not_null(file, "could not open %s" % path)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


func _run_python(arguments: Array) -> Dictionary:
	var output: Array = []
	var exit_code: int = OS.execute("python3", PackedStringArray(arguments), output, true)
	var lines: PackedStringArray = PackedStringArray()
	for line: String in output:
		lines.append(str(line))
	return {"exit_code": exit_code, "output": "\n".join(lines)}


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("localization_probe")
	var dir_path: String = base.path_join("%s_%d" % [label, Time.get_ticks_usec()])
	DirAccess.make_dir_recursive_absolute(dir_path)
	_temp_dirs.append(dir_path)
	return dir_path


func _write_temp_file(file_name: String, content: String) -> String:
	var dir_path: String = _make_temp_dir(file_name.get_basename())
	var path: String = dir_path.path_join(file_name)
	_write_text(path, content)
	return path


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
