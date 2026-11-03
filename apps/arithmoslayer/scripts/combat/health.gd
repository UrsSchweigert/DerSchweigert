class_name Health
extends Node
## Hearts-style health with post-hit invulnerability frames.
##
## Hearts are whole units. [method damage] costs hearts unless the hero is still
## invulnerable from the previous hit or is inside a bound [Dodge] roll's
## i-frames, [method heal] tops them back up, and [method restore] refills every
## heart after a respawn. Defeat is a signal, not
## a game-over state: [Respawn] reacts to it and keeps the run's earned items.

signal hearts_changed(hearts: int, max_hearts: int)
signal defeated

const DEFAULT_PATH: String = "res://data/combat/health.json"
const DEFAULT_MAX_HEARTS: int = 6
const DEFAULT_STARTING_HEARTS: int = 6
const DEFAULT_HIT_INVULNERABILITY: float = 0.8

var max_hearts: int = DEFAULT_MAX_HEARTS
var hearts: int = DEFAULT_STARTING_HEARTS
var hit_invulnerability: float = DEFAULT_HIT_INVULNERABILITY

## Optional dodge roll whose i-frames also protect the hero. Bind it so a roll
## blocks damage for its data-defined window.
var dodge: Dodge = null

var _invulnerable_left: float = 0.0
var _defeated_announced: bool = false


func _ready() -> void:
	apply_config(load_config(DEFAULT_PATH))


## Returns the shared combat document at [param path], or an empty dictionary.
static func load_config(path: String = DEFAULT_PATH) -> Dictionary:
	if path.is_empty() or not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		return parsed as Dictionary
	return {}


## Applies the health numbers and refills the starting hearts, keeping current
## values for missing or invalid fields.
func apply_config(config: Dictionary) -> void:
	var section: Variant = config.get("health", {})
	if not (section is Dictionary):
		return
	max_hearts = _positive_int(section.get("maxHearts"), max_hearts)
	hit_invulnerability = _non_negative_float(
		section.get("hitInvulnerabilitySeconds"), hit_invulnerability
	)
	var starting: int = _positive_int(section.get("startingHearts"), hearts)
	hearts = clampi(starting, 1, max_hearts)
	_invulnerable_left = 0.0
	_defeated_announced = false
	hearts_changed.emit(hearts, max_hearts)


## Binds [param target] so its roll i-frames protect the hearts.
func bind_dodge(target: Dodge) -> void:
	dodge = target


## Costs [param amount] hearts and starts the hit invulnerability. Returns true
## when the hit landed.
func damage(amount: int = 1) -> bool:
	if amount <= 0 or is_invulnerable() or is_defeated():
		return false
	hearts = maxi(hearts - amount, 0)
	_invulnerable_left = hit_invulnerability
	hearts_changed.emit(hearts, max_hearts)
	if hearts == 0 and not _defeated_announced:
		_defeated_announced = true
		defeated.emit()
	return true


## Restores up to [param amount] hearts and returns how many were restored.
func heal(amount: int = 1) -> int:
	if amount <= 0 or is_defeated():
		return 0
	var restored: int = mini(amount, max_hearts - hearts)
	if restored <= 0:
		return 0
	hearts += restored
	hearts_changed.emit(hearts, max_hearts)
	return restored


## Refills every heart and clears the hit invulnerability after a respawn.
func restore() -> void:
	hearts = max_hearts
	_invulnerable_left = 0.0
	_defeated_announced = false
	hearts_changed.emit(hearts, max_hearts)


## Starts a hit invulnerability window, used for respawn protection.
func grant_invulnerability(seconds: float) -> void:
	_invulnerable_left = maxf(_invulnerable_left, maxf(seconds, 0.0))


## Advances the hit invulnerability timer by [param delta] seconds.
func advance(delta: float) -> void:
	if delta > 0.0:
		_invulnerable_left = maxf(_invulnerable_left - delta, 0.0)


## Returns true during post-hit i-frames or an active dodge roll window.
func is_invulnerable() -> bool:
	return _invulnerable_left > 0.0 or (dodge != null and dodge.is_invulnerable())


func is_defeated() -> bool:
	return hearts <= 0


static func _positive_int(value: Variant, fallback: int) -> int:
	if value is int or value is float:
		var number: float = float(value)
		if number > 0.0 and is_finite(number):
			return maxi(int(number), 1)
	return fallback


static func _non_negative_float(value: Variant, fallback: float) -> float:
	if value is int or value is float:
		var number: float = float(value)
		if number >= 0.0 and is_finite(number):
			return number
	return fallback
