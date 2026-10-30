extends GutTest
## Guards seedable randomness, the fixed timestep, and the ban on direct
## randomness calls in project scripts.

const SCRIPTS_ROOT: String = "res://scripts"
const RNG_SCRIPT_PATH: String = "res://scripts/core/rng.gd"
const FORBIDDEN_CALL_PATTERN: String = "\\b(?:randi|randf)(?:_range)?\\s*\\(|\\brandomize\\s*\\("
const SAMPLE_COUNT: int = 16

var _temp_dirs: Array[String] = []


func after_each() -> void:
	for dir_path: String in _temp_dirs:
		_remove_tree(dir_path)
	_temp_dirs.clear()


func test_rng_script_exists() -> void:
	assert_true(FileAccess.file_exists(RNG_SCRIPT_PATH), "scripts/core/rng.gd must exist")


func test_same_seed_produces_the_same_sequence() -> void:
	var first: Rng = Rng.new(12345)
	var second: Rng = Rng.new(12345)
	assert_eq(_sample(first), _sample(second))


func test_different_seeds_produce_different_sequences() -> void:
	var first: Rng = Rng.new(1)
	var second: Rng = Rng.new(2)
	assert_ne(_sample(first), _sample(second))


func test_reseeding_restarts_the_sequence() -> void:
	var generator: Rng = Rng.new(99)
	var first_sequence: Array[float] = _sample(generator)
	generator.set_seed(99)
	assert_eq(generator.get_seed(), 99)
	assert_eq(_sample(generator), first_sequence)


func test_ranges_stay_within_bounds() -> void:
	var generator: Rng = Rng.new(7)
	for _iteration: int in SAMPLE_COUNT:
		var float_value: float = generator.randf_range(2.0, 3.0)
		assert_true(float_value >= 2.0 and float_value <= 3.0, "randf_range must stay in range")
		var int_value: int = generator.randi_range(-2, 2)
		assert_true(int_value >= -2 and int_value <= 2, "randi_range must stay in range")


func test_fixed_delta_is_one_sixtieth() -> void:
	assert_eq(Timestep.FIXED_DELTA, 1.0 / 60.0)


func test_scripts_do_not_call_global_randomness() -> void:
	var violations: Array[String] = _find_forbidden_calls(SCRIPTS_ROOT, RNG_SCRIPT_PATH)
	assert_eq(
		violations.size(),
		0,
		(
			"use Rng instead of direct randomness calls:\n%s"
			% "\n".join(PackedStringArray(violations))
		),
	)


func test_scanner_reports_direct_randomness_with_file_and_line() -> void:
	var root: String = _make_temp_dir("randomness_probe")
	_write_text(
		root.path_join("bad.gd"),
		"extends Node\n\n\nfunc _ready() -> void:\n\tvar roll: int = randi()\n",
	)
	var violations: Array[String] = _find_forbidden_calls(root, "")
	assert_eq(violations.size(), 1, "the scanner must flag a direct randi() call")
	if violations.size() == 1:
		assert_true(
			violations[0].contains("bad.gd:5"),
			"the violation must name the file and line, got %s" % violations[0],
		)


func _sample(generator: Rng) -> Array[float]:
	var values: Array[float] = []
	for _iteration: int in SAMPLE_COUNT:
		values.append(generator.randf())
		values.append(float(generator.randi_range(0, 1000)))
		values.append(generator.randf_range(-1.0, 1.0))
	return values


## Walks [param root] and returns "file:line: text" for every direct call to
## Godot's global randomness, skipping [param excluded_path].
func _find_forbidden_calls(root: String, excluded_path: String) -> Array[String]:
	var violations: Array[String] = []
	var pattern: RegEx = RegEx.new()
	pattern.compile(FORBIDDEN_CALL_PATTERN)
	_scan_directory(root, excluded_path, pattern, violations)
	violations.sort()
	return violations


func _scan_directory(
	root: String, excluded_path: String, pattern: RegEx, violations: Array[String]
) -> void:
	var dir: DirAccess = DirAccess.open(root)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var path: String = root.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				_scan_directory(path, excluded_path, pattern, violations)
		elif entry.ends_with(".gd") and path != excluded_path:
			_collect_violations(path, pattern, violations)
		entry = dir.get_next()
	dir.list_dir_end()


func _collect_violations(path: String, pattern: RegEx, violations: Array[String]) -> void:
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var lines: PackedStringArray = file.get_as_text().split("\n")
	file.close()
	for index: int in lines.size():
		if pattern.search(lines[index]) != null:
			violations.append("%s:%d: %s" % [path, index + 1, lines[index].strip_edges()])


func _make_temp_dir(label: String) -> String:
	var base: String = ProjectSettings.globalize_path("user://").path_join("determinism_probe")
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
