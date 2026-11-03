class_name Replay
extends RefCounted
## Records the inputs of one fixed-tick arena session and serializes them.
##
## Every event names the simulation tick it belongs to, so applying the events
## at the same ticks reproduces the run. The recorder never touches randomness:
## the seed travels beside the events and the session seeds its own [Rng].

const VERSION: int = 1
const KINDS: Array[String] = ["press", "release", "swipe", "move"]
const ACTIONS: Array[String] = ["attack", "dodge", "swap", "special"]
const DIRECTIONS: Array[String] = ["up", "down", "left", "right"]

var seed: int = 0
var tick: int = 0
var ticks: int = 0
var errors: Array[String] = []

var _events: Array[Dictionary] = []


## Creates an empty recording for a session seeded with [param replay_seed].
func _init(replay_seed: int = 0) -> void:
	seed = replay_seed


## Stores [param event] at the current tick and returns whether it was accepted.
func record(event: Dictionary) -> bool:
	return _append(event, tick)


## Ends the current tick and returns the next one.
func advance_tick() -> int:
	tick += 1
	ticks = maxi(ticks, tick)
	return tick


## Returns a copy of every event recorded at [param at_tick].
func events_at(at_tick: int) -> Array[Dictionary]:
	var found: Array[Dictionary] = []
	for event: Dictionary in _events:
		if int(event.get("tick", -1)) == at_tick:
			found.append(event)
	return found


func size() -> int:
	return _events.size()


func is_valid() -> bool:
	return errors.is_empty()


## Returns the JSON-ready document a replay file or a bug report holds.
func to_dictionary() -> Dictionary:
	return {"version": VERSION, "seed": seed, "ticks": ticks, "events": _events.duplicate(true)}


func to_json(pretty: bool = false) -> String:
	return JSON.stringify(to_dictionary(), "\t" if pretty else "")


## Reads a recording back, collecting every malformed field in [member errors].
static func from_dictionary(data: Dictionary) -> Replay:
	var replay: Replay = Replay.new(_integer(data.get("seed"), 0))
	if _integer(data.get("version"), 0) != VERSION:
		replay.errors.append("version must be %d" % VERSION)
	replay.ticks = maxi(_integer(data.get("ticks"), 0), 0)
	var declared: Variant = data.get("events", [])
	if not (declared is Array):
		replay.errors.append("events must be an array")
		return replay
	for raw: Variant in declared as Array:
		if raw is Dictionary:
			var event: Dictionary = raw as Dictionary
			replay._append(event, _integer(event.get("tick"), -1))
		else:
			replay.errors.append("every event must be an object")
	replay.ticks = maxi(replay.ticks, _integer(data.get("ticks"), 0))
	return replay


static func from_json(text: String) -> Replay:
	var parsed: Variant = JSON.parse_string(text)
	if not (parsed is Dictionary):
		var broken: Replay = Replay.new(0)
		broken.errors.append("a replay must be a JSON object")
		return broken
	return from_dictionary(parsed as Dictionary)


func _append(event: Dictionary, at_tick: int) -> bool:
	var kind: String = String(event.get("kind", ""))
	var action: String = String(event.get("action", ""))
	var direction: String = String(event.get("direction", ""))
	if not KINDS.has(kind):
		errors.append("unknown replay event kind '%s'" % kind)
	elif at_tick < 0:
		errors.append("every replay event needs a non-negative tick")
	elif kind in ["press", "release"] and not ACTIONS.has(action):
		errors.append("'%s' needs a known action" % kind)
	elif kind == "swipe" and not DIRECTIONS.has(direction):
		errors.append("a swipe needs a known direction")
	elif kind == "move" and not (_number(event.get("x")) and _number(event.get("y"))):
		errors.append("a move needs numeric x and y")
	else:
		var stored: Dictionary = event.duplicate(true)
		stored["tick"] = at_tick
		_events.append(stored)
		ticks = maxi(ticks, at_tick + 1)
		return true
	return false


static func _integer(value: Variant, fallback: int) -> int:
	return int(value) if value is int or value is float else fallback


static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
