extends GutTest
## Guards tools/validate_data.py and the validator modules it discovers.

const VALIDATE_TOOL: String = "tools/validate_data.py"
const TARGETS_PATH: String = "data/android_targets.json"
const I18N_PATH: String = "data/i18n/strings.csv"
const VALID_I18N: String = "key,en,de\napp.title,Arithmo Slayer,Arithmo Slayer\n"
const BILLING_PERMISSION: String = "com.android.vending.BILLING"
const DISALLOWED_PERMISSION: String = "com.example.CAMERA"
const VALID_TARGETS: String = """{
  "source": "test fixture",
  "minSdk": 24,
  "targetSdk": 36,
  "permissions": ["com.android.vending.BILLING"]
}
"""
const BROKEN_JSON: String = """{
  "source": "test fixture",
  "minSdk": 24,
  "targetSdk": 36,
  "permissions": [
}
"""
const MISSING_PERMISSIONS: String = """{
  "source": "test fixture",
  "minSdk": 24,
  "targetSdk": 36
}
"""
const WRONG_TYPE: String = """{
  "source": "test fixture",
  "minSdk": "24",
  "targetSdk": 36,
  "permissions": ["com.android.vending.BILLING"]
}
"""
const INVERTED_SDK_LEVELS: String = """{
  "source": "test fixture",
  "minSdk": 36,
  "targetSdk": 24,
  "permissions": ["com.android.vending.BILLING"]
}
"""

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_reports_malformed_json_with_its_path_and_field() -> void:
	var root: String = _make_project("broken_json", BROKEN_JSON)
	var result: Dictionary = _run_validate(root)
	assert_ne(result["exit_code"], 0, "malformed JSON must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:6"), output)
	assert_true(output.contains("invalid JSON"), output)
	assert_true(output.contains("(field '<document>')"), output)


func test_reports_a_missing_required_field_with_its_path_and_field() -> void:
	var root: String = _make_project("missing_field", MISSING_PERMISSIONS)
	var result: Dictionary = _run_validate(root)
	assert_ne(result["exit_code"], 0, "a missing required field must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:1"), output)
	assert_true(output.contains("required field is missing (field 'permissions')"), output)


func test_reports_a_field_with_the_wrong_type() -> void:
	var root: String = _make_project("wrong_type", WRONG_TYPE)
	var result: Dictionary = _run_validate(root)
	assert_ne(result["exit_code"], 0, "a wrong field type must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:3"), output)
	assert_true(output.contains("expected an integer but found a string (field 'minSdk')"), output)


func test_reports_a_min_sdk_above_the_target_sdk() -> void:
	var root: String = _make_project("inverted_sdk", INVERTED_SDK_LEVELS)
	var result: Dictionary = _run_validate(root)
	assert_ne(result["exit_code"], 0, "minSdk above targetSdk must fail validation")
	var output: String = String(result["output"])
	assert_true(output.contains("data/android_targets.json:3"), output)
	assert_true(output.contains("minSdk 36 is greater than targetSdk 24 (field 'minSdk')"), output)


func test_reports_a_permission_other_than_billing() -> void:
	var permissions: String = '["%s", "%s"]' % [BILLING_PERMISSION, DISALLOWED_PERMISSION]
	var targets: String = (
		(
			'{\n  "source": "test fixture",\n  "minSdk": 24,\n  "targetSdk": 36,\n'
			+ '  "permissions": %s\n}\n'
		)
		% permissions
	)
	var root: String = _make_project("extra_permission", targets)
	var result: Dictionary = _run_validate(root)
	assert_ne(result["exit_code"], 0, "an extra permission must fail validation")
	var output: String = String(result["output"])
	var expected: String = (
		"permission '%s' is not allowed (field 'permissions')" % DISALLOWED_PERMISSION
	)
	assert_true(output.contains(expected), output)


func test_accepts_a_valid_project() -> void:
	var root: String = _make_project("valid", VALID_TARGETS)
	var result: Dictionary = _run_validate(root)
	assert_eq(result["exit_code"], 0, "a valid project must pass: %s" % result["output"])


func test_ok_lists_the_discovered_validator_modules() -> void:
	var result: Dictionary = _run_python([VALIDATE_TOOL])
	assert_eq(result["exit_code"], 0, "the project must validate: %s" % result["output"])
	var output: String = String(result["output"])
	assert_true(output.contains("android_targets"), output)
	assert_true(output.contains("i18n"), output)


func _make_project(label: String, targets: String) -> String:
	var root: String = _make_temp_dir(label)
	_write_text(root.path_join(I18N_PATH), VALID_I18N)
	_write_text(root.path_join(TARGETS_PATH), targets)
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
	var base: String = ProjectSettings.globalize_path("user://").path_join("data_validator_probe")
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
