extends GutTest
## Guards the hint ladder, the feedback data, and the session queue.

const FEEDBACK_PATH: String = "res://data/session/feedback.json"

var _problem: Dictionary = {"operation": "addition", "a": 5, "b": 3, "answer": 8}


func test_the_real_feedback_file_orders_the_three_stages() -> void:
	var config: Dictionary = HintLadder.load_config(FEEDBACK_PATH)
	assert_eq(int(config.get("version", 0)), 1, "feedback.json declares version 1")
	var stages: Variant = config.get("stages", [])
	assert_eq(stages, ["visual_model", "decomposition", "answer"])


func test_every_operation_names_known_visual_models() -> void:
	var config: Dictionary = HintLadder.load_config(FEEDBACK_PATH)
	var models: Dictionary = config.get("visualModels", {})
	for operation: String in ["addition", "subtraction", "multiplication", "division"]:
		var preferred: Variant = models.get(operation, [])
		assert_true(preferred is Array and not (preferred as Array).is_empty(), operation)
		for model: Variant in preferred:
			assert_true(
				String(model) in VisualModels.MODEL_TYPES, "%s model %s" % [operation, model]
			)


func test_wrong_answers_walk_the_ladder_in_order() -> void:
	var ladder: HintLadder = HintLadder.new()
	assert_eq(ladder.rung(), 0, "a new ladder shows no hint")
	assert_eq(ladder.stage(), "")
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.VISUAL_MODEL)
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.DECOMPOSITION)
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.ANSWER)


func test_wrong_answers_never_reduce_progress() -> void:
	var ladder: HintLadder = HintLadder.new()
	for _attempt: int in 5:
		ladder.wrong(_problem)
	assert_eq(ladder.rung(), 3, "the ladder stops on the answer rung")
	assert_eq(String(ladder.rung_for(_problem).get("stage")), HintLadder.ANSWER)


func test_a_correct_answer_resets_the_ladder() -> void:
	var ladder: HintLadder = HintLadder.new()
	ladder.wrong(_problem)
	ladder.correct()
	assert_eq(ladder.rung(), 0)
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.VISUAL_MODEL)


func test_the_decomposition_rung_shows_worked_steps() -> void:
	var ladder: HintLadder = HintLadder.new()
	ladder.wrong(_problem)
	var hint: Dictionary = ladder.wrong(_problem)
	var steps: Variant = hint.get("steps", [])
	assert_true(steps is Array)
	assert_eq((steps as Array).size(), 2)
	assert_eq(String((steps as Array)[0]), "5 + 3")
	assert_eq(String((steps as Array)[1]), "5 + 3 = 8")


func test_the_answer_rung_carries_the_answer_and_a_replay() -> void:
	var ladder: HintLadder = HintLadder.new()
	ladder.wrong(_problem)
	ladder.wrong(_problem)
	var hint: Dictionary = ladder.wrong(_problem)
	assert_eq(int(hint.get("answer", 0)), 8)
	assert_true(bool(hint.get("replay", false)), "the answer rung replays the problem")
	assert_eq(hint.get("problem", {}), _problem)


func test_the_visual_model_is_deterministic_and_known() -> void:
	var ladder: HintLadder = HintLadder.new()
	for operation: String in ["addition", "subtraction", "multiplication", "division"]:
		var problem: Dictionary = {"operation": operation, "a": 6, "b": 2, "answer": 4}
		var model: String = ladder.model_for(problem)
		assert_true(model in VisualModels.MODEL_TYPES, operation)
		assert_eq(ladder.model_for(problem), model, "%s is deterministic" % operation)


func test_a_custom_config_defines_the_stages_and_models() -> void:
	var ladder: HintLadder = (
		HintLadder
		. new(
			{
				"stages": ["visual_model", "answer"],
				"visualModels": {"addition": ["ten_frame"]},
			}
		)
	)
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.VISUAL_MODEL)
	assert_eq(ladder.model_for(_problem), "ten_frame")
	assert_eq(String(ladder.wrong(_problem).get("stage")), HintLadder.ANSWER)


func test_a_wrong_answer_returns_later_in_the_session() -> void:
	var queue: SessionQueue = SessionQueue.new()
	var first: Dictionary = {"operation": "addition", "a": 1, "b": 1, "answer": 2}
	var second: Dictionary = {"operation": "addition", "a": 2, "b": 2, "answer": 4}
	queue.enqueue(first)
	queue.enqueue(second)
	queue.requeue(queue.dequeue())
	assert_eq(queue.size(), 2)
	assert_eq(queue.dequeue(), second, "the queue stays first in, first out")
	assert_eq(queue.dequeue(), first, "the missed problem comes back at the end")
	assert_true(queue.is_empty())


func test_the_queue_handles_an_empty_session() -> void:
	var queue: SessionQueue = SessionQueue.new()
	assert_true(queue.is_empty())
	assert_eq(queue.dequeue(), {})
	queue.enqueue(_problem)
	queue.clear()
	assert_eq(queue.size(), 0)
