class_name InputInjection
extends RefCounted
## Feeds recorded events into the shared [InputActions] during a replay.
##
## Debug only: every entry point returns before touching the game unless
## [method OS.is_debug_build] is true, so a release build cannot inject input.

var actions: InputActions = null
var player: PlayerMovement = null
var errors: Array[String] = []


func _init(input_actions: InputActions = null, target: PlayerMovement = null) -> void:
	actions = input_actions
	player = target


## Returns whether input injection is allowed in this build.
static func is_available() -> bool:
	return OS.is_debug_build()


## Applies one recorded event and returns whether it reached the game.
func inject(event: Dictionary) -> bool:
	if not is_available():
		return false
	var kind: String = String(event.get("kind", ""))
	match kind:
		"press":
			return press(String(event.get("action", "")), String(event.get("direction", "")))
		"release":
			return release(String(event.get("action", "")))
		"swipe":
			return swipe(String(event.get("direction", "")))
		"move":
			return set_move(Vector2(_number(event.get("x")), _number(event.get("y"))))
	errors.append("unknown input event kind '%s'" % kind)
	return false


## Presses [param action], resolving a direction swipe on the attack at once.
func press(action: String, direction: String = "") -> bool:
	if not is_available() or actions == null:
		return false
	return actions.press(action, direction)


## Releases [param action], resolving a short attack as a tap.
func release(action: String) -> bool:
	if not is_available() or actions == null:
		return false
	return actions.release(action)


## Resolves an already pressed attack as a swipe in [param direction].
func swipe(direction: String) -> bool:
	if not is_available() or actions == null:
		return false
	return actions.swipe(direction)


## Sets the injected move vector and drives a bound body with it.
func set_move(vector: Vector2) -> bool:
	if not is_available() or actions == null:
		return false
	actions.set_move(vector, "injection")
	if player != null:
		if vector.length() > InputActions.DEADZONE:
			player.drive(vector)
		else:
			player.release_drive()
	return true


static func _number(value: Variant) -> float:
	return float(value) if value is int or value is float else 0.0
