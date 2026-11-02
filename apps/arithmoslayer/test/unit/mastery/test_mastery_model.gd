extends GutTest
## Guards the mastery model and data/mastery/intervals.json.

const INTERVALS_PATH: String = "res://data/mastery/intervals.json"


func test_the_real_intervals_file_declares_the_ladder() -> void:
	var config: Dictionary = MasteryModel.load_config(INTERVALS_PATH)
	assert_eq(int(config.get("version", 0)), 1, "intervals.json declares version 1")
	assert_eq(config.get("intervals", []), [0.0, 1.0, 3.0, 7.0, 14.0, 30.0])
	assert_eq(int(config.get("slowThresholdMs", 0)), 3000)
	assert_true(float(config.get("learningRate", 0.0)) > 0.0, "the learning rate is positive")


func test_the_model_is_plain_refcounted_logic() -> void:
	var model: MasteryModel = MasteryModel.new()
	assert_true(model is RefCounted, "the model is a plain RefCounted object")


func test_a_new_band_starts_at_zero() -> void:
	var model: MasteryModel = MasteryModel.new()
	assert_eq(model.accuracy_for("g1-within-10"), 0.0)
	assert_eq(model.fluency_for("g1-within-10"), 0.0)
	assert_eq(model.mastery_for("g1-within-10"), 0.0)
	assert_eq(model.rewards_for("g1-within-10"), 0)
	assert_false(model.due_for_review("g1-within-10"), "an unseen band is not due")


func test_fast_correct_answers_raise_accuracy_fluency_and_rewards() -> void:
	var model: MasteryModel = MasteryModel.new()
	for _attempt: int in 3:
		model.record("g1-within-10", true, 500)
	assert_true(model.accuracy_for("g1-within-10") > 0.0, "accuracy rises")
	assert_true(model.fluency_for("g1-within-10") > 0.0, "fluency rises")
	assert_eq(model.rewards_for("g1-within-10"), 3, "three correct answers earn three rewards")


func test_a_slow_correct_answer_lowers_only_fluency() -> void:
	var slow: MasteryModel = MasteryModel.new()
	var fast: MasteryModel = MasteryModel.new()
	for _attempt: int in 3:
		slow.record("g1-within-10", true, 5000)
		fast.record("g1-within-10", true, 500)
	assert_eq(slow.accuracy_for("g1-within-10"), fast.accuracy_for("g1-within-10"))
	assert_eq(slow.rewards_for("g1-within-10"), fast.rewards_for("g1-within-10"))
	assert_lt(slow.fluency_for("g1-within-10"), fast.fluency_for("g1-within-10"))
	assert_true(slow.fluency_for("g1-within-10") < 0.5, "slow answers push fluency down")


func test_a_wrong_answer_lowers_accuracy_but_not_rewards_or_fluency() -> void:
	var model: MasteryModel = MasteryModel.new()
	model.record("g1-within-10", true, 500)
	model.record("g1-within-10", true, 500)
	var fluency: float = model.fluency_for("g1-within-10")
	var rewards: int = model.rewards_for("g1-within-10")
	var accuracy: float = model.accuracy_for("g1-within-10")
	model.record("g1-within-10", false, 500)
	assert_lt(model.accuracy_for("g1-within-10"), accuracy, "a wrong answer lowers accuracy")
	assert_eq(model.rewards_for("g1-within-10"), rewards, "a wrong answer keeps rewards")
	assert_eq(model.fluency_for("g1-within-10"), fluency, "a wrong answer keeps fluency")


func test_review_intervals_apply_per_skill() -> void:
	var model: MasteryModel = MasteryModel.new()
	model.record("g1-within-10", true, 500)
	assert_eq(model.due_in_for("g1-within-10"), 1, "first correct schedules the second interval")
	model.record("g1-within-10", true, 500)
	assert_eq(model.due_in_for("g1-within-10"), 3, "second correct schedules the third interval")
	model.record("g1-within-10", false, 500)
	assert_eq(model.due_in_for("g1-within-10"), 0, "a wrong answer is due immediately")
	assert_true(model.due_for_review("g1-within-10"), "a wrong answer is due for review")
	assert_eq(model.due_in_for("g2-within-100-no-carry"), 0, "another band is untouched")
	assert_false(model.due_for_review("g2-within-100-no-carry"), "an untouched band is not due")


func test_updates_are_deterministic_per_band() -> void:
	var first: MasteryModel = MasteryModel.new()
	var second: MasteryModel = MasteryModel.new()
	var events: Array[Dictionary] = [
		{"band": "g1-within-10", "correct": true, "ms": 400},
		{"band": "g1-within-10", "correct": false, "ms": 900},
		{"band": "g2-within-100-no-carry", "correct": true, "ms": 4000},
	]
	for event: Dictionary in events:
		for model: MasteryModel in [first, second]:
			model.record(String(event["band"]), bool(event["correct"]), int(event["ms"]))
	for band_id: String in ["g1-within-10", "g2-within-100-no-carry"]:
		assert_eq(first.accuracy_for(band_id), second.accuracy_for(band_id), band_id)
		assert_eq(first.fluency_for(band_id), second.fluency_for(band_id), band_id)
		assert_eq(first.rewards_for(band_id), second.rewards_for(band_id), band_id)
		assert_eq(first.mastery_for(band_id), second.mastery_for(band_id), band_id)
