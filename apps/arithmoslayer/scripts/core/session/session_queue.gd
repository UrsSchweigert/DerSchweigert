class_name SessionQueue
extends RefCounted
## A first-in, first-out queue of session problems.
##
## Problems are plain dictionaries shaped like a generated problem. A missed
## problem is [method requeue]d to the end, so it returns later in the same
## session instead of repeating immediately.

var _items: Array[Dictionary] = []


## Adds [param problem] to the end of the queue.
func enqueue(problem: Dictionary) -> void:
	_items.append(problem)


## Removes and returns the oldest problem, or an empty dictionary when empty.
func dequeue() -> Dictionary:
	if _items.is_empty():
		return {}
	var problem: Dictionary = _items[0]
	_items.remove_at(0)
	return problem


## Appends a missed [param problem] so it comes back later in the session.
func requeue(problem: Dictionary) -> void:
	_items.append(problem)


## Returns how many problems are waiting.
func size() -> int:
	return _items.size()


## Returns whether no problem is waiting.
func is_empty() -> bool:
	return _items.is_empty()


## Removes every waiting problem.
func clear() -> void:
	_items.clear()
