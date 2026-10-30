extends GutTest
## Guards tools/validate_data.py and the validator modules it discovers.

const VALIDATE_TOOL: String = "tools/validate_data.py"
const TARGETS_PATH: String = "data/android_targets.json"
const TRANSLATION_TABLE_PATH: String = "data/i18n/strings.csv"
const MISSING_SDK_FIXTURE: String = "res://test/fixtures/data/android_targets_missing_sdk.json"
const BROKEN_SYNTAX_FIXTURE: String = "res://test/fixtures/data/android_targets_broken_syntax.json"
const VALID_TABLE: String = "key,en,de\napp.title,Arithmo Slayer,Arithmo Slayer\n"
const BROKEN_SYNTAX_LINE: int = 6
const SOURCE_NOTE: String = "Google Play target API level policy, checked 2026-10-30."
const BILLING_PERMISSION: String = "com.android.vending.BILLING"
const EXAMPLE_VALIDATOR: String = (
	"def validate(root):\n" + "    return [\"data/example.json:1: broken (field 'example')\"]\n"
)

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_validate_data_passes_for_this_project() -> void:
	var result: Dictionary = _run_python([VALIDATE_TOOL])
	assert_eq(result["exit_code"], 0, "validate_data must pass: %s" % result["output"])


func test_validate_data_lists_the_discovered_validators() -> void:
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--list"])
	assert_eq(result["exit_code"], 0, String(result["output"]))
	var output: String = String(result["output"])
	assert_true(output.contains("android_targets"), output)
	assert_true(output.contains("translations"), output)


func test_missing_required_field_names_the_file_and_field() -> void:
	var root: String = _make_project_root("missing_sdk")
	_write_text(root.path_join(TARGETS_PATH), _read_text(MISSING_SDK_FIXTURE))
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "a missing field must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:1:"), output)
	assert_true(output.contains("(field 'minSdk')"), output)


func test_broken_fixture_reports_the_exact_path_and_line() -> void:
	var root: String = _make_project_root("broken_syntax")
	_write_text(root.path_join(TARGETS_PATH), _read_text(BROKEN_SYNTAX_FIXTURE))
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "broken JSON must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:%d:" % BROKEN_SYNTAX_LINE), output)
	assert_true(output.contains("invalid JSON"), output)


func test_target_sdk_below_min_sdk_names_the_target_sdk_field() -> void:
	var root: String = _make_project_root("target_below_min")
	_write_text(root.path_join(TARGETS_PATH), _targets({"minSdk": 36, "targetSdk": 24}))
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "targetSdk below minSdk must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json"), output)
	assert_true(output.contains("(field 'targetSdk')"), output)


func test_duplicate_permission_names_the_permissions_field() -> void:
	var root: String = _make_project_root("duplicate_permission")
	_write_text(
		root.path_join(TARGETS_PATH),
		_targets({"permissions": [BILLING_PERMISSION, BILLING_PERMISSION]}),
	)
	var result: Dictionary = _run_python([VALIDATE_TOOL, "--root", root])
	assert_ne(result["exit_code"], 0, "a duplicate permission must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json"), output)
	assert_true(output.contains("(field 'permissions')"), output)


func test_a_new_validator_module_is_discovered() -> void:
	var root: String = _make_project_root("discovery")
	var tools_dir: String = root.path_join("tools")
	var copy: Dictionary = _run_python(
		[
			"-c",
			"import shutil, sys; shutil.copytree(sys.argv[1], sys.argv[2])",
			ProjectSettings.globalize_path("res://tools"),
			tools_dir,
		]
	)
	assert_eq(copy["exit_code"], 0, String(copy["output"]))
	_write_text(tools_dir.path_join("validate/example.py"), EXAMPLE_VALIDATOR)
	var result: Dictionary = _run_python([tools_dir.path_join("validate_data.py"), "--list"])
	assert_eq(result["exit_code"], 0, String(result["output"]))
	assert_true(String(result["output"]).contains("example"), String(result["output"]))


func _targets(overrides: Dictionary) -> String:
	var record: Dictionary = {
		"source": SOURCE_NOTE,
		"minSdk": 24,
		"targetSdk": 36,
		"permissions": [BILLING_PERMISSION],
	}
	for key: String in overrides:
		record[key] = overrides[key]
	return JSON.stringify(record, "  ")


func _make_project_root(label: String) -> String:
	var root: String = _make_temp_dir(label)
	_write_text(root.path_join(TRANSLATION_TABLE_PATH), VALID_TABLE)
	return root


func _run_python(arguments: Array) -> Dictionary:
	var output: Array = []
	var exit_code: int = OS.execute("python3", PackedStringArray(arguments), output, true)
	var lines: PackedStringArray = PackedStringArray()
	for line: String in output:
		lines.append(str(line))
	return {"exit_code": exit_code, "output": "\n".join(lines)}


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("data_validator_probe")
	var dir_path: String = base.path_join("%s_%d" % [label, Time.get_ticks_usec()])
	DirAccess.make_dir_recursive_absolute(dir_path)
	_temp_dirs.append(dir_path)
	return dir_path


func _read_text(path: String) -> String:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_not_null(file, "could not open %s" % path)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text


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
