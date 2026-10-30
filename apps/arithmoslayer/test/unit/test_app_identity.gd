extends GutTest
## Guards the app identity, the Android target record, and the safe-area root.

const PROJECT_SETTINGS_PATH: String = "res://project.godot"
const VERSION_PATH: String = "res://VERSION"
const ANDROID_TARGETS_PATH: String = "res://data/android_targets.json"
const ROOT_SCENE_PATH: String = "res://scenes/ui/root.tscn"
const MAIN_SCENE_PATH: String = "res://scenes/main.tscn"
const EXPECTED_NAME: String = "Arithmoslayer"
const EXPECTED_PACKAGE: String = "de.derschweigert.arithmoslayer"
const EXPECTED_MIN_SDK: int = 24
const EXPECTED_TARGET_SDK: int = 36
const BILLING_PERMISSION: String = "com.android.vending.BILLING"
const ORIENTATION_SETTING: String = "display/window/handheld/orientation"


func test_project_name_is_arithmoslayer() -> void:
	assert_eq(str(ProjectSettings.get_setting("application/config/name", "")), EXPECTED_NAME)


func test_android_package_is_recorded() -> void:
	var package: String = str(ProjectSettings.get_setting("application/config/android_package", ""))
	assert_eq(package, EXPECTED_PACKAGE)


func test_phones_and_tablets_use_landscape_orientation() -> void:
	var orientation: int = int(ProjectSettings.get_setting(ORIENTATION_SETTING, -1))
	assert_eq(orientation, int(DisplayServer.SCREEN_LANDSCAPE))
	assert_true(
		_read_text(PROJECT_SETTINGS_PATH).contains("window/handheld/orientation=0"),
		"project.godot must set the landscape orientation explicitly",
	)


func test_version_file_records_name_and_code() -> void:
	var version: Dictionary = _read_version()
	var version_name: String = str(version.get("versionName", ""))
	var version_code: String = str(version.get("versionCode", ""))
	assert_true(_is_semver(version_name), "versionName must look like 1.0.0")
	assert_true(version_code.is_valid_int(), "versionCode must be an integer")
	assert_gt(int(version_code), 0)


func test_project_version_matches_version_name() -> void:
	var version_name: String = str(_read_version().get("versionName", ""))
	assert_eq(str(ProjectSettings.get_setting("application/config/version", "")), version_name)


func test_android_targets_record_sdk_levels() -> void:
	var targets: Dictionary = _read_json(ANDROID_TARGETS_PATH)
	assert_eq(int(targets.get("minSdk", 0)), EXPECTED_MIN_SDK)
	assert_eq(int(targets.get("targetSdk", 0)), EXPECTED_TARGET_SDK)
	assert_lte(int(targets.get("minSdk", 0)), int(targets.get("targetSdk", 0)))


func test_android_targets_request_only_billing() -> void:
	var targets: Dictionary = _read_json(ANDROID_TARGETS_PATH)
	var permissions: Array = targets.get("permissions", [])
	assert_eq(permissions, [BILLING_PERMISSION])


func test_android_targets_have_a_source_note() -> void:
	var targets: Dictionary = _read_json(ANDROID_TARGETS_PATH)
	var source: String = str(targets.get("source", "")).strip_edges()
	assert_gt(source.length(), 20, "the target record must cite its source")


func test_safe_area_applies_a_fake_rect_to_the_root_control() -> void:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	add_child_autofree(root)
	root.apply_safe_area(Rect2i(10, 20, 100, 50), Vector2i(120, 100))
	assert_eq(root.offset_left, 10.0)
	assert_eq(root.offset_top, 20.0)
	assert_eq(root.offset_right, -10.0)
	assert_eq(root.offset_bottom, -30.0)


func test_safe_area_insets_match_a_fake_rect() -> void:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	add_child_autofree(root)
	var insets: Vector4i = root.safe_area_insets(Rect2i(10, 20, 100, 50), Vector2i(120, 100))
	assert_eq(insets, Vector4i(10, 20, 10, 30))


func test_safe_area_is_zero_for_an_empty_rect() -> void:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	add_child_autofree(root)
	root.apply_safe_area(Rect2i(), Vector2i(120, 100))
	assert_eq(root.offset_left, 0.0)
	assert_eq(root.offset_top, 0.0)
	assert_eq(root.offset_right, 0.0)
	assert_eq(root.offset_bottom, 0.0)


func test_safe_area_clamps_a_rect_larger_than_the_viewport() -> void:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	add_child_autofree(root)
	var insets: Vector4i = root.safe_area_insets(Rect2i(-10, -20, 200, 200), Vector2i(120, 100))
	assert_eq(insets, Vector4i.ZERO)


func test_safe_area_is_zero_for_a_zero_viewport() -> void:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	add_child_autofree(root)
	assert_eq(root.safe_area_insets(Rect2i(10, 20, 100, 50), Vector2i.ZERO), Vector4i.ZERO)


func test_root_scene_is_a_safe_area_control() -> void:
	var scene: PackedScene = load(ROOT_SCENE_PATH) as PackedScene
	assert_not_null(scene, "root.tscn must load")
	if scene == null:
		return
	var instance: Node = scene.instantiate()
	add_child_autofree(instance)
	assert_true(instance is SafeAreaRoot, "the root control must apply the safe area")
	assert_not_null(instance.get_node_or_null("TitleLabel"))
	assert_not_null(instance.get_node_or_null("TaglineLabel"))


func test_main_scene_instances_the_safe_area_root() -> void:
	var scene: PackedScene = load(MAIN_SCENE_PATH) as PackedScene
	assert_not_null(scene, "main.tscn must load")
	if scene == null:
		return
	var instance: Node = scene.instantiate()
	add_child_autofree(instance)
	var root: Node = instance.get_node_or_null("Ui/Root")
	assert_not_null(root, "main.tscn must keep the Ui/Root path")
	if root == null:
		return
	assert_true(root is SafeAreaRoot, "Ui/Root must be the safe-area root scene")


func _read_version() -> Dictionary:
	var version: Dictionary = {}
	for line: String in _read_text(VERSION_PATH).split("\n"):
		var entry: String = line.strip_edges()
		if entry.is_empty() or entry.begins_with("#"):
			continue
		var separator: int = entry.find("=")
		assert_ne(separator, -1, "VERSION line '%s' must be key=value" % entry)
		if separator == -1:
			continue
		var key: String = entry.substr(0, separator).strip_edges()
		version[key] = entry.substr(separator + 1).strip_edges()
	return version


func _is_semver(value: String) -> bool:
	var pattern: RegEx = RegEx.new()
	assert_eq(pattern.compile("^\\d+\\.\\d+\\.\\d+$"), OK)
	return pattern.search(value) != null


func _read_json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(_read_text(path))
	assert_eq(typeof(parsed), TYPE_DICTIONARY, "%s must hold a JSON object" % path)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	var data: Dictionary = parsed
	return data


func _read_text(path: String) -> String:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	assert_not_null(file, "could not open %s" % path)
	if file == null:
		return ""
	var text: String = file.get_as_text()
	file.close()
	return text
