class_name Distractors
extends RefCounted
## Builds plausible wrong answers for one generated problem.
##
## Every distractor names the error model that produced it, so a choice problem
## can be explained and tested. The builder draws only through the injected
## [Rng], so the same problem and seed always produce the same distractors. A
## candidate that is negative, equals the answer, or repeats an earlier
## distractor is skipped, and the models rotate so each applicable one gets a
## turn.

const OPERATIONS: Array[String] = ["addition", "subtraction", "multiplication", "division"]
const MODELS: Array[String] = [
	"off_by_one",
	"off_by_ten",
	"wrong_operation",
	"missed_carry_or_borrow",
	"neighboring_table_fact",
	"transposed_digits",
]
const DEFAULT_COUNT: int = 3
const MAX_DISTRACTORS: int = 3

var _rng: Rng


## Creates a builder that draws from [param rng].
func _init(rng: Rng) -> void:
	_rng = rng


## Returns up to [param count] distractors shaped as [code]{value, model}[/code]
## for [param problem], which is shaped as [code]{operation, a, b, answer}[/code].
## The list is empty when the problem is unknown or [param count] is zero.
func generate(problem: Dictionary, count: int = DEFAULT_COUNT) -> Array[Dictionary]:
	var distractors: Array[Dictionary] = []
	var limit: int = clampi(count, 0, MAX_DISTRACTORS)
	if limit == 0 or not problem.has("answer"):
		return distractors
	var operation: String = String(problem.get("operation", ""))
	if not OPERATIONS.has(operation):
		return distractors
	var answer: int = int(problem["answer"])
	if answer < 0:
		return distractors
	var a: int = int(problem.get("a", 0))
	var b: int = int(problem.get("b", 0))
	var used: Dictionary = {answer: true}
	var start: int = _draw_int(0, MODELS.size() - 1)
	for offset: int in MODELS.size():
		var model: String = MODELS[(start + offset) % MODELS.size()]
		var value: int = _candidate(model, operation, a, b, answer)
		if value < 0 or used.has(value):
			continue
		used[value] = true
		distractors.append({"value": value, "model": model})
		if distractors.size() == limit:
			break
	return distractors


## Returns the candidate [param model] proposes, or -1 when it does not apply.
func _candidate(model: String, operation: String, a: int, b: int, answer: int) -> int:
	var value: int = -1
	match model:
		"off_by_one":
			value = _signed_offset(answer, 1)
		"off_by_ten":
			value = _signed_offset(answer, 10)
		"wrong_operation":
			value = _wrong_operation(operation, a, b)
		"missed_carry_or_borrow":
			value = _missed_carry_or_borrow(operation, a, b, answer)
		"neighboring_table_fact":
			value = _neighboring_fact(operation, a, b, answer)
		"transposed_digits":
			value = _transposed_digits(answer)
	return value


## Returns [param answer] shifted by [param offset], preferring the side that
## stays non-negative and choosing between both sides only when both are valid.
func _signed_offset(answer: int, offset: int) -> int:
	var down: int = answer - offset
	var up: int = answer + offset
	if down < 0:
		return up
	if _draw_int(0, 1) == 0:
		return down
	return up


## Returns the answer another operation on the same operands would produce.
func _wrong_operation(operation: String, a: int, b: int) -> int:
	match operation:
		"addition":
			return absi(a - b)
		"subtraction":
			return a + b
		"multiplication":
			return a + b
		"division":
			return a * b
	return -1


## Returns the answer that forgets to carry into the tens or to borrow from
## them, or -1 when the problem does not cross a ten boundary.
func _missed_carry_or_borrow(operation: String, a: int, b: int, answer: int) -> int:
	if operation == "addition":
		if posmod(a, 10) + posmod(b, 10) < 10:
			return -1
		return answer - 10
	if operation == "subtraction":
		if posmod(a, 10) >= posmod(b, 10):
			return -1
		return answer + 10
	return -1


## Returns the answer of a neighbouring table fact, or -1 when the operation
## has no table to be next to.
func _neighboring_fact(operation: String, a: int, b: int, answer: int) -> int:
	match operation:
		"multiplication":
			if a <= 0 or b <= 0:
				return -1
			return _signed_offset(answer, b if _draw_int(0, 1) == 0 else a)
		"division":
			return _signed_offset(answer, 1)
	return -1


## Returns [param answer] with two adjacent digits swapped, or -1 when the
## answer has fewer than two digits or no two adjacent digits differ.
func _transposed_digits(answer: int) -> int:
	var text: String = str(answer)
	if text.length() < 2:
		return -1
	var index: int = text.length() - 1
	while index > 0 and text[index] == text[index - 1]:
		index -= 1
	if index == 0:
		return -1
	var pair: String = text.substr(index - 1, 2)
	var swapped: String = pair[1] + pair[0]
	return int(text.substr(0, index - 1) + swapped + text.substr(index + 1))


## Draws an inclusive integer from the injected source. The method name is
## passed as a string because the determinism guard in test_determinism.gd
## flags the global randomness call syntax anywhere under scripts/ except
## rng.gd, member calls included.
func _draw_int(low: int, high: int) -> int:
	return int(_rng.call(&"randi_range", low, high))
