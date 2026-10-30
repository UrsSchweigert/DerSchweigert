class_name LocalizationTable
extends RefCounted
## Parses a key,en,de translation table and resolves keys for a locale.
##
## The table is a CSV file whose first column holds translation keys and whose
## remaining columns are locale codes. Every key must carry a value for every
## supported locale; [method missing_keys] reports the gaps so tests and tools
## can fail before a half-translated build ships.

const KEY_COLUMN: String = "key"
const DEFAULT_LOCALE: StringName = &"en"
const SUPPORTED_LOCALES: Array[StringName] = [&"en", &"de"]

var _locale: StringName = DEFAULT_LOCALE
var _translations: Dictionary = {}


## Maps a device locale such as "de_DE" or "de-AT" to a supported locale.
## Unsupported languages fall back to English.
static func resolve_locale(requested: String) -> StringName:
	var normalized: String = requested.strip_edges().to_lower().replace("-", "_")
	var language: String = normalized.get_slice("_", 0)
	for locale: StringName in SUPPORTED_LOCALES:
		if String(locale) == language:
			return locale
	return DEFAULT_LOCALE


func load_csv(path: String) -> Error:
	_translations.clear()
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return FileAccess.get_open_error()
	var text: String = file.get_as_text()
	file.close()
	return parse(text)


func parse(text: String) -> Error:
	_translations.clear()
	var rows: PackedStringArray = text.replace("\r\n", "\n").split("\n", false)
	if rows.is_empty():
		return ERR_FILE_CORRUPT
	var header: PackedStringArray = _split_row(rows[0])
	var locale_columns: Dictionary = _parse_header(header)
	if locale_columns.is_empty():
		return ERR_FILE_CORRUPT
	var error: Error = _parse_rows(rows.slice(1), header.size(), locale_columns)
	if error != OK:
		_translations.clear()
	return error


static func _parse_header(header: PackedStringArray) -> Dictionary:
	var locale_columns: Dictionary = {}
	if header.is_empty() or header[0].strip_edges() != KEY_COLUMN:
		return locale_columns
	for column: int in range(1, header.size()):
		var locale: StringName = StringName(header[column].strip_edges())
		if locale.is_empty() or locale_columns.has(locale):
			return {}
		locale_columns[locale] = column
	return locale_columns


func _parse_rows(rows: PackedStringArray, column_count: int, locale_columns: Dictionary) -> Error:
	for row: String in rows:
		if row.strip_edges().is_empty():
			continue
		var cells: PackedStringArray = _split_row(row)
		if cells.size() != column_count:
			return ERR_FILE_CORRUPT
		var key: StringName = StringName(cells[0].strip_edges())
		if key.is_empty() or _translations.has(key):
			return ERR_FILE_CORRUPT
		var values: Dictionary = {}
		for locale: StringName in locale_columns:
			values[locale] = cells[int(locale_columns[locale])].strip_edges()
		_translations[key] = values
	return OK


func select_locale(requested: String) -> StringName:
	_locale = resolve_locale(requested)
	return _locale


func get_locale() -> StringName:
	return _locale


func has_key(key: StringName) -> bool:
	return _translations.has(key)


## Returns the translation for [param key], or the key itself when it is
## unknown. A value that is empty in the active locale falls back to English.
func translate(key: StringName) -> String:
	if not _translations.has(key):
		return String(key)
	var values: Dictionary = _translations[key]
	var value: String = String(values.get(_locale, ""))
	if not value.is_empty():
		return value
	return String(values.get(DEFAULT_LOCALE, String(key)))


func get_keys() -> Array[StringName]:
	var keys: Array[StringName] = []
	for key: StringName in _translations:
		keys.append(key)
	keys.sort()
	return keys


## Returns the keys that have a non-empty value for [param locale].
func keys_for_locale(locale: StringName) -> Array[StringName]:
	var keys: Array[StringName] = []
	for key: StringName in _translations:
		var values: Dictionary = _translations[key]
		if not String(values.get(locale, "")).is_empty():
			keys.append(key)
	keys.sort()
	return keys


## Returns the missing keys grouped by locale, for example {"de": ["app.title"]}.
func missing_keys() -> Dictionary:
	var missing: Dictionary = {}
	for locale: StringName in SUPPORTED_LOCALES:
		var keys: Array[String] = []
		for key: StringName in _translations:
			var values: Dictionary = _translations[key]
			if String(values.get(locale, "")).is_empty():
				keys.append(String(key))
		if not keys.is_empty():
			missing[String(locale)] = keys
	return missing


static func _split_row(row: String) -> PackedStringArray:
	var cells: PackedStringArray = []
	var current: String = ""
	var quoted: bool = false
	var index: int = 0
	while index < row.length():
		var character: String = row[index]
		if quoted:
			if character == '"':
				if index + 1 < row.length() and row[index + 1] == '"':
					current += '"'
					index += 1
				else:
					quoted = false
			else:
				current += character
		elif character == '"':
			quoted = true
		elif character == ",":
			cells.append(current)
			current = ""
		else:
			current += character
		index += 1
	cells.append(current)
	return cells
