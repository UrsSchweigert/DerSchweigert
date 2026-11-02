class_name VisualModels
extends Control
## Renders one problem as any of the four visual models.
##
## The component reads only problem data ([code]{operation, a, b, answer}[/code])
## and rebuilds deterministic labelled nodes under [code]ModelRoot[/code], so
## headless tests can assert node counts and labels. Dot, frame, tick, and group
## counts are capped so a four-digit band still builds a bounded tree.

const DOT_ARRAY: String = "dot_array"
const TEN_FRAME: String = "ten_frame"
const NUMBER_LINE: String = "number_line"
const EQUAL_GROUPS: String = "equal_groups"
const MODEL_TYPES: Array[String] = [DOT_ARRAY, TEN_FRAME, NUMBER_LINE, EQUAL_GROUPS]
const MAX_DOTS: int = 100
const FRAME_SIZE: int = 10
const MAX_FRAMES: int = 10
const MAX_TICKS: int = 21
const MAX_LINE_VALUE: int = 100
const MAX_GROUPS: int = 10
const MAX_GROUP_SIZE: int = 10
const DOT_SIZE: float = 12.0


## Clears [code]ModelRoot[/code] and builds [param problem] as [param model_type].
## Returns the container, or null for an unknown model type.
func build(problem: Dictionary, model_type: String) -> Node:
	var container: Control = _container()
	for child: Node in container.get_children():
		child.free()
	match model_type:
		DOT_ARRAY:
			_build_dot_array(container, problem)
		TEN_FRAME:
			_build_ten_frame(container, problem)
		NUMBER_LINE:
			_build_number_line(container, problem)
		EQUAL_GROUPS:
			_build_equal_groups(container, problem)
		_:
			return null
	return container


## Returns the written form of [param problem], such as [code]5 + 3[/code].
func expression(problem: Dictionary) -> String:
	var a: int = int(problem.get("a", 0))
	var b: int = int(problem.get("b", 0))
	match String(problem.get("operation", "")):
		"addition":
			return "%d + %d" % [a, b]
		"subtraction":
			return "%d - %d" % [a, b]
		"multiplication":
			return "%d × %d" % [a, b]
		"division":
			return "%d ÷ %d" % [a, b]
	return ""


## Returns how many dots [param problem] represents before the cap.
func dot_total(problem: Dictionary) -> int:
	var a: int = int(problem.get("a", 0))
	var b: int = int(problem.get("b", 0))
	match String(problem.get("operation", "")):
		"addition":
			return a + b
		"subtraction":
			return a
		"multiplication":
			return a * b
		"division":
			return a
	return 0


## Returns the dot count for each equal group, in order.
func group_sizes(problem: Dictionary) -> Array[int]:
	var a: int = int(problem.get("a", 0))
	var b: int = int(problem.get("b", 0))
	var answer: int = int(problem.get("answer", 0))
	var sizes: Array[int] = []
	match String(problem.get("operation", "")):
		"multiplication":
			for _group: int in mini(b, MAX_GROUPS):
				sizes.append(mini(a, MAX_GROUP_SIZE))
		"division":
			for _group: int in mini(b, MAX_GROUPS):
				sizes.append(mini(answer, MAX_GROUP_SIZE))
		"addition":
			sizes = [mini(a, MAX_GROUP_SIZE), mini(b, MAX_GROUP_SIZE)]
		"subtraction":
			sizes = [mini(a, MAX_GROUP_SIZE), mini(b, MAX_GROUP_SIZE)]
	return sizes


func _container() -> Control:
	var existing: Node = get_node_or_null("ModelRoot")
	if existing is Control:
		return existing
	var container: Control = Control.new()
	container.name = "ModelRoot"
	add_child(container)
	return container


func _build_dot_array(container: Control, problem: Dictionary) -> void:
	_label(container, "ProblemLabel", expression(problem))
	for index: int in mini(dot_total(problem), MAX_DOTS):
		_dot(container, index)


func _build_ten_frame(container: Control, problem: Dictionary) -> void:
	_label(container, "ProblemLabel", expression(problem))
	var total: int = mini(dot_total(problem), MAX_FRAMES * FRAME_SIZE)
	for frame_index: int in (total + FRAME_SIZE - 1) / FRAME_SIZE:
		var frame: Control = Control.new()
		frame.name = "Frame%d" % frame_index
		container.add_child(frame)
		var filled: int = mini(total - frame_index * FRAME_SIZE, FRAME_SIZE)
		for slot: int in filled:
			_dot(frame, slot)


func _build_number_line(container: Control, problem: Dictionary) -> void:
	_label(container, "ProblemLabel", expression(problem))
	var span: int = mini(dot_total(problem), MAX_LINE_VALUE)
	var step: int = maxi(1, ceili(float(span) / float(MAX_TICKS - 1)))
	var value: int = 0
	var tick: int = 0
	while value <= span:
		_label(container, "Tick%d" % tick, str(value))
		tick += 1
		value += step


func _build_equal_groups(container: Control, problem: Dictionary) -> void:
	_label(container, "ProblemLabel", expression(problem))
	var sizes: Array[int] = group_sizes(problem)
	for group_index: int in sizes.size():
		var group: Control = Control.new()
		group.name = "Group%d" % group_index
		container.add_child(group)
		_label(group, "GroupLabel", "Group %d" % (group_index + 1))
		for dot_index: int in sizes[group_index]:
			_dot(group, dot_index)


func _label(parent: Node, node_name: String, text: String) -> Label:
	var label: Label = Label.new()
	label.name = node_name
	label.text = text
	parent.add_child(label)
	return label


func _dot(parent: Node, index: int) -> Control:
	var dot: Control = Control.new()
	dot.name = "Dot%d" % index
	dot.custom_minimum_size = Vector2(DOT_SIZE, DOT_SIZE)
	parent.add_child(dot)
	return dot
