extends GutTest
## Covers QA3 (replay and bot playthroughs) and QA4 (state snapshot and input API).

const BOT_PATH: String = "res://data/bots/arena.json"
const DEBUG_DIR: String = "res://scripts/debug/"

var _bots: Array[ArenaBot] = []


func after_each() -> void:
	for bot: ArenaBot in _bots:
		bot.dispose()
	_bots.clear()


func _bot(path: String = BOT_PATH) -> ArenaBot:
	var bot: ArenaBot = ArenaBot.new(path)
	_bots.append(bot)
	return bot


func _files_under(root: String, suffix: String) -> Array[String]:
	var found: Array[String] = []
	for file: String in DirAccess.get_files_at(root):
		if file.ends_with(suffix):
			found.append(root.path_join(file))
	for directory: String in DirAccess.get_directories_at(root):
		if not directory.begins_with("."):
			found.append_array(_files_under(root.path_join(directory), suffix))
	return found


func _debug_api_references() -> Array[String]:
	var found: Array[String] = []
	for root: String in ["res://scripts", "res://scenes"]:
		var files: Array[String] = _files_under(root, ".gd")
		files.append_array(_files_under(root, ".tscn"))
		for file: String in files:
			if file.begins_with(DEBUG_DIR):
				continue
			var text: String = FileAccess.get_file_as_string(file)
			if text.contains("StateSnapshot") or text.contains("InputInjection"):
				found.append(file)
	return found


func test_bot_clears_the_greybox_arena() -> void:
	var bot: ArenaBot = _bot()
	assert_true(bot.is_valid(), "bot document should validate: %s" % [bot.errors])
	var result: Dictionary = bot.run()
	assert_true(result["cleared"], "the bot should clear the arena")
	assert_eq(result["correct_answers"], bot.expected_answers)
	assert_eq(result["wrong_answers"], 0, "the bot should never answer wrong")
	assert_true(result["finisher_fired"], "24 answers should charge the finisher")
	assert_gt(int(result["ticks"]), 0)


func test_replay_round_trips_every_input_kind() -> void:
	var replay: Replay = Replay.new(7)
	replay.record({"kind": "move", "x": 1.0, "y": -1.0})
	replay.record({"kind": "press", "action": "attack", "direction": "up"})
	replay.record({"kind": "release", "action": "attack"})
	replay.advance_tick()
	replay.record({"kind": "swipe", "direction": "left"})
	assert_true(replay.is_valid(), "a well formed recording should be valid: %s" % [replay.errors])
	assert_eq(replay.size(), 4)
	assert_eq(replay.ticks, 2)
	var restored: Replay = Replay.from_json(replay.to_json())
	assert_true(restored.is_valid(), "%s" % [restored.errors])
	assert_eq(restored.seed, 7)
	assert_eq(restored.ticks, 2)
	assert_eq(restored.events_at(1).size(), 1, "the second tick holds one event")
	assert_eq(JSON.stringify(restored.to_dictionary()), JSON.stringify(replay.to_dictionary()))


func test_replay_rejects_malformed_events() -> void:
	var replay: Replay = Replay.new(1)
	assert_false(replay.record({"kind": "teleport"}))
	assert_false(replay.record({"kind": "press", "action": "fly"}))
	assert_false(replay.record({"kind": "swipe", "direction": "sideways"}))
	assert_false(replay.record({"kind": "move", "x": "far", "y": 0.0}))
	assert_eq(replay.size(), 0, "rejected events must not be recorded")
	assert_false(replay.is_valid())
	assert_false(Replay.from_json("[]").is_valid())
	assert_false(Replay.from_dictionary({"version": 99, "events": "nope"}).is_valid())


func test_recorded_session_replays_to_the_same_snapshot() -> void:
	var bot: ArenaBot = _bot()
	var result: Dictionary = bot.run()
	var replay: Replay = result["replay"] as Replay
	assert_true(replay.is_valid(), "%s" % [replay.errors])
	assert_gt(replay.size(), 0, "the run should record inputs")
	var replayed: Dictionary = bot.replay_session(replay)
	assert_eq(JSON.stringify(replayed), JSON.stringify(result["snapshot"]))


func test_snapshot_exposes_the_live_state() -> void:
	var bot: ArenaBot = _bot()
	var snapshot: Dictionary = bot.run()["snapshot"] as Dictionary
	for key: String in ["version", "tick", "entities", "orbs", "problem", "chain", "health"]:
		assert_true(snapshot.has(key), "snapshot is missing '%s'" % key)
	assert_true(snapshot.has("entitlement"), "snapshot should carry the entitlement")
	assert_eq((snapshot["entities"] as Array).size(), 2, "the hero and the muddler")
	var problem: Dictionary = snapshot["problem"] as Dictionary
	assert_true(problem.has("answer"), "a live session should hold a problem")
	var chain: Dictionary = snapshot["chain"] as Dictionary
	assert_true(chain.has("tier") and chain.has("ready"), "the chain should expose its charge")
	var health: Dictionary = snapshot["health"] as Dictionary
	assert_eq(int(health["hearts"]), int(health["maxHearts"]), "the bot never gets hit")
	var entitlement: Dictionary = snapshot["entitlement"] as Dictionary
	assert_true(entitlement.has("weaponsOwned"), "the entitlement should list owned weapons")
	assert_true(entitlement.has("assistMode"), "the entitlement should carry the assist mode")
	assert_true(bool(snapshot["cleared"]), "the captured session is a cleared run")
	assert_true(JSON.parse_string(JSON.stringify(snapshot)) is Dictionary)


func test_input_injection_drives_the_shared_actions() -> void:
	var actions: InputActions = InputActions.new()
	var player: PlayerMovement = PlayerMovement.new()
	var injection: InputInjection = InputInjection.new(actions, player)
	var pressed: Array = []
	actions.action_pressed.connect(
		func(action: String, gesture: String, direction: String) -> void:
			pressed.append([action, gesture, direction])
	)
	assert_true(injection.inject({"kind": "move", "x": 1.0, "y": 0.0}))
	assert_gt(actions.move.length(), 0.0, "an injected move should reach the actions")
	assert_true(injection.inject({"kind": "press", "action": "attack", "direction": "up"}))
	assert_eq(pressed, [["attack", "swipe", "up"]], "the attack should swipe up")
	assert_true(injection.inject({"kind": "release", "action": "attack"}))
	assert_false(actions.is_down("attack"))
	assert_false(injection.inject({"kind": "teleport"}), "unknown kinds are refused")
	assert_eq(injection.errors.size(), 1)
	assert_true(injection.set_move(Vector2.ZERO))
	assert_eq(actions.move, Vector2.ZERO, "a zero move should release the stick")
	player.free()


func test_debug_apis_are_guarded_and_unused() -> void:
	for path: String in [
		"res://scripts/debug/input_injection.gd", "res://scripts/debug/state_snapshot.gd"
	]:
		assert_true(FileAccess.file_exists(path), "%s should exist" % path)
		assert_string_contains(FileAccess.get_file_as_string(path), "OS.is_debug_build()")
	assert_eq(StateSnapshot.is_available(), OS.is_debug_build())
	assert_eq(InputInjection.is_available(), OS.is_debug_build())
	assert_eq(_debug_api_references(), [], "only scripts/debug may use the debug APIs")
	var project: String = FileAccess.get_file_as_string("res://project.godot")
	assert_false(project.contains("StateSnapshot"), "the debug snapshot must not autoload")
	assert_false(project.contains("InputInjection"), "input injection must not autoload")


func test_bot_document_names_a_playable_band_and_enemy() -> void:
	var bot: ArenaBot = _bot()
	assert_true(bot.is_valid(), "%s" % [bot.errors])
	assert_eq(bot.expected_answers, 24, "the muddler has 24 hit points")
	assert_true(bot.band.has("operations"), "the bot band should declare operations")
	assert_eq(String(bot.enemy_document.get("id", "")), "muddler_meadow")
	var broken: ArenaBot = _bot("res://data/bots/missing.json")
	assert_false(broken.is_valid(), "a missing bot document must not validate")
