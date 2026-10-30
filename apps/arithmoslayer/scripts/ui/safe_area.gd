class_name SafeAreaRoot
extends Control
## Keeps the root UI clear of notches, rounded corners, and system bars.
##
## Godot reports the usable screen rectangle; this control turns it into
## margins so every child stays inside the safe area on every device.


func _ready() -> void:
	_refresh()
	get_viewport().size_changed.connect(_refresh)


## Reapplies the display safe area after a window, device, or rotation change.
func _refresh() -> void:
	apply_safe_area(DisplayServer.get_display_safe_area(), get_window().size)


## Applies `safe_rect` (screen coordinates) as margins to this control.
func apply_safe_area(safe_rect: Rect2i, viewport_size: Vector2i) -> void:
	var insets: Vector4i = safe_area_insets(safe_rect, viewport_size)
	offset_left = float(insets.x)
	offset_top = float(insets.y)
	offset_right = -float(insets.z)
	offset_bottom = -float(insets.w)


## Returns the left, top, right, and bottom margins for `safe_rect`.
func safe_area_insets(safe_rect: Rect2i, viewport_size: Vector2i) -> Vector4i:
	if viewport_size.x <= 0 or viewport_size.y <= 0:
		return Vector4i.ZERO
	if safe_rect.size.x <= 0 or safe_rect.size.y <= 0:
		return Vector4i.ZERO
	var left: int = clampi(safe_rect.position.x, 0, viewport_size.x)
	var top: int = clampi(safe_rect.position.y, 0, viewport_size.y)
	var right_edge: int = clampi(safe_rect.end.x, 0, viewport_size.x)
	var bottom_edge: int = clampi(safe_rect.end.y, 0, viewport_size.y)
	return Vector4i(left, top, viewport_size.x - right_edge, viewport_size.y - bottom_edge)
