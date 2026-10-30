extends GutTest
## Guards the engine pin, the project settings, and the documented autoloads.

const PROJECT_ROOT: String = "res://"
const ENGINE_VERSION_FILE: String = "res://engine-version.txt"
const MAIN_SCENE_PATH: String = "res://scenes/main.tscn"
const EXPECTED_ENGINE_VERSION: String = "4.7.2-stable"
const EXPECTED_AUTOLOADS: Array[String] = ["GameState"]
const UNTYPED_DECLARATION_IS_ERROR: int = 2


func test_engine_version_file_is_pinned() -> void:
	var file: FileAccess = FileAccess.open(ENGINE_VERSION_FILE, FileAccess.READ)
	assert_not_null(file, "engine-version.txt must exist")
	if file == null:
		return
	assert_eq(file.get_as_text().strip_edges(), EXPECTED_ENGINE_VERSION)


func test_project_features_pin_godot_47() -> void:
	var features: PackedStringArray = ProjectSettings.get_setting(
		"application/config/features", PackedStringArray()
	)
	assert_true(features.has("4.7"), "the project must pin the 4.7 feature set")


func test_untyped_declaration_warning_is_an_error() -> void:
	var level: int = int(
		ProjectSettings.get_setting("debug/gdscript/warnings/untyped_declaration", 0)
	)
	assert_eq(level, UNTYPED_DECLARATION_IS_ERROR)


func test_only_documented_autoloads_are_registered() -> void:
	assert_eq(_registered_autoloads(), EXPECTED_AUTOLOADS)


func test_game_state_autoload_is_available() -> void:
	var game_state: Node = get_node_or_null("/root/GameState")
	assert_not_null(game_state, "the GameState autoload must be registered")
	if game_state == null:
		return
	game_state.reset()
	game_state.add_points(3)
	assert_eq(game_state.score, 3)
	game_state.reset()
	assert_eq(game_state.score, 0)


func test_main_scene_instantiates() -> void:
	var scene: PackedScene = load(MAIN_SCENE_PATH) as PackedScene
	assert_not_null(scene, "the main scene must load")
	if scene == null:
		return
	var instance: Node = scene.instantiate()
	assert_not_null(instance, "the main scene must instantiate")
	if instance == null:
		return
	add_child_autofree(instance)
	assert_eq(instance.name, "Main")


func _registered_autoloads() -> Array[String]:
	var names: Array[String] = []
	for property: Dictionary in ProjectSettings.get_property_list():
		var setting: String = str(property.get("name", ""))
		if not setting.begins_with("autoload/"):
			continue
		var autoload_name: String = setting.trim_prefix("autoload/")
		if not autoload_name.contains("/"):
			names.append(autoload_name)
	names.sort()
	return names
