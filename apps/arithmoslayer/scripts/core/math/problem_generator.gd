class_name ProblemGenerator
extends RefCounted
## Turns a curriculum band into one practice problem.
##
## The generator holds an injected [Rng] and never touches the scene tree, so a
## band and a seed always produce the same problem. Each band declares its
## operations and the operand pool for each one; this class applies the band's
## [code]maxResult[/code], [code]crossesTens[/code], non-negative subtraction,
## and exact-division rules while it draws. A band that cannot produce a
## problem yields an empty dictionary.

const OPERATIONS: Array[String] = ["addition", "subtraction", "multiplication", "division"]
const MAX_ATTEMPTS: int = 256
const ALL_RESIDUES: Vector2i = Vector2i(0, 9)

var _rng: Rng


## Creates a generator that draws from [param rng].
func _init(rng: Rng) -> void:
	_rng = rng


## Returns one problem for [param band] shaped as
## [code]{operation, a, b, answer}[/code], or an empty dictionary when the band
## declares no operation that fits its own rules.
func generate(band: Dictionary) -> Dictionary:
	var operations: Array[String] = _declared_operations(band)
	if operations.is_empty():
		return {}
	var max_result: int = int(band.get("maxResult", 0))
	if max_result < 1:
		return {}
	var declared: Dictionary = band["operations"]
	var operation: String = operations[_draw_int(0, operations.size() - 1)]
	var operands: Dictionary = declared[operation]
	var a_spec: Dictionary = operands["a"]
	var b_spec: Dictionary = operands["b"]
	var crosses: Variant = band.get("crossesTens", null)
	var problem: Dictionary = {}
	match operation:
		"addition":
			problem = _addition(a_spec, b_spec, max_result, crosses)
		"subtraction":
			problem = _subtraction(a_spec, b_spec, max_result, crosses)
		"multiplication":
			problem = _multiplication(a_spec, b_spec, max_result)
		"division":
			problem = _division(a_spec, b_spec, max_result)
	return problem


func _addition(
	a_spec: Dictionary, b_spec: Dictionary, max_result: int, crosses: Variant
) -> Dictionary:
	for _attempt: int in MAX_ATTEMPTS:
		var b: int = _draw(b_spec)
		var a: int = _draw_addend(a_spec, b, max_result, crosses, false)
		if a >= 0:
			return _problem("addition", a, b, a + b)
	for b: int in _candidates(b_spec):
		var a: int = _draw_addend(a_spec, b, max_result, crosses, true)
		if a >= 0:
			return _problem("addition", a, b, a + b)
	return {}


func _subtraction(
	a_spec: Dictionary, b_spec: Dictionary, max_result: int, crosses: Variant
) -> Dictionary:
	for _attempt: int in MAX_ATTEMPTS:
		var a: int = _draw(a_spec)
		var b: int = _draw_subtrahend(b_spec, a, max_result, crosses, false)
		if b >= 0:
			return _problem("subtraction", a, b, a - b)
	for a: int in _candidates(a_spec):
		var b: int = _draw_subtrahend(b_spec, a, max_result, crosses, true)
		if b >= 0:
			return _problem("subtraction", a, b, a - b)
	return {}


func _multiplication(a_spec: Dictionary, b_spec: Dictionary, max_result: int) -> Dictionary:
	for _attempt: int in MAX_ATTEMPTS:
		var a: int = _draw(a_spec)
		var b: int = _draw_factor(b_spec, a, max_result, false)
		if b >= 0:
			return _problem("multiplication", a, b, a * b)
	for a: int in _candidates(a_spec):
		var b: int = _draw_factor(b_spec, a, max_result, true)
		if b >= 0:
			return _problem("multiplication", a, b, a * b)
	return {}


func _division(a_spec: Dictionary, b_spec: Dictionary, max_result: int) -> Dictionary:
	for _attempt: int in MAX_ATTEMPTS:
		var divisor: int = _draw(b_spec)
		var quotient: int = _draw_quotient(a_spec, divisor, max_result, false)
		if quotient >= 1:
			return _problem("division", quotient * divisor, divisor, quotient)
	for divisor: int in _candidates(b_spec):
		var quotient: int = _draw_quotient(a_spec, divisor, max_result, true)
		if quotient >= 1:
			return _problem("division", quotient * divisor, divisor, quotient)
	return {}


func _draw_addend(
	a_spec: Dictionary, b: int, max_result: int, crosses: Variant, deterministic: bool
) -> int:
	var low: int = _spec_min(a_spec)
	var high: int = mini(_spec_max(a_spec), max_result - b)
	return _pick(a_spec, low, high, _addition_residues(b, crosses), deterministic)


func _draw_subtrahend(
	b_spec: Dictionary, a: int, max_result: int, crosses: Variant, deterministic: bool
) -> int:
	var low: int = maxi(_spec_min(b_spec), a - max_result)
	var high: int = mini(_spec_max(b_spec), a)
	return _pick(b_spec, low, high, _subtraction_residues(a, crosses), deterministic)


func _draw_factor(b_spec: Dictionary, a: int, max_result: int, deterministic: bool) -> int:
	if a <= 0:
		return -1
	var low: int = _spec_min(b_spec)
	var high: int = mini(_spec_max(b_spec), max_result / a)
	return _pick(b_spec, low, high, ALL_RESIDUES, deterministic)


func _draw_quotient(a_spec: Dictionary, divisor: int, max_result: int, deterministic: bool) -> int:
	if divisor <= 0:
		return -1
	if _has_values(a_spec):
		var quotients: Array[int] = []
		for dividend: int in _values(a_spec):
			if dividend % divisor != 0:
				continue
			var quotient: int = dividend / divisor
			if quotient >= 1 and quotient <= max_result:
				quotients.append(quotient)
		return _choose(quotients, deterministic)
	var low: int = maxi(1, _ceil_div(_spec_min(a_spec), divisor))
	var high: int = mini(_spec_max(a_spec) / divisor, max_result)
	if low > high:
		return -1
	if deterministic:
		return low
	return _draw_int(low, high)


## Returns a value from [param spec] inside [code][low, high][/code] whose ones
## digit is inside [param residues], or -1 when the interval holds none.
func _pick(spec: Dictionary, low: int, high: int, residues: Vector2i, deterministic: bool) -> int:
	if low > high or residues.x > residues.y:
		return -1
	if _has_values(spec):
		var matches: Array[int] = []
		for value: int in _values(spec):
			if value >= low and value <= high and _residue_matches(value, residues):
				matches.append(value)
		return _choose(matches, deterministic)
	return _pick_range(low, high, residues, deterministic)


func _pick_range(low: int, high: int, residues: Vector2i, deterministic: bool) -> int:
	var total: int = 0
	for residue: int in range(residues.x, residues.y + 1):
		total += _count_residue(low, high, residue)
	if total == 0:
		return -1
	var index: int = 0 if deterministic else _draw_int(0, total - 1)
	for residue: int in range(residues.x, residues.y + 1):
		var count: int = _count_residue(low, high, residue)
		if index < count:
			return _first_residue(low, residue) + index * 10
		index -= count
	return -1


func _count_residue(low: int, high: int, residue: int) -> int:
	var first: int = _first_residue(low, residue)
	if first > high:
		return 0
	return (high - first) / 10 + 1


func _first_residue(low: int, residue: int) -> int:
	return low + posmod(residue - posmod(low, 10), 10)


func _residue_matches(value: int, residues: Vector2i) -> bool:
	var residue: int = posmod(value, 10)
	return residue >= residues.x and residue <= residues.y


## The ones digits an addend may use so that a carry into the tens is present
## when [param crosses] is true and absent when it is false.
func _addition_residues(b: int, crosses: Variant) -> Vector2i:
	if not (crosses is bool):
		return ALL_RESIDUES
	if bool(crosses):
		return Vector2i(10 - posmod(b, 10), 9)
	return Vector2i(0, 9 - posmod(b, 10))


## The ones digits a subtrahend may use so that a borrow from the tens is
## present when [param crosses] is true and absent when it is false.
func _subtraction_residues(a: int, crosses: Variant) -> Vector2i:
	if not (crosses is bool):
		return ALL_RESIDUES
	var a_mod: int = posmod(a, 10)
	if bool(crosses):
		return Vector2i(a_mod + 1, 9)
	return Vector2i(0, a_mod)


## Draws an inclusive integer from the injected source. The method name is
## passed as a string because the determinism guard in test_determinism.gd
## flags the global randomness call syntax anywhere under scripts/ except
## rng.gd, member calls included.
func _draw_int(low: int, high: int) -> int:
	return int(_rng.call(&"randi_range", low, high))


func _draw(spec: Dictionary) -> int:
	if _has_values(spec):
		var values: Array[int] = _values(spec)
		return values[_draw_int(0, values.size() - 1)]
	return _draw_int(_spec_min(spec), _spec_max(spec))


func _choose(values: Array[int], deterministic: bool) -> int:
	if values.is_empty():
		return -1
	if deterministic:
		return values[0]
	return values[_draw_int(0, values.size() - 1)]


func _candidates(spec: Dictionary) -> Array[int]:
	if _has_values(spec):
		return _values(spec)
	var values: Array[int] = []
	for value: int in range(_spec_min(spec), _spec_max(spec) + 1):
		values.append(value)
	return values


func _has_values(spec: Dictionary) -> bool:
	var values: Variant = spec.get("values", null)
	return values is Array and not (values as Array).is_empty()


func _values(spec: Dictionary) -> Array[int]:
	var values: Array[int] = []
	for value: Variant in spec.get("values", []):
		values.append(int(value))
	return values


func _spec_min(spec: Dictionary) -> int:
	if _has_values(spec):
		var values: Array[int] = _values(spec)
		var lowest: int = values[0]
		for value: int in values:
			lowest = mini(lowest, value)
		return lowest
	return int(spec.get("min", 0))


func _spec_max(spec: Dictionary) -> int:
	if _has_values(spec):
		var values: Array[int] = _values(spec)
		var highest: int = values[0]
		for value: int in values:
			highest = maxi(highest, value)
		return highest
	return int(spec.get("max", 0))


func _declared_operations(band: Dictionary) -> Array[String]:
	var declared: Dictionary = band.get("operations", {})
	var operations: Array[String] = []
	for operation: String in OPERATIONS:
		if declared.has(operation):
			operations.append(operation)
	return operations


func _ceil_div(value: int, divisor: int) -> int:
	return (maxi(value, 0) + divisor - 1) / divisor


func _problem(operation: String, a: int, b: int, answer: int) -> Dictionary:
	return {"operation": operation, "a": a, "b": b, "answer": answer}
