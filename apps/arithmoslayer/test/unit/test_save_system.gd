extends GutTest
## Exercises the per-profile save system: atomic writes, the last-good
## backup, corrupt-file recovery, and schema migrations.

const V0_FIXTURE: String = "res://test/fixtures/saves/v0.json"
const V1_FIXTURE: String = "res://test/fixtures/saves/v1.json"
const BACKUP_SUFFIX: String = ".bak"
const TEMP_SUFFIX: String = ".tmp"

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_save_stamps_the_schema_version() -> void:
	var path: String = _save_path("stamp")
	assert_eq(SaveSystem.save(path, {"score": 10}), OK)
	assert_eq(int(_read_json(path).get("schema_version", 0)), SaveMigrations.CURRENT_SCHEMA_VERSION)


func test_save_writes_atomically_and_keeps_the_prior_file_in_backup() -> void:
	var path: String = _save_path("atomic")
	assert_eq(SaveSystem.save(path, {"round": 1}), OK)
	assert_eq(SaveSystem.save(path, {"round": 2}), OK)
	assert_false(
		FileAccess.file_exists(path + TEMP_SUFFIX),
		"a completed save must not leave a .tmp file",
	)
	assert_eq(int(_read_json(path)["round"]), 2)
	assert_true(
		FileAccess.file_exists(path + BACKUP_SUFFIX),
		"a second save must keep the prior profile in .bak",
	)
	assert_eq(int(_read_json(path + BACKUP_SUFFIX)["round"]), 1)


func test_load_recovers_from_the_backup_when_the_target_is_corrupt() -> void:
	var path: String = _save_path("recover")
	assert_eq(SaveSystem.save(path, {"round": 7}), OK)
	assert_eq(SaveSystem.save(path, {"round": 8}), OK)
	_write_text(path, "{ this is not valid json")
	var result: Dictionary = SaveSystem.load(path)
	assert_eq(result["error"], OK, "load must recover from the last-good backup")
	assert_true(bool(result["recovered"]), "load must report the recovery")
	assert_eq(int(result["data"]["round"]), 7)


func test_load_returns_an_error_for_a_missing_profile() -> void:
	var path: String = _save_path("missing")
	var result: Dictionary = SaveSystem.load(path)
	assert_ne(result["error"], OK)
	assert_false(bool(result["recovered"]))


func test_v0_fixture_migrates_to_v1() -> void:
	var migrated: Dictionary = SaveSystem.load(V0_FIXTURE)
	var loaded_v1: Dictionary = SaveSystem.load(V1_FIXTURE)
	assert_eq(migrated["error"], OK)
	assert_eq(int(migrated["data"]["schema_version"]), SaveMigrations.CURRENT_SCHEMA_VERSION)
	assert_eq(migrated["data"], loaded_v1["data"])


func test_v1_fixture_loads_unchanged() -> void:
	var original: Dictionary = _read_json(V1_FIXTURE)
	var result: Dictionary = SaveSystem.load(V1_FIXTURE)
	assert_eq(result["error"], OK)
	assert_false(bool(result["recovered"]))
	var data: Dictionary = result["data"]
	assert_eq(data["profile_name"], original["profile_name"])
	assert_eq(float(data["score"]), float(original["score"]))
	assert_eq(data["settings"], original["settings"])
	assert_eq(int(data["schema_version"]), SaveMigrations.CURRENT_SCHEMA_VERSION)


func test_every_schema_version_has_a_migration() -> void:
	for version: int in range(SaveMigrations.CURRENT_SCHEMA_VERSION):
		assert_true(
			SaveMigrations.has_migration(version),
			"missing migration from schema version %d" % version,
		)


func _save_path(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("save_probe")
	var dir_path: String = base.path_join("%s_%d" % [label, Time.get_ticks_usec()])
	DirAccess.make_dir_recursive_absolute(dir_path)
	_temp_dirs.append(dir_path)
	return dir_path.path_join("save.json")


func _read_json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(_read_text(path))
	assert_eq(typeof(parsed), TYPE_DICTIONARY, "%s must hold a JSON object" % path)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	var data: Dictionary = parsed
	return data


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
