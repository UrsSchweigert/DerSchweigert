extends SceneTree
# Trusted smoke check: loads every script, scene, and resource in the project and fails on any error.
# Copied into a throwaway copy of the project by /opt/harness/smoke/godot_project.sh.
#
# Every declaration is typed on purpose: projects are expected to treat untyped-declaration warnings as errors,
# and this file compiles under the project's own settings.
@warning_ignore_start("untyped_declaration")

const EXTENSIONS := ["gd", "tscn", "scn", "tres", "res", "gdshader"]
const FAILURE_CAP := 40

var failures: Array[String] = []
var checked: int = 0


func _initialize() -> void:
	_walk("res://")
	if failures.is_empty():
		print("OK: godot smoke test passed (%d resources load and instantiate)" % checked)
		quit(0)
		return
	var shown: int = mini(failures.size(), FAILURE_CAP)
	for index in shown:
		print("FAIL: %s" % failures[index])
	if failures.size() > shown:
		print("FAIL: %d more failures suppressed" % (failures.size() - shown))
	quit(1)


func _walk(dir_path: String) -> void:
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		failures.append("cannot open %s" % dir_path)
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		if not entry.begins_with("."):
			var full: String = dir_path.path_join(entry)
			if dir.current_is_dir():
				if not _is_image_test_framework(dir_path, entry):
					_walk(full)
			elif entry.get_extension().to_lower() in EXTENSIONS and entry != "harness_verify.gd":
				_check(full)
		entry = dir.get_next()
	dir.list_dir_end()


func _is_image_test_framework(dir_path: String, entry: String) -> bool:
	# The image copies GUT in so test scripts compile; its own internals are trusted image content, not project code.
	return entry == "gut" and dir_path.get_file() == "addons"


func _check(path: String) -> void:
	checked += 1
	var res: Resource = _load_quiet(path)
	if res == null:
		failures.append("cannot load %s" % path)
		return
	var script: GDScript = res as GDScript
	if script != null and not script.can_instantiate():
		failures.append("%s does not compile" % path)
		return
	var scene: PackedScene = res as PackedScene
	if scene == null:
		return
	var instance: Node = scene.instantiate()
	if instance == null:
		failures.append("cannot instantiate %s" % path)
		return
	instance.free()


func _load_quiet(path: String) -> Resource:
	# Godot 4.7.2 crashes while printing a parse-error backtrace raised from a --script main loop, so the
	# engine's error printer is muted for the load itself and this script reports what failed instead.
	var previous: bool = Engine.print_error_messages
	Engine.print_error_messages = false
	var res: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_REUSE)
	Engine.print_error_messages = previous
	return res
