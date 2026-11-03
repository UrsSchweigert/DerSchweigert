class_name Finisher
extends RefCounted
## Charges the finisher from correct answers and fires when the chain fills it.
##
## The threshold lives in chain.json beside the tiers, so the chain and the
## finisher always agree on how much charge a run needs.

const DEFAULT_PATH: String = "res://data/combat/chain.json"

var threshold: float = 3.0
var charge: float = 0.0


func _init(path: String = DEFAULT_PATH) -> void:
	threshold = _positive_float(Chain.load_config(path).get("finisherThreshold"), threshold)


## Adds [param amount] charge, clamped to the threshold, and returns the total.
func add(amount: float) -> float:
	if amount > 0.0:
		charge = clampf(charge + amount, 0.0, threshold)
	return charge


func is_ready() -> bool:
	return threshold > 0.0 and charge >= threshold


func progress() -> float:
	return clampf(charge / threshold, 0.0, 1.0) if threshold > 0.0 else 0.0


## Spends the charge and returns whether the finisher fired.
func trigger() -> bool:
	if not is_ready():
		return false
	charge = 0.0
	return true


static func _positive_float(value: Variant, fallback: float) -> float:
	if not (value is int or value is float):
		return fallback
	var number: float = float(value)
	return number if number > 0.0 and is_finite(number) else fallback
