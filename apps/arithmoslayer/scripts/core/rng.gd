class_name Rng
extends RefCounted
## Seedable random source and the only place that calls Godot's randomness.
##
## Gameplay systems take an [Rng] instead of calling [code]randf()[/code] or
## [code]randi()[/code] directly, so a run can be replayed from its seed. Two
## instances created with the same seed emit the same sequence, and an
## unseeded instance still starts from a fixed default seed.

var _generator: RandomNumberGenerator


## Creates a generator seeded with [param seed_value].
func _init(seed_value: int = 0) -> void:
	_generator = RandomNumberGenerator.new()
	set_seed(seed_value)


## Returns the seed the generator currently uses.
func get_seed() -> int:
	return _generator.seed


## Reseeds the generator and restarts its sequence.
func set_seed(seed_value: int) -> void:
	_generator.seed = seed_value


## Returns a pseudo-random float in [code][0.0, 1.0][/code].
func randf() -> float:
	return _generator.randf()


## Returns a pseudo-random float in [param from, param to].
func randf_range(from: float, to: float) -> float:
	return _generator.randf_range(from, to)


## Returns a pseudo-random 32-bit int.
func randi() -> int:
	return _generator.randi()


## Returns a pseudo-random int in [param from, param to], both inclusive.
func randi_range(from: int, to: int) -> int:
	return _generator.randi_range(from, to)
