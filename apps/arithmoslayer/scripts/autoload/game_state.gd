extends Node
## Autoload that owns state shared between scenes.
##
## The skeleton only tracks the score; later phases extend this node with
## save data, settings, and progression.

var score: int = 0


func reset() -> void:
	score = 0


func add_points(points: int) -> void:
	score += points
