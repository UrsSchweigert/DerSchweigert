class_name Chain
extends RefCounted
## Tracks the answer chain: correct strikes raise it, wrong strikes drop it.
##
## The tier never drops below zero, so a wrong answer costs the shard multiplier
## and finisher charge but never ends the fight. Tiers come from chain.json.

const DEFAULT_PATH: String = "res://data/combat/chain.json"

var _tiers: Array[Dictionary] = []
var _tier: int = 0


func _init(path: String = DEFAULT_PATH) -> void:
	apply_config(load_config(path))


static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}


func apply_config(config: Dictionary) -> void:
	_tiers.clear()
	var declared: Variant = config.get("tiers")
	if declared is Array:
		for entry: Variant in declared:
			if entry is Dictionary:
				_tiers.append(_tier_from(entry as Dictionary))
	if _tiers.is_empty():
		for _index: int in 4:
			_tiers.append(_tier_from({}))
	_tier = clampi(_integer(config.get("startTier"), 0), 0, _tiers.size() - 1)


func tier() -> int:
	return _tier


func raise() -> int:
	_tier = clampi(_tier + 1, 0, _tiers.size() - 1)
	return _tier


func drop() -> int:
	_tier = clampi(_tier - 1, 0, _tiers.size() - 1)
	return _tier


func shard_multiplier() -> float:
	return float(_tiers[_tier]["shardMultiplier"])


func finisher_charge() -> float:
	return float(_tiers[_tier]["finisherCharge"])


static func _tier_from(entry: Dictionary) -> Dictionary:
	return {
		"shardMultiplier": _number(entry.get("shardMultiplier"), 1.0, 0.0),
		"finisherCharge": _number(entry.get("finisherCharge"), 1.0, 0.0),
	}


static func _integer(value: Variant, fallback: int) -> int:
	return int(value) if value is int or value is float else fallback


static func _number(value: Variant, fallback: float, minimum: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number >= minimum and is_finite(number) else fallback
