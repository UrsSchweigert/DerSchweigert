extends GutTest
## Guards eight-direction movement, arena collision, and the follow camera.

const PLAYER_PATH: String = "res://data/combat/player.json"
const ARENA_PATH: String = "res://scenes/combat/arena.tscn"
const EPSILON: float = 0.001
const WALL_EPSILON: float = 2.0
const MAX_FRAMES: int = 120


func test_player_data_defines_movement_and_camera_numbers() -> void:
	var config: Dictionary = _player_config()
	assert_eq(int(config.get("version", 0)), 1, "player.json must declare version 1")
	for section_name: String in ["movement", "camera"]:
		var section: Dictionary = config.get(section_name, {})
		assert_false(section.is_empty(), "%s must exist" % section_name)
		for field: String in section:
			assert_true(
				float(section[field]) > 0.0, "%s.%s must be positive" % [section_name, field]
			)


func test_eight_directions_keep_their_angle_and_unit_length() -> void:
	for direction: Vector2 in _eight_directions():
		var move: Vector2 = MoveInput.eight_way(direction)
		assert_almost_eq(move.length(), 1.0, EPSILON, "%s must be unit length" % direction)
		_assert_vector_almost_eq(
			move, direction.normalized(), "%s must keep its direction" % direction
		)


func test_diagonal_input_is_not_faster_than_straight_input() -> void:
	var straight: Vector2 = MoveInput.eight_way(Vector2.RIGHT)
	var diagonal: Vector2 = MoveInput.eight_way(Vector2(1.0, 1.0))
	assert_almost_eq(diagonal.length(), straight.length(), EPSILON, "diagonal must not outrun")


func test_partial_deflection_keeps_its_magnitude() -> void:
	var half: Vector2 = MoveInput.eight_way(Vector2(0.5, 0.0))
	assert_almost_eq(half.length(), 0.5, EPSILON, "analog input must keep its magnitude")


func test_input_below_the_deadzone_is_ignored() -> void:
	assert_eq(MoveInput.eight_way(Vector2(0.1, 0.0)), Vector2.ZERO, "deadzone must be ignored")


func test_off_axis_input_snaps_to_the_nearest_direction() -> void:
	var snapped: Vector2 = MoveInput.eight_way(Vector2(1.0, 0.2))
	_assert_vector_almost_eq(snapped, Vector2.RIGHT, "near-horizontal input must snap right")


func test_keyboard_vectors_use_screen_directions() -> void:
	assert_eq(MoveInput.keyboard_vector(false, true, false, false), Vector2.RIGHT)
	assert_eq(MoveInput.keyboard_vector(false, false, true, false), Vector2.UP)
	assert_eq(MoveInput.keyboard_vector(true, true, true, true), Vector2.ZERO)


func test_combine_prefers_the_strongest_device() -> void:
	var combined: Vector2 = MoveInput.combine(Vector2(0.4, 0.0), Vector2(0.0, -0.9), Vector2.ZERO)
	_assert_vector_almost_eq(combined, Vector2(0.0, -0.9), "the stick must win")


func test_touch_vector_feeds_the_polled_direction() -> void:
	var input: MoveInput = MoveInput.new()
	input.set_touch_vector(Vector2(0.0, 1.0))
	_assert_vector_almost_eq(input.poll(), Vector2.DOWN, "touch must drive the polled direction")


func test_player_movement_reads_speed_and_acceleration_from_data() -> void:
	var player: PlayerMovement = PlayerMovement.new()
	add_child_autofree(player)
	var movement: Dictionary = _player_config().get("movement", {})
	assert_almost_eq(player.max_speed, float(movement.get("maxSpeed", 0.0)), EPSILON)
	assert_almost_eq(player.acceleration, float(movement.get("acceleration", 0.0)), EPSILON)
	assert_almost_eq(player.deceleration, float(movement.get("deceleration", 0.0)), EPSILON)
	assert_almost_eq(player.radius, float(movement.get("radius", 0.0)), EPSILON)
	assert_not_null(player.get_node_or_null("CollisionShape2D"), "the body needs a collider")


func test_velocity_accelerates_caps_and_decelerates() -> void:
	var player: PlayerMovement = PlayerMovement.new()
	add_child_autofree(player)
	var delta: float = Timestep.FIXED_DELTA
	var velocity: Vector2 = player.step_velocity(Vector2.ZERO, Vector2.RIGHT, delta)
	assert_almost_eq(velocity.x, player.acceleration * delta, EPSILON, "first step must accelerate")
	for _frame: int in MAX_FRAMES:
		velocity = player.step_velocity(velocity, Vector2.RIGHT, delta)
	assert_almost_eq(velocity.x, player.max_speed, EPSILON, "speed must cap")
	velocity = player.step_velocity(velocity, Vector2.ZERO, delta)
	assert_almost_eq(
		velocity.x,
		player.max_speed - player.deceleration * delta,
		EPSILON,
		"release must decelerate"
	)


func test_character_body_stops_at_a_static_body() -> void:
	var body: PlayerMovement = PlayerMovement.new()
	add_child_autofree(body)
	var wall: StaticBody2D = StaticBody2D.new()
	wall.position = Vector2(200.0, 0.0)
	var shape: CollisionShape2D = CollisionShape2D.new()
	var rectangle: RectangleShape2D = RectangleShape2D.new()
	rectangle.size = Vector2(40.0, 200.0)
	shape.shape = rectangle
	wall.add_child(shape)
	add_child_autofree(wall)
	body.drive(Vector2.RIGHT)
	await wait_physics_frames(MAX_FRAMES)
	assert_true(
		body.global_position.x <= 180.0 - body.radius + WALL_EPSILON,
		"the static body must block the player, at %s" % body.global_position,
	)
	var blocked: float = body.global_position.x
	await wait_physics_frames(10)
	assert_almost_eq(body.global_position.x, blocked, 0.5, "the blocked body must not advance")


func test_character_body_collides_with_tilemap_tiles() -> void:
	var layer: TileMapLayer = TileMapLayer.new()
	layer.tile_set = Arena.build_tile_set(32)
	layer.set_cell(Vector2i(4, 0), 0, Vector2i.ZERO)
	add_child_autofree(layer)
	var body: PlayerMovement = PlayerMovement.new()
	body.position = Vector2(32.0, 16.0)
	add_child_autofree(body)
	body.drive(Vector2.RIGHT)
	await wait_physics_frames(MAX_FRAMES)
	assert_true(
		body.global_position.x <= 128.0 - body.radius + WALL_EPSILON,
		"the tile must block the player, at %s" % body.global_position,
	)


func test_camera_clamps_the_center_to_the_room() -> void:
	_assert_vector_almost_eq(
		FollowCamera.clamp_center(Vector2(800, 450), Vector2(1600, 900), Vector2(800, 600)),
		Vector2(800, 450),
		"a center target must stay centered",
	)
	_assert_vector_almost_eq(
		FollowCamera.clamp_center(Vector2(-500, -500), Vector2(1600, 900), Vector2(800, 600)),
		Vector2(400, 300),
		"the top-left must stop half a viewport from the wall",
	)
	_assert_vector_almost_eq(
		FollowCamera.clamp_center(Vector2(5000, 5000), Vector2(1600, 900), Vector2(800, 600)),
		Vector2(1200, 600),
		"the bottom-right must stop half a viewport from the wall",
	)
	_assert_vector_almost_eq(
		FollowCamera.clamp_center(Vector2(50, 50), Vector2(400, 300), Vector2(800, 600)),
		Vector2(200, 150),
		"a room smaller than the viewport must stay centered",
	)


func test_camera_smooths_toward_the_clamped_target() -> void:
	var camera: FollowCamera = FollowCamera.new()
	add_child_autofree(camera)
	camera.room_size = Vector2(1600, 900)
	camera.smoothing_speed = 6.0
	camera.global_position = Vector2.ZERO
	var view: Vector2 = Vector2(800, 600)
	var next: Vector2 = camera.step_position(
		camera.global_position, Vector2(5000, 5000), view, Timestep.FIXED_DELTA
	)
	assert_true(next.x > 0.0 and next.x < 1200.0, "one step must not jump, got %s" % next)
	assert_true(next.y > 0.0 and next.y < 600.0, "one step must not jump, got %s" % next)
	for _frame: int in 300:
		camera.global_position = camera.step_position(
			camera.global_position, Vector2(5000, 5000), view, Timestep.FIXED_DELTA
		)
	_assert_vector_almost_eq(
		camera.global_position, Vector2(1200, 600), "smoothing must settle on the clamp"
	)


func test_arena_scene_wires_player_tilemap_and_camera() -> void:
	var arena: Arena = _spawn_arena()
	if arena == null:
		return
	assert_true(arena.player is PlayerMovement, "the arena needs a player body")
	assert_true(arena.floor_layer is TileMapLayer, "the arena needs a tilemap")
	assert_not_null(arena.floor_layer.tile_set, "the tilemap needs a tileset")
	if arena.floor_layer.tile_set != null:
		assert_eq(arena.floor_layer.tile_set.get_physics_layers_count(), 1, "tiles must collide")
	assert_true(arena.floor_layer.get_used_cells().size() > 0, "the arena must place border tiles")
	assert_true(arena.camera is FollowCamera, "the arena needs a follow camera")
	assert_eq(arena.camera.target, arena.player, "the camera must follow the player")
	assert_eq(arena.camera.limit_right, int(arena.room_size.x), "the camera must know the room")
	var camera_data: Dictionary = _player_config().get("camera", {})
	assert_almost_eq(
		arena.camera.smoothing_speed, float(camera_data.get("smoothingSpeed", 0.0)), EPSILON
	)
	assert_almost_eq(arena.camera.zoom.x, float(camera_data.get("zoom", 0.0)), EPSILON)


func test_player_stays_inside_the_arena_tiles() -> void:
	var arena: Arena = _spawn_arena()
	if arena == null:
		return
	arena.player.global_position = Vector2(100.0, 450.0)
	arena.player.drive(Vector2.LEFT)
	await wait_physics_frames(MAX_FRAMES)
	assert_true(
		arena.player.global_position.x >= arena.tile_size + arena.player.radius - WALL_EPSILON,
		"the border must block the player, at %s" % arena.player.global_position,
	)


func test_arena_camera_follows_and_stays_inside_the_room() -> void:
	var arena: Arena = _spawn_arena()
	if arena == null:
		return
	arena.player.global_position = Vector2(1500.0, 850.0)
	await wait_physics_frames(MAX_FRAMES)
	var clamped: Vector2 = FollowCamera.clamp_center(
		arena.player.global_position, arena.room_size, arena.camera.view_size()
	)
	_assert_vector_almost_eq(
		arena.camera.global_position, clamped, "the camera must settle on the clamped target", 1.0
	)


func _spawn_arena() -> Arena:
	var scene: PackedScene = load(ARENA_PATH) as PackedScene
	assert_not_null(scene, "arena.tscn must load")
	if scene == null:
		return null
	var arena: Arena = scene.instantiate() as Arena
	assert_not_null(arena, "arena.tscn must instantiate as Arena")
	if arena == null:
		return null
	add_child_autofree(arena)
	return arena


func _player_config() -> Dictionary:
	var file: FileAccess = FileAccess.open(PLAYER_PATH, FileAccess.READ)
	assert_not_null(file, "player.json must exist")
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	assert_true(parsed is Dictionary, "player.json must decode to an object")
	if not (parsed is Dictionary):
		return {}
	return parsed as Dictionary


func _eight_directions() -> Array[Vector2]:
	return [
		Vector2.RIGHT,
		Vector2(1, 1),
		Vector2.DOWN,
		Vector2(-1, 1),
		Vector2.LEFT,
		Vector2(-1, -1),
		Vector2.UP,
		Vector2(1, -1),
	]


func _assert_vector_almost_eq(
	actual: Vector2, expected: Vector2, message: String, tolerance: float = EPSILON
) -> void:
	assert_almost_eq(actual.x, expected.x, tolerance, "%s (x)" % message)
	assert_almost_eq(actual.y, expected.y, tolerance, "%s (y)" % message)
