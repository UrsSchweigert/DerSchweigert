class_name SaveSystem
extends RefCounted
## Per-profile save/load with atomic writes and last-good recovery.
##
## [method save] serializes the profile with a schema version, writes it to a
## temporary file, moves the previous profile aside as a .bak backup, and
## renames the temporary file into place. [method load] parses the profile,
## falls back to the .bak backup when the target is corrupt, reports the
## recovery, and migrates the data up to the current schema version.

const BACKUP_SUFFIX: String = ".bak"
const TEMP_SUFFIX: String = ".tmp"


## Serializes [param data] with the current schema version and writes it to
## [param path] atomically, keeping the previous file in [code]path.bak[/code].
static func save(path: String, data: Dictionary) -> Error:
	var payload: Dictionary = data.duplicate(true)
	payload[SaveMigrations.SCHEMA_VERSION_KEY] = SaveMigrations.CURRENT_SCHEMA_VERSION

	var temp_path: String = path + TEMP_SUFFIX
	var backup_path: String = path + BACKUP_SUFFIX

	var file: FileAccess = FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(JSON.stringify(payload, "\t"))
	file.close()

	if FileAccess.file_exists(path):
		if FileAccess.file_exists(backup_path):
			var remove_error: Error = DirAccess.remove_absolute(backup_path)
			if remove_error != OK:
				DirAccess.remove_absolute(temp_path)
				return remove_error
		var backup_error: Error = DirAccess.rename_absolute(path, backup_path)
		if backup_error != OK:
			DirAccess.remove_absolute(temp_path)
			return backup_error

	var rename_error: Error = DirAccess.rename_absolute(temp_path, path)
	if rename_error != OK:
		return rename_error
	return OK


## Loads [param path], recovering from [code]path.bak[/code] when the target is
## corrupt and migrating the data up to the current schema version.
##
## Returns {"data": Dictionary, "recovered": bool, "error": int}.
static func load(path: String) -> Dictionary:
	var result: Dictionary = _read_profile(path)
	if result["error"] != OK:
		var backup_path: String = path + BACKUP_SUFFIX
		if FileAccess.file_exists(backup_path):
			var backup: Dictionary = _read_profile(backup_path)
			if backup["error"] == OK:
				backup["recovered"] = true
				return backup
	return result


static func _read_profile(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"data": {}, "recovered": false, "error": ERR_FILE_NOT_FOUND}
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"data": {}, "recovered": false, "error": FileAccess.get_open_error()}
	var text: String = file.get_as_text()
	file.close()
	var parser: JSON = JSON.new()
	if parser.parse(text) != OK:
		return {"data": {}, "recovered": false, "error": ERR_FILE_CORRUPT}
	if typeof(parser.data) != TYPE_DICTIONARY:
		return {"data": {}, "recovered": false, "error": ERR_FILE_CORRUPT}
	var data: Dictionary = parser.data
	var version: int = int(data.get(SaveMigrations.SCHEMA_VERSION_KEY, 0))
	data = SaveMigrations.migrate(data, version)
	return {"data": data, "recovered": false, "error": OK}
