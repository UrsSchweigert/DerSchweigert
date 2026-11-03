class_name ArenaBot
extends RefCounted
## Runs the scripted greybox arena and records it as a [Replay].
##
## The bot seeds an [Rng] from [code]data/bots/arena.json[/code], answers every
## presented problem by striking the correct orb, records each input with its
## tick, and stops once the Muddler is defeated and the finisher has fired.
## [method replay_session] runs the same session again from recorded inputs
## only, so a matching snapshot proves the replay is deterministic.

const DEFAULT_PATH: String = "res://data/bots/arena.json"
const BANDS_PATH: String = "res://data/curriculum/bands.json"
const ENEMY_DIR: String = "res://data/enemies"


## One deterministic arena session; it owns the nodes a real arena would.
class Session:
	extends RefCounted

	const ROOM: Vector2 = Vector2(1600.0, 900.0)
	const PLAYER_SPEED: float = 120.0

	var band: Dictionary = {}
	var tick: int = 0
	var problem: Dictionary = {}
	var player_position: Vector2 = Vector2(ROOM.x * 0.5, ROOM.y * 0.5)
	var correct_answers: int = 0
	var wrong_answers: int = 0
	var finisher_fired: bool = false
	var cleared: bool = false

	var rng: Rng
	var generator: ProblemGenerator
	var spawner: OrbSpawner
	var enemy: EnemyStateMachine
	var health: Health
	var loadout: Loadout
	var assist: AssistMode
	var actions: InputActions
	var injection: InputInjection

	var _spawned: Array[AnswerOrb] = []

	func _init(session_seed: int, band_document: Dictionary, enemy_document: Dictionary) -> void:
		band = band_document
		rng = Rng.new(session_seed)
		generator = ProblemGenerator.new(rng)
		spawner = OrbSpawner.new(rng)
		enemy = EnemyStateMachine.new()
		enemy.apply_config(enemy_document)
		health = Health.new()
		loadout = Loadout.load_file()
		assist = AssistMode.new()
		actions = InputActions.new()
		injection = InputInjection.new(actions)
		actions.action_pressed.connect(_on_action_pressed)
		_present()

	## Advances the simulation one fixed tick.
	func step() -> void:
		enemy.advance(Timestep.FIXED_DELTA)
		health.advance(Timestep.FIXED_DELTA)
		var move: Vector2 = actions.move * PLAYER_SPEED * Timestep.FIXED_DELTA
		player_position = (player_position + move).clamp(Vector2.ZERO, ROOM)
		if spawner.finisher.is_ready():
			finisher_fired = spawner.finisher.trigger() or finisher_fired
		if not cleared and (spawner.is_unscrambled or spawner.orbs.is_empty()):
			_present()
		tick += 1

	## Returns the orb that answers the active problem, or null.
	func correct_orb() -> AnswerOrb:
		for orb: AnswerOrb in spawner.orbs:
			if orb.is_correct and not orb.is_popped:
				return orb
		return null

	func snapshot() -> Dictionary:
		var state: Dictionary = {
			"tick": tick,
			"entities": _entities(),
			"orbs": _orbs(),
			"problem": problem,
			"chain": spawner.chain,
			"finisher": spawner.finisher,
			"health": health,
			"loadout": loadout,
			"assist": assist,
			"cleared": cleared,
		}
		return StateSnapshot.capture(state)

	func dispose() -> void:
		if actions != null and actions.action_pressed.is_connected(_on_action_pressed):
			actions.action_pressed.disconnect(_on_action_pressed)
		for orb: AnswerOrb in _spawned:
			if is_instance_valid(orb):
				orb.free()
		_spawned.clear()
		spawner.free()
		enemy.free()
		health.free()

	func _present() -> void:
		for orb: AnswerOrb in _spawned:
			if is_instance_valid(orb):
				orb.free()
		_spawned.clear()
		problem = generator.generate(band)
		if not problem.is_empty():
			_spawned.append_array(spawner.present(problem, band, 0.0))

	func _on_action_pressed(action: String, _gesture: String, _direction: String) -> void:
		var orb: AnswerOrb = correct_orb()
		if action != "attack" or cleared or orb == null or spawner.is_unscrambled:
			return
		orb.strike()
		if not spawner.is_unscrambled:
			wrong_answers += 1
			return
		correct_answers += 1
		enemy.hp = maxi(enemy.hp - 1, 0)
		if enemy.hp == 0:
			enemy.state = EnemyStateMachine.State.UNSCRAMBLE
			cleared = true

	func _entities() -> Array:
		var hero: Dictionary = {
			"id": "player",
			"kind": "player",
			"x": player_position.x,
			"y": player_position.y,
		}
		var muddler: Dictionary = {
			"id": enemy.archetype_id,
			"kind": "enemy",
			"x": ROOM.x * 0.25,
			"y": ROOM.y * 0.5,
			"hp": enemy.hp,
			"state": EnemyStateMachine.state_name(enemy.state),
		}
		return [hero, muddler]

	func _orbs() -> Array:
		var orbs: Array = []
		for orb: AnswerOrb in spawner.orbs:
			var entry: Dictionary = {
				"value": orb.value,
				"shape": orb.shape,
				"correct": orb.is_correct,
				"popped": orb.is_popped,
			}
			orbs.append(entry)
		return orbs


var errors: Array[String] = []
var seed: int = 0
var band: Dictionary = {}
var enemy_document: Dictionary = {}
var max_ticks: int = 240
var expected_answers: int = 0

var _sessions: Array[Session] = []


func _init(path: String = DEFAULT_PATH) -> void:
	var config: Dictionary = _load_json(path)
	if config.is_empty() or int(config.get("version", 0)) != 1:
		errors.append("%s: the bot document must be version 1" % path)
	seed = int(config.get("seed", 0))
	max_ticks = maxi(int(config.get("maxTicks", max_ticks)), 1)
	expected_answers = maxi(int(config.get("expectedAnswers", 0)), 0)
	band = _find_band(String(config.get("band", "")))
	enemy_document = _load_json("%s/%s.json" % [ENEMY_DIR, String(config.get("enemy", ""))])
	if band.is_empty():
		errors.append("band '%s' is not declared in %s" % [config.get("band"), BANDS_PATH])
	if enemy_document.is_empty():
		errors.append("enemy '%s' has no document" % config.get("enemy"))


func is_valid() -> bool:
	return errors.is_empty()


## Runs the scripted session and returns its snapshot, replay, and counters.
func run() -> Dictionary:
	var session: Session = _open()
	var replay: Replay = Replay.new(seed)
	for _step: int in max_ticks:
		for event: Dictionary in _decide(session):
			replay.record(event)
			session.injection.inject(event)
		replay.advance_tick()
		session.step()
		if session.cleared:
			break
	return {
		"snapshot": _close(session),
		"replay": replay,
		"cleared": session.cleared,
		"finisher_fired": session.finisher_fired,
		"correct_answers": session.correct_answers,
		"wrong_answers": session.wrong_answers,
		"ticks": replay.ticks,
	}


## Replays [param replay] into a fresh same-seed session and returns its snapshot.
func replay_session(replay: Replay) -> Dictionary:
	var session: Session = _open()
	for at_tick: int in replay.ticks:
		for event: Dictionary in replay.events_at(at_tick):
			session.injection.inject(event)
		session.step()
	return _close(session)


## Snapshots [param session], then frees it so a run leaves no orphan nodes.
func _close(session: Session) -> Dictionary:
	var snapshot: Dictionary = session.snapshot()
	session.dispose()
	_sessions.erase(session)
	return snapshot


func dispose() -> void:
	for session: Session in _sessions:
		session.dispose()
	_sessions.clear()


func _open() -> Session:
	var session: Session = Session.new(seed, band, enemy_document)
	_sessions.append(session)
	return session


## Returns this tick's inputs: walk to the correct orb and swipe at it.
func _decide(session: Session) -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	if session.actions.is_down("attack"):
		events.append({"kind": "release", "action": "attack"})
		return events
	var orb: AnswerOrb = session.correct_orb()
	if orb == null or session.spawner.is_unscrambled:
		return events
	var direction: Vector2 = orb.position.normalized()
	var press: Dictionary = {
		"kind": "press",
		"action": "attack",
		"direction": InputActions.direction_name(direction),
	}
	events.append({"kind": "move", "x": direction.x, "y": direction.y})
	events.append(press)
	return events


func _find_band(band_id: String) -> Dictionary:
	var bands: Variant = _load_json(BANDS_PATH).get("bands", [])
	for raw: Variant in bands if bands is Array else []:
		if raw is Dictionary and String((raw as Dictionary).get("id", "")) == band_id:
			return raw as Dictionary
	return {}


static func _load_json(path: String) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed as Dictionary if parsed is Dictionary else {}
