class_name StateSnapshot
extends RefCounted
## Builds the debug-only JSON view of a live arena session.
##
## [method capture] returns a plain dictionary with the entities, the answer
## orbs, the active problem, the chain and finisher, the hearts, and the
## entitlement. It is debug only: a release build gets an empty dictionary.

const VERSION: int = 1


## Returns whether snapshots are allowed in this build.
static func is_available() -> bool:
	return OS.is_debug_build()


## Builds the snapshot from a state dictionary whose keys are optional:
## [code]tick[/code], [code]entities[/code], [code]orbs[/code],
## [code]problem[/code], [code]chain[/code], [code]finisher[/code],
## [code]health[/code], [code]loadout[/code], [code]assist[/code], and
## [code]cleared[/code].
static func capture(state: Dictionary) -> Dictionary:
	if not is_available():
		return {}
	return {
		"version": VERSION,
		"tick": _int(state.get("tick"), 0),
		"entities": _entities(state.get("entities")),
		"orbs": _orbs(state.get("orbs")),
		"problem": _problem(state.get("problem")),
		"chain": _chain(state.get("chain"), state.get("finisher")),
		"health": _health(state.get("health")),
		"entitlement": _entitlement(state.get("loadout"), state.get("assist")),
		"cleared": bool(state.get("cleared", false)),
	}


static func _entities(value: Variant) -> Array:
	var entities: Array = []
	for raw: Variant in value if value is Array else []:
		if raw is Dictionary:
			var entry: Dictionary = raw as Dictionary
			var entity: Dictionary = {
				"id": String(entry.get("id", "")),
				"kind": String(entry.get("kind", "")),
				"x": _float(entry.get("x")),
				"y": _float(entry.get("y")),
			}
			if entry.has("hp"):
				entity["hp"] = _int(entry.get("hp"), 0)
			if entry.has("state"):
				entity["state"] = String(entry.get("state", ""))
			entities.append(entity)
	return entities


static func _orbs(value: Variant) -> Array:
	var orbs: Array = []
	for raw: Variant in value if value is Array else []:
		if raw is Dictionary:
			var entry: Dictionary = raw as Dictionary
			var orb: Dictionary = {
				"value": _int(entry.get("value"), 0),
				"shape": String(entry.get("shape", "")),
				"correct": bool(entry.get("correct", false)),
				"popped": bool(entry.get("popped", false)),
			}
			orbs.append(orb)
	return orbs


static func _problem(value: Variant) -> Dictionary:
	if not (value is Dictionary) or (value as Dictionary).is_empty():
		return {}
	var problem: Dictionary = value as Dictionary
	return {
		"operation": String(problem.get("operation", "")),
		"a": _int(problem.get("a"), 0),
		"b": _int(problem.get("b"), 0),
		"answer": _int(problem.get("answer"), 0),
	}


static func _chain(chain_value: Variant, finisher_value: Variant) -> Dictionary:
	var tier: int = 0
	var multiplier: float = 1.0
	var charge_per_answer: float = 0.0
	if chain_value is Chain:
		tier = (chain_value as Chain).tier()
		multiplier = (chain_value as Chain).shard_multiplier()
		charge_per_answer = (chain_value as Chain).finisher_charge()
	var charge: float = 0.0
	var threshold: float = 0.0
	if finisher_value is Finisher:
		charge = (finisher_value as Finisher).charge
		threshold = (finisher_value as Finisher).threshold
	return {
		"tier": tier,
		"shardMultiplier": multiplier,
		"finisherCharge": charge_per_answer,
		"charge": charge,
		"threshold": threshold,
		"ready": threshold > 0.0 and charge >= threshold,
	}


static func _health(value: Variant) -> Dictionary:
	if not (value is Health):
		return {"hearts": 0, "maxHearts": 0}
	return {"hearts": (value as Health).hearts, "maxHearts": (value as Health).max_hearts}


static func _entitlement(loadout_value: Variant, assist_value: Variant) -> Dictionary:
	var entitlement: Dictionary = {}
	if loadout_value is Loadout:
		entitlement = (loadout_value as Loadout).write_profile()
	if assist_value is AssistMode:
		entitlement = (assist_value as AssistMode).write_profile(entitlement)
	return entitlement


static func _int(value: Variant, fallback: int) -> int:
	return int(value) if value is int or value is float else fallback


static func _float(value: Variant) -> float:
	return float(value) if value is int or value is float else 0.0
