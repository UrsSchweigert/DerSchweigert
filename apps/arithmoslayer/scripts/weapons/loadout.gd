class_name Loadout
extends RefCounted
## Two quick-swap slots over the weapons a profile owns.
##
## Only the unlock route declared in [code]data/weapons/loadout.json[/code]
## grants a weapon, and [method start_level] re-checks both slots so a stale
## profile cannot carry an unowned weapon into a level.

const DEFAULT_PATH: String = "res://data/weapons/loadout.json"
const SLOT_COUNT: int = 2
const SOURCES: Array[String] = ["exploration", "quest", "boss"]
const DOCUMENT_FIELDS: Array[String] = [
	"version", "slots", "swapCooldownFrames", "sources", "weapons", "starting"
]
const ENTRY_FIELDS: Array[String] = ["id", "source", "unlock"]
const PROFILE_OWNED_KEY: String = "weaponsOwned"
const PROFILE_SLOTS_KEY: String = "loadoutSlots"
const PROFILE_ACTIVE_KEY: String = "activeSlot"
const MAX_COOLDOWN_FRAMES: int = 30


class Entry:
	extends RefCounted
	var id: String = ""
	var source: String = ""
	var unlock: String = ""


var version: int = 1
var slot_count: int = SLOT_COUNT
var swap_cooldown_frames: int = 0
var sources: Array[String] = []
var starting: Array[String] = []
var entries: Array[Entry] = []
var errors: Array[String] = []
var level_errors: Array[String] = []

var _owned: Dictionary = {}
var _slots: Array[String] = []
var _active: int = 0
var _cooldown: int = 0


## Loads [param path], reporting a missing or malformed file in [member errors].
static func load_file(path: String = DEFAULT_PATH) -> Loadout:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(file.get_as_text()) if file != null else null
	if not (parsed is Dictionary):
		var missing: Loadout = Loadout.new()
		missing._reset_slots()
		missing.errors.append("%s: loadout must be a readable JSON object" % path)
		return missing
	return _from_dictionary(parsed as Dictionary)


static func _from_dictionary(data: Dictionary) -> Loadout:
	var loadout: Loadout = Loadout.new()
	loadout._read(data)
	loadout._grant_starting()
	return loadout


func is_valid() -> bool:
	return errors.is_empty()


func weapon_ids() -> Array[String]:
	var ids: Array[String] = []
	for entry: Entry in entries:
		ids.append(entry.id)
	return ids


func is_known(weapon_id: String) -> bool:
	return _entry(weapon_id) != null


func source_of(weapon_id: String) -> String:
	var entry: Entry = _entry(weapon_id)
	return entry.source if entry != null else ""


func is_owned(weapon_id: String) -> bool:
	return _owned.has(weapon_id)


func owned_weapon_ids() -> Array[String]:
	var ids: Array[String] = []
	for entry: Entry in entries:
		if _owned.has(entry.id):
			ids.append(entry.id)
	return ids


## Unlocks [param weapon_id] only through its declared exploration, quest, or
## boss route. A shop, a purchase, or another route is rejected.
func unlock(weapon_id: String, source: String) -> bool:
	var entry: Entry = _entry(weapon_id)
	if entry == null or not SOURCES.has(source) or source != entry.source:
		return false
	_owned[weapon_id] = true
	return true


func _grant_starting() -> void:
	if _slots.size() != slot_count:
		_reset_slots()
	for weapon_id: String in starting:
		if _entry(weapon_id) != null:
			_owned[weapon_id] = true
	for index: int in mini(starting.size(), slot_count):
		_slots[index] = starting[index]


## Equips an owned [param weapon_id] into [param slot_index].
func equip(weapon_id: String, slot_index: int) -> bool:
	if not is_owned(weapon_id) or slot_index < 0 or slot_index >= slot_count:
		return false
	_slots[slot_index] = weapon_id
	return true


func slot(slot_index: int) -> String:
	if slot_index < 0 or slot_index >= slot_count:
		return ""
	return _slots[slot_index]


func active_weapon_id() -> String:
	return slot(_active)


func can_swap() -> bool:
	var standby: String = slot(_standby_slot())
	return _cooldown <= 0 and not standby.is_empty() and is_owned(standby)


## Toggles the active slot when the cooldown allows it.
func try_swap() -> bool:
	if not can_swap():
		return false
	_active = _standby_slot()
	_cooldown = swap_cooldown_frames
	return true


func tick() -> void:
	if _cooldown > 0:
		_cooldown -= 1


func cooldown_frames_left() -> int:
	return _cooldown


## Checks every equipped slot and reports why a level cannot start.
func start_level() -> bool:
	level_errors.clear()
	for index: int in slot_count:
		var weapon_id: String = _slots[index]
		if weapon_id.is_empty():
			continue
		if _entry(weapon_id) == null:
			level_errors.append("slot %d holds unknown weapon '%s'" % [index, weapon_id])
		elif not is_owned(weapon_id):
			level_errors.append("slot %d holds unowned weapon '%s'" % [index, weapon_id])
	if active_weapon_id().is_empty():
		level_errors.append("the active slot is empty")
	return level_errors.is_empty()


## Restores owned weapons and slots from a saved profile without trusting it.
func apply_profile(profile: Dictionary) -> void:
	_owned.clear()
	var raw_owned: Variant = profile.get(PROFILE_OWNED_KEY, [])
	for raw: Variant in raw_owned if raw_owned is Array else []:
		var weapon_id: String = String(raw)
		if _entry(weapon_id) != null:
			_owned[weapon_id] = true
	_reset_slots()
	var raw_slots: Variant = profile.get(PROFILE_SLOTS_KEY, [])
	var slot_values: Array = raw_slots if raw_slots is Array else []
	for index: int in mini(slot_values.size(), slot_count):
		_slots[index] = String(slot_values[index])
	_active = clampi(_int(profile, PROFILE_ACTIVE_KEY, 0), 0, slot_count - 1)
	_cooldown = 0


## Serializes the owned weapons and both slots for a save profile.
func write_profile() -> Dictionary:
	return {
		PROFILE_OWNED_KEY: owned_weapon_ids(),
		PROFILE_SLOTS_KEY: _slots.duplicate(),
		PROFILE_ACTIVE_KEY: _active,
	}


func _read(data: Dictionary) -> void:
	errors.clear()
	_reject_unknown(data, DOCUMENT_FIELDS, "loadout")
	version = _int(data, "version", 0)
	slot_count = maxi(_int(data, "slots", SLOT_COUNT), 1)
	swap_cooldown_frames = maxi(_int(data, "swapCooldownFrames", 0), 0)
	_read_sources(data.get("sources"))
	entries.clear()
	var raw_entries: Variant = data.get("weapons", [])
	for raw: Variant in raw_entries if raw_entries is Array else []:
		if raw is Dictionary:
			entries.append(_read_entry(raw as Dictionary))
	starting.clear()
	var raw_starting: Variant = data.get("starting", [])
	for raw: Variant in raw_starting if raw_starting is Array else []:
		starting.append(String(raw))
	if version != 1:
		errors.append("version must be 1")
	if slot_count != SLOT_COUNT:
		errors.append("slots must be %d" % SLOT_COUNT)
	if swap_cooldown_frames <= 0 or swap_cooldown_frames > MAX_COOLDOWN_FRAMES:
		errors.append("swapCooldownFrames must be between 1 and %d" % MAX_COOLDOWN_FRAMES)
	if entries.is_empty():
		errors.append("weapons must not be empty")
	for weapon_id: String in starting:
		if _entry(weapon_id) == null:
			errors.append("starting weapon '%s' is not declared" % weapon_id)
	_reset_slots()


func _read_sources(value: Variant) -> void:
	sources.clear()
	for raw: Variant in value if value is Array else []:
		var name: String = String(raw)
		if not SOURCES.has(name):
			errors.append("source '%s' is not one of %s" % [name, ", ".join(SOURCES)])
		sources.append(name)
	for required: String in SOURCES:
		if not sources.has(required):
			errors.append("sources must include '%s'" % required)


func _read_entry(raw: Dictionary) -> Entry:
	var entry: Entry = Entry.new()
	entry.id = _string(raw, "id")
	_reject_unknown(raw, ENTRY_FIELDS, "weapon '%s'" % entry.id)
	entry.source = _string(raw, "source")
	entry.unlock = _string(raw, "unlock")
	if entry.id.is_empty():
		errors.append("weapon entry %d needs a non-empty id" % entries.size())
	elif _entry(entry.id) != null:
		errors.append("duplicate weapon id '%s'" % entry.id)
	if not SOURCES.has(entry.source):
		errors.append("weapon '%s': unknown unlock source '%s'" % [entry.id, entry.source])
	elif not sources.has(entry.source):
		errors.append("weapon '%s': source '%s' is not declared" % [entry.id, entry.source])
	if entry.unlock.is_empty():
		errors.append("weapon '%s': unlock must be non-empty" % entry.id)
	return entry


func _standby_slot() -> int:
	return (_active + 1) % maxi(slot_count, 1)


func _reset_slots() -> void:
	_slots.clear()
	for _index: int in slot_count:
		_slots.append("")


func _entry(weapon_id: String) -> Entry:
	for entry: Entry in entries:
		if entry.id == weapon_id:
			return entry
	return null


func _reject_unknown(data: Dictionary, allowed: Array[String], context: String) -> void:
	for field: Variant in data:
		if not allowed.has(String(field)):
			errors.append("%s: unknown field '%s'" % [context, String(field)])


func _string(data: Dictionary, key: String) -> String:
	var value: Variant = data.get(key, "")
	return String(value) if value is String else ""


func _int(data: Dictionary, key: String, fallback: int) -> int:
	var value: Variant = data.get(key, fallback)
	return int(value) if value is int or value is float else fallback
