class_name Arena
extends Node2D
## Builds the greybox arena: a tilemap floor ringed with collidable tiles.
##
## The room size defines both the tile border and the camera bounds. The player
## spawns in the middle, a static pillar proves body collision, and the camera
## follows the player inside the room. Art is intentionally absent.
##
## Every device feeds one [InputActions] object: the touch overlay and the
## gamepad/keyboard poller share it with the hero and the dodge.

const TILE_SIZE: int = 32
const DEFAULT_ROOM_SIZE: Vector2 = Vector2(1600.0, 900.0)
const PHYSICS_LAYER: int = 1

@export var room_size: Vector2 = DEFAULT_ROOM_SIZE
@export var tile_size: int = TILE_SIZE

var actions: InputActions = InputActions.new()
var assist: AssistMode = AssistMode.new()
var touch_controls: TouchControls = null

@onready var floor_layer: TileMapLayer = $Floor
@onready var player: PlayerMovement = $Player
@onready var camera: FollowCamera = $Camera
@onready var health: Health = $Player/Health
@onready var dodge: Dodge = $Player/Dodge
@onready var respawn: Respawn = $Respawn
@onready var gamepad_keyboard: GamepadKeyboard = $Input/GamepadKeyboard


func _ready() -> void:
	floor_layer.tile_set = build_tile_set(tile_size)
	_build_walls()
	camera.room_size = room_size
	camera.target = player
	camera.apply_room()
	camera.snap_to_target()
	camera.make_current()
	respawn.entrance_position = player.global_position
	health.bind_dodge(dodge)
	health.defeated.connect(_on_player_defeated)
	gamepad_keyboard.actions = actions
	touch_controls = TouchControls.new()
	add_child(touch_controls)
	touch_controls.bind(actions)
	player.actions = actions
	actions.action_pressed.connect(_on_action_pressed)


func _physics_process(delta: float) -> void:
	health.advance(delta)
	dodge.advance(delta)
	player.speed_multiplier = dodge.speed_scale()
	respawn.advance(delta, player, health, dodge)


func _on_action_pressed(action: String, _gesture: String, _direction: String) -> void:
	if action == "dodge":
		try_dodge()


## Starts a dodge roll when the cooldown allows it.
func try_dodge() -> bool:
	return dodge.try_dodge()


func _on_player_defeated() -> void:
	respawn.begin(health)


## Returns a one-tile tileset whose single tile carries a full-cell collision
## polygon on the arena physics layer.
static func build_tile_set(size: int) -> TileSet:
	var tiles: TileSet = TileSet.new()
	tiles.tile_size = Vector2i(size, size)
	tiles.add_physics_layer()
	tiles.set_physics_layer_collision_layer(0, PHYSICS_LAYER)
	var image: Image = Image.create(size, size, false, Image.FORMAT_RGBA8)
	image.fill(Color(0.16, 0.18, 0.22))
	var source: TileSetAtlasSource = TileSetAtlasSource.new()
	source.texture = ImageTexture.create_from_image(image)
	source.texture_region_size = Vector2i(size, size)
	source.create_tile(Vector2i.ZERO)
	tiles.add_source(source, 0)
	var data: TileData = source.get_tile_data(Vector2i.ZERO, 0)
	data.add_collision_polygon(0)
	var half: float = float(size) * 0.5
	var points: PackedVector2Array = PackedVector2Array(
		[Vector2(-half, -half), Vector2(half, -half), Vector2(half, half), Vector2(-half, half)]
	)
	data.set_collision_polygon_points(0, 0, points)
	return tiles


func _build_walls() -> void:
	var columns: int = maxi(int(room_size.x / float(tile_size)), 3)
	var rows: int = maxi(int(room_size.y / float(tile_size)), 3)
	for column: int in columns:
		for row: int in rows:
			if column == 0 or row == 0 or column == columns - 1 or row == rows - 1:
				floor_layer.set_cell(Vector2i(column, row), 0, Vector2i.ZERO)
