extends GutTest
## Instantiates the visual model scene headlessly for each of the four models.

const SCENE_PATH: String = "res://scenes/ui/visual_models/visual_models.tscn"


func test_the_scene_instantiates_with_a_model_container() -> void:
	var component: VisualModels = _component()
	assert_not_null(component)
	assert_not_null(component.get_node_or_null("ModelRoot"))


func test_every_model_type_builds_labelled_nodes() -> void:
	var component: VisualModels = _component()
	var problem: Dictionary = {"operation": "multiplication", "a": 3, "b": 2, "answer": 6}
	for model_type: String in VisualModels.MODEL_TYPES:
		var root: Node = component.build(problem, model_type)
		assert_not_null(root, model_type)
		assert_gt(root.get_child_count(), 1, "%s builds nodes" % model_type)
		var label: Node = root.get_node_or_null("ProblemLabel")
		assert_not_null(label, "%s has a problem label" % model_type)
		if label is Label:
			assert_eq((label as Label).text, "3 × 2", "%s label" % model_type)


func test_an_unknown_model_type_builds_nothing() -> void:
	var component: VisualModels = _component()
	var problem: Dictionary = {"operation": "addition", "a": 1, "b": 1, "answer": 2}
	assert_null(component.build(problem, "cube"))


func test_dot_array_shows_one_dot_per_total() -> void:
	var root: Node = _build("addition", 3, 2, 5, VisualModels.DOT_ARRAY)
	assert_eq(root.get_child_count(), 6, "one label plus five dots")
	assert_eq(_count(root, "Dot"), 5)


func test_ten_frame_fills_frames_of_ten() -> void:
	var root: Node = _build("addition", 8, 4, 12, VisualModels.TEN_FRAME)
	var frames: Array[Node] = _named(root, "Frame")
	assert_eq(frames.size(), 2)
	assert_eq(_count(frames[0], "Dot"), 10)
	assert_eq(_count(frames[1], "Dot"), 2)


func test_number_line_labels_each_tick() -> void:
	var root: Node = _build("addition", 3, 2, 5, VisualModels.NUMBER_LINE)
	var ticks: Array[Node] = _named(root, "Tick")
	assert_eq(ticks.size(), 6)
	assert_eq((ticks[0] as Label).text, "0")
	assert_eq((ticks[5] as Label).text, "5")


func test_equal_groups_show_groups_of_equal_size() -> void:
	var root: Node = _build("multiplication", 3, 2, 6, VisualModels.EQUAL_GROUPS)
	var groups: Array[Node] = _named(root, "Group")
	assert_eq(groups.size(), 2)
	assert_eq(_count(groups[0], "Dot"), 3)
	assert_eq(_count(groups[1], "Dot"), 3)
	assert_eq((groups[0].get_node("GroupLabel") as Label).text, "Group 1")


func _component() -> VisualModels:
	var scene: PackedScene = load(SCENE_PATH) as PackedScene
	assert_not_null(scene, "visual_models.tscn must load")
	if scene == null:
		return null
	var instance: VisualModels = scene.instantiate() as VisualModels
	add_child_autofree(instance)
	return instance


func _build(operation: String, a: int, b: int, answer: int, model_type: String) -> Node:
	var problem: Dictionary = {"operation": operation, "a": a, "b": b, "answer": answer}
	return _component().build(problem, model_type)


func _named(parent: Node, prefix: String) -> Array[Node]:
	var found: Array[Node] = []
	for child: Node in parent.get_children():
		if String(child.name).begins_with(prefix):
			found.append(child)
	return found


func _count(parent: Node, prefix: String) -> int:
	return _named(parent, prefix).size()
