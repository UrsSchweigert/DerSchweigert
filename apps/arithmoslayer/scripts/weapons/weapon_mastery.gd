class_name WeaponMastery
extends RefCounted
## Per-weapon use tracking that turns a weapon's data thresholds into mastery.
##
## [method register_use] fills the meter; each level unlocks extra combo steps,
## a finisher variant, and a trail. Affinity is a small reward bonus only:
## [method shard_bonus] never gates solving or changes a problem's rules.

const DEFAULT_DIRECTORY: String = "res://data/weapons"
const SCHEMA_NAME: String = "schema.json"
const LOADOUT_NAME: String = "loadout.json"
const SHARD_BONUS: int = 2
const AFFINITY_OPERATIONS: Dictionary = {
	"sum": ["addition"],
	"product": ["multiplication"],
	"quotient": ["division"],
	"difference": ["subtraction"],
	"equal": ["equal", "equality", "comparison"],
}

var uses: Dictionary = {}
var _weapons: Dictionary = {}


func _init(weapons: Array[WeaponDefinition] = []) -> void:
	for weapon: WeaponDefinition in weapons:
		if weapon != null and weapon.is_valid():
			_weapons[weapon.id] = weapon


## Loads every weapon document under [param path].
static func load_directory(path: String = DEFAULT_DIRECTORY) -> WeaponMastery:
	var weapons: Array[WeaponDefinition] = []
	for file_name: String in DirAccess.get_files_at(path):
		if file_name.ends_with(".json") and file_name not in [SCHEMA_NAME, LOADOUT_NAME]:
			weapons.append(WeaponDefinition.load_file(path.path_join(file_name)))
	return WeaponMastery.new(weapons)


## Returns every known weapon id in a stable order.
func weapon_ids() -> Array[String]:
	var ids: Array[String] = []
	for weapon_id: Variant in _weapons:
		ids.append(String(weapon_id))
	ids.sort()
	return ids


## Returns the definition for [param weapon_id], or null when it is unknown.
func definition(weapon_id: String) -> WeaponDefinition:
	return _weapons.get(weapon_id, null) as WeaponDefinition


## Returns the weapon's affinity, or an empty string when it is unknown.
func affinity_of(weapon_id: String) -> String:
	var weapon: WeaponDefinition = definition(weapon_id)
	return weapon.affinity if weapon != null else ""


## Counts [param count] uses and returns the weapon's new total.
func register_use(weapon_id: String, count: int = 1) -> int:
	if not _weapons.has(weapon_id):
		return 0
	var total: int = uses_for(weapon_id) + maxi(count, 0)
	uses[weapon_id] = total
	return total


## Returns how many times [param weapon_id] has been used.
func uses_for(weapon_id: String) -> int:
	return int(uses.get(weapon_id, 0))


## Returns the highest level whose threshold the uses have reached.
func level(weapon_id: String) -> int:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	var current: int = 0
	for index: int in levels.size():
		if uses_for(weapon_id) >= levels[index].threshold:
			current = index
	return current


## Returns how many mastery levels [param weapon_id] defines.
func level_count(weapon_id: String) -> int:
	return mastery_levels(weapon_id).size()


## Returns the uses needed for [param level_index], clamped to the levels.
func threshold(weapon_id: String, level_index: int) -> int:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	if levels.is_empty():
		return 0
	return levels[clampi(level_index, 0, levels.size() - 1)].threshold


## Returns progress toward the next level from 0.0 to 1.0.
func meter(weapon_id: String) -> float:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	if levels.is_empty():
		return 0.0
	var current: int = level(weapon_id)
	if current >= levels.size() - 1:
		return 1.0
	var low: int = levels[current].threshold
	var high: int = levels[current + 1].threshold
	var span: int = maxi(high - low, 1)
	return clampf(float(uses_for(weapon_id) - low) / float(span), 0.0, 1.0)


## Returns the combo steps unlocked at the weapon's current level.
func unlocked_step_ids(weapon_id: String) -> Array[String]:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	if levels.is_empty():
		return []
	return levels[level(weapon_id)].steps.duplicate()


## Returns the finisher variant unlocked at the current level, or "".
func finisher_variant(weapon_id: String) -> String:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	return levels[level(weapon_id)].finisher if not levels.is_empty() else ""


## Returns the trail unlocked at the current level, or "".
func trail(weapon_id: String) -> String:
	var levels: Array[WeaponDefinition.MasteryLevel] = mastery_levels(weapon_id)
	return levels[level(weapon_id)].trail if not levels.is_empty() else ""


## Returns whether [param operation] matches the weapon's affinity.
func affinity_matches(weapon_id: String, operation: String) -> bool:
	var affinity: String = affinity_of(weapon_id)
	if affinity.is_empty():
		return false
	var operations: Array = AFFINITY_OPERATIONS.get(affinity, [])
	return operation == affinity or operations.has(operation)


## Returns the small shard bonus for an affinity match, else zero.
func shard_bonus(weapon_id: String, operation: String) -> int:
	return SHARD_BONUS if affinity_matches(weapon_id, operation) else 0


## Returns the weapon's declared mastery levels.
func mastery_levels(weapon_id: String) -> Array[WeaponDefinition.MasteryLevel]:
	var weapon: WeaponDefinition = definition(weapon_id)
	return weapon.mastery_levels if weapon != null else []
