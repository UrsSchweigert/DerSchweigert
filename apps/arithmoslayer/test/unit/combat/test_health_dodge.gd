extends GutTest
## Guards hearts health, dodge i-frames and cooldown, and checkpoint respawn.

const HEALTH_PATH: String = "res://data/combat/health.json"
const ARENA_PATH: String = "res://scenes/combat/arena.tscn"
const WEAPON_DIR: String = "res://data/weapons"
const EPSILON: float = 0.001


func after_each() -> void:
	GameState.reset()


func test_health_data_defines_hearts_dodge_and_respawn() -> void:
	var config: Dictionary = _health_config()
	assert_eq(int(config.get("version", 0)), 1, "health.json must declare version 1")
	var hearts: Dictionary = config.get("health", {})
	var maximum: int = int(hearts.get("maxHearts", 0))
	assert_gt(maximum, 0, "the hero needs hearts")
	assert_between(int(hearts.get("startingHearts", 0)), 1, maximum)
	assert_gt(float(hearts.get("hitInvulnerabilitySeconds", 0.0)), 0.0)
	var dodge: Dictionary = config.get("dodge", {})
	var duration: float = float(dodge.get("durationSeconds", 0.0))
	var start: float = float(dodge.get("invulnerabilityStartSeconds", -1.0))
	var end: float = float(dodge.get("invulnerabilityEndSeconds", -1.0))
	assert_gt(duration, 0.0)
	assert_gt(float(dodge.get("cooldownSeconds", 0.0)), duration, "cooldown must outlast the roll")
	assert_true(start >= 0.0 and start < end and end <= duration, "i-frames must fit the roll")
	assert_gt(float(dodge.get("speedMultiplier", 0.0)), 1.0)
	assert_true(config.get("respawn", {}) is Dictionary)


func test_damage_costs_a_heart_and_starts_hit_iframes() -> void:
	var health: Health = _health()
	var section: Dictionary = _health_config()["health"]
	assert_eq(health.max_hearts, int(section["maxHearts"]))
	assert_eq(health.hearts, int(section["startingHearts"]))
	var before: int = health.hearts
	assert_true(health.damage(), "the first hit must land")
	assert_eq(health.hearts, before - 1)
	assert_true(health.is_invulnerable())
	assert_false(health.damage(), "a hit inside the i-frames must not land")
	assert_eq(health.hearts, before - 1)
	health.advance(health.hit_invulnerability)
	assert_false(health.is_invulnerable())
	assert_true(health.damage())
	assert_eq(health.heal(1), 1)
	assert_eq(health.heal(99), 1, "healing stops at the maximum")
	assert_eq(health.heal(1), 0, "full hearts cannot be overfilled")
	health.advance(health.hit_invulnerability)
	assert_true(health.damage(health.max_hearts))
	assert_true(health.is_defeated())
	assert_eq(health.heal(1), 0, "healing must not revive a defeated hero")
	health.restore()
	assert_eq(health.hearts, health.max_hearts)
	assert_false(health.is_defeated())


func test_dodge_grants_iframes_only_inside_the_data_window() -> void:
	var dodge: Dodge = _dodge()
	var start: float = dodge.invulnerability_start_seconds
	var end: float = dodge.invulnerability_end_seconds
	assert_true(dodge.try_dodge())
	assert_false(dodge.is_invulnerable(), "the roll starts before its i-frames")
	dodge.advance(start)
	assert_true(dodge.is_invulnerable(), "i-frames start at the data-defined time")
	dodge.advance(end - start - EPSILON)
	assert_true(dodge.is_invulnerable(), "i-frames last until their end")
	dodge.advance(EPSILON)
	assert_false(dodge.is_invulnerable(), "i-frames stop at the data-defined end")
	assert_true(dodge.is_rolling())
	dodge.advance(dodge.duration_seconds)
	assert_false(dodge.is_rolling(), "the roll must end on its duration")


func test_dodge_iframes_block_damage_until_the_window_ends() -> void:
	var health: Health = _health()
	var dodge: Dodge = _dodge()
	health.bind_dodge(dodge)
	assert_true(dodge.try_dodge())
	assert_false(dodge.is_invulnerable(), "the roll starts before its i-frames")
	assert_true(health.damage(), "a hit before the i-frames must land")
	health.advance(health.hit_invulnerability)
	var before: int = health.hearts
	dodge.advance(dodge.invulnerability_start_seconds)
	assert_true(dodge.is_invulnerable())
	assert_false(health.damage(), "a hit inside the roll i-frames must not land")
	assert_eq(health.hearts, before, "the roll must keep every heart")
	dodge.advance(dodge.invulnerability_end_seconds - dodge.invulnerability_start_seconds + EPSILON)
	assert_false(dodge.is_invulnerable(), "the i-frames end at their data-defined end")
	health.advance(dodge.invulnerability_end_seconds)
	assert_false(health.is_invulnerable(), "the roll must not outlast its i-frames")
	assert_true(health.damage(), "a hit after the i-frames must land")
	assert_eq(health.hearts, before - 1)


func test_dodge_cooldown_is_data_defined_and_blocks_a_second_roll() -> void:
	var dodge: Dodge = _dodge()
	assert_true(dodge.try_dodge())
	assert_false(dodge.can_dodge())
	assert_false(dodge.try_dodge(), "a second roll must wait for the cooldown")
	dodge.advance(dodge.duration_seconds)
	assert_false(dodge.is_rolling())
	assert_false(dodge.can_dodge(), "the cooldown must outlast the roll")
	dodge.advance(dodge.cooldown_seconds)
	assert_true(dodge.can_dodge())
	assert_true(dodge.try_dodge(), "the roll must be ready after the cooldown")


func test_dodge_cancels_every_shipped_weapon() -> void:
	var paths: Array[String] = _weapon_paths()
	assert_gt(paths.size(), 0, "at least one weapon must ship")
	for path: String in paths:
		var engine: ComboEngine = ComboEngine.new(WeaponDefinition.load_file(path))
		assert_true(engine.start(), "%s must start" % path)
		var dodge: Dodge = _dodge()
		assert_true(dodge.try_dodge(engine), "%s must allow a dodge" % path)
		assert_eq(engine.state, ComboEngine.State.IDLE, "%s must be cancelled" % path)
		assert_false(dodge.try_dodge(engine), "%s must respect the cooldown" % path)


func test_defeat_respawns_at_the_entrance_with_full_hearts() -> void:
	var player: Node2D = Node2D.new()
	add_child_autofree(player)
	player.global_position = Vector2(999.0, 999.0)
	var health: Health = _health()
	var respawn: Respawn = _respawn()
	respawn.entrance_position = Vector2(100.0, 200.0)
	assert_true(health.damage(health.max_hearts))
	assert_true(respawn.begin(health))
	assert_true(respawn.is_pending())
	assert_false(respawn.advance(respawn.delay_seconds * 0.5, player, health))
	assert_eq(player.global_position, Vector2(999.0, 999.0), "the delay must hold the body")
	assert_true(respawn.advance(respawn.delay_seconds * 0.5 + EPSILON, player, health))
	assert_eq(player.global_position, Vector2(100.0, 200.0))
	assert_eq(health.hearts, health.max_hearts)
	assert_true(health.is_invulnerable(), "respawn must grant invulnerability")
	assert_false(respawn.is_pending())


func test_checkpoint_replaces_the_entrance() -> void:
	var respawn: Respawn = _respawn()
	respawn.entrance_position = Vector2(10.0, 20.0)
	respawn.set_checkpoint(Vector2(300.0, 400.0))
	assert_true(respawn.has_checkpoint)
	assert_eq(respawn.spawn_position(), Vector2(300.0, 400.0))
	var player: Node2D = Node2D.new()
	add_child_autofree(player)
	var health: Health = _health()
	assert_true(health.damage(health.max_hearts))
	assert_eq(respawn.respawn_now(player, health), Vector2(300.0, 400.0))
	assert_eq(player.global_position, Vector2(300.0, 400.0))


func test_respawn_keeps_earned_items_and_score() -> void:
	GameState.add_points(30)
	var respawn: Respawn = _respawn()
	respawn.set_progress({"items": ["glaive"], "orbs": 4})
	var player: Node2D = Node2D.new()
	add_child_autofree(player)
	var health: Health = _health()
	assert_true(health.damage(health.max_hearts))
	respawn.respawn_now(player, health)
	assert_eq(GameState.score, 30, "defeat must not reset the score")
	assert_eq(respawn.earned_progress()["orbs"], 4)
	var items: Array = respawn.earned_progress()["items"]
	assert_eq(items[0], "glaive")


func test_arena_wires_health_dodge_and_respawn() -> void:
	var arena: Arena = load(ARENA_PATH).instantiate() as Arena
	add_child_autofree(arena)
	assert_not_null(arena.health, "the arena needs hearts")
	assert_not_null(arena.dodge, "the arena needs a dodge")
	assert_not_null(arena.respawn, "the arena needs a respawn")
	assert_eq(arena.respawn.entrance_position, arena.player.global_position)
	assert_eq(arena.health.max_hearts, int(_health_config()["health"]["maxHearts"]))
	assert_eq(arena.health.dodge, arena.dodge, "the arena must bind the roll to the hearts")
	assert_true(arena.try_dodge(), "the arena must expose the dodge")
	arena.dodge.advance(arena.dodge.invulnerability_start_seconds)
	assert_false(arena.health.damage(), "a hit inside the arena roll must not land")
	assert_eq(arena.health.hearts, arena.health.max_hearts)
	assert_false(arena.try_dodge(), "the arena must respect the cooldown")


func _health() -> Health:
	var health: Health = Health.new()
	add_child_autofree(health)
	return health


func _dodge() -> Dodge:
	var dodge: Dodge = Dodge.new()
	add_child_autofree(dodge)
	return dodge


func _respawn() -> Respawn:
	var respawn: Respawn = Respawn.new()
	add_child_autofree(respawn)
	return respawn


func _health_config() -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(HEALTH_PATH))
	assert_true(parsed is Dictionary, "health.json must decode to an object")
	return parsed as Dictionary if parsed is Dictionary else {}


func _weapon_paths() -> Array[String]:
	var paths: Array[String] = []
	for file_name: String in DirAccess.get_files_at(WEAPON_DIR):
		if (
			file_name.ends_with(".json")
			and file_name != "schema.json"
			and file_name != "loadout.json"
		):
			paths.append(WEAPON_DIR.path_join(file_name))
	paths.sort()
	return paths
