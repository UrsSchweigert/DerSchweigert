extends Node
## Autoload that owns the active translation table.
##
## It loads data/i18n/strings.csv, selects the device language when it is
## supported, and falls back to English for unsupported languages and keys.

const TABLE_PATH: String = "res://data/i18n/strings.csv"

var _table: LocalizationTable = LocalizationTable.new()


func _ready() -> void:
	var error: Error = load_table()
	if error != OK:
		push_error("Localization: could not load %s (error %d)" % [TABLE_PATH, error])


## Loads a translation table and re-applies the device language.
func load_table(path: String = TABLE_PATH) -> Error:
	var error: Error = _table.load_csv(path)
	if error != OK:
		return error
	select_device_locale()
	return OK


## Selects the language reported by the device, falling back to English.
func select_device_locale() -> StringName:
	return select_locale(OS.get_locale())


## Selects a supported locale for a device locale such as "de_DE" and returns
## the resolved locale.
func select_locale(requested: String) -> StringName:
	var locale: StringName = _table.select_locale(requested)
	TranslationServer.set_locale(String(locale))
	return locale


func get_locale() -> StringName:
	return _table.get_locale()


## Typed lookup used by scenes and scripts instead of hard-coded text.
func tr_key(key: StringName) -> String:
	return _table.translate(key)


func has_key(key: StringName) -> bool:
	return _table.has_key(key)


func get_keys() -> Array[StringName]:
	return _table.get_keys()


func keys_for_locale(locale: StringName) -> Array[StringName]:
	return _table.keys_for_locale(locale)


func missing_keys() -> Dictionary:
	return _table.missing_keys()
