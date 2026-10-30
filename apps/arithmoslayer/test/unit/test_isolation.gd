extends GutTest
## Exercises the isolation and offline guard tools, including their failure paths.

const ISOLATION_TOOL: String = "tools/check_isolation.py"
const OFFLINE_TOOL: String = "tools/check_offline.py"
const NETWORK_CLASS_PROBE: String = "HTTP" + "Request"
const FORBIDDEN_REFERENCE_PROBE: String = "sites" + "/ffm"
const PERMISSION_PROBE: String = "permissions/" + "internet=true"

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_isolation_tool_passes_for_this_project() -> void:
	assert_eq(_run_python(ISOLATION_TOOL, []), 0)


func test_offline_tool_passes_for_this_project() -> void:
	assert_eq(_run_python(OFFLINE_TOOL, []), 0)


func test_offline_tool_rejects_network_classes() -> void:
	var root: String = _make_temp_dir("offline_network")
	_write_text(root.path_join("probe.gd"), "var client := %s.new()\n" % NETWORK_CLASS_PROBE)
	assert_ne(_run_python(OFFLINE_TOOL, ["--root", root]), 0)


func test_offline_tool_rejects_unapproved_permissions() -> void:
	var root: String = _make_temp_dir("offline_permissions")
	_write_text(root.path_join("project.godot"), "[android]\n\n%s\n" % PERMISSION_PROBE)
	assert_ne(_run_python(OFFLINE_TOOL, ["--root", root]), 0)


func test_isolation_tool_rejects_web_game_reference() -> void:
	var root: String = _make_temp_dir("isolation_reference")
	_write_text(root.path_join("apps/arithmoslayer/project.godot"), "")
	_write_text(
		root.path_join("apps/arithmoslayer/notes.md"),
		"see %s for the browser game\n" % FORBIDDEN_REFERENCE_PROBE,
	)
	assert_ne(_run_python(ISOLATION_TOOL, ["--repo-root", root]), 0)


func test_isolation_tool_rejects_changes_outside_project() -> void:
	var root: String = _make_temp_dir("isolation_paths")
	_write_text(root.path_join("apps/arithmoslayer/project.godot"), "")
	_write_text(root.path_join(FORBIDDEN_REFERENCE_PROBE).path_join("leak.txt"), "leak\n")
	assert_eq(_run_tool("git", ["init", "-q", root]), 0)
	assert_ne(_run_python(ISOLATION_TOOL, ["--repo-root", root]), 0)


func _run_python(script: String, arguments: Array[String]) -> int:
	var command: Array[String] = [script]
	command.append_array(arguments)
	return _run_tool("python3", command)


func _run_tool(program: String, arguments: Array[String]) -> int:
	var output: Array = []
	var command_arguments: PackedStringArray = PackedStringArray(arguments)
	var exit_code: int = OS.execute(program, command_arguments, output, true)
	for line: String in output:
		print("[%s] %s" % [program, str(line).strip_edges()])
	return exit_code


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("guard_probe")
	var dir_path: String = base.path_join("%s_%d" % [label, Time.get_ticks_usec()])
	DirAccess.make_dir_recursive_absolute(dir_path)
	_temp_dirs.append(dir_path)
	return dir_path


func _write_text(path: String, content: String) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "could not write %s" % path)
	if file == null:
		return
	file.store_string(content)
	file.close()


func _remove_tree(dir_path: String) -> void:
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full_path: String = dir_path.path_join(entry)
		if dir.current_is_dir():
			_remove_tree(full_path)
		else:
			DirAccess.remove_absolute(full_path)
		entry = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(dir_path)
