class_name BossHealthBar
extends Node2D
## Greybox boss health bar with a background rect and a fill rect.
##
## [method set_health] resizes the fill to the hp ratio, and [method bind]
## follows a [BossStateMachine]. A bar under a boss binds itself on ready.

const DEFAULT_WIDTH: float = 160.0
const DEFAULT_HEIGHT: float = 12.0

var hp: int = 1
var max_hp: int = 1

var _background: ColorRect = null
var _fill: ColorRect = null


func _ready() -> void:
	_resolve_parts()
	if get_parent() is BossStateMachine:
		bind(get_parent() as BossStateMachine)
	_apply()


## Follows [param machine]'s health and defeat signals.
func bind(machine: BossStateMachine) -> void:
	if machine == null:
		return
	if not machine.health_changed.is_connected(set_health):
		machine.health_changed.connect(set_health)
	if not machine.defeated.is_connected(_on_defeated):
		machine.defeated.connect(_on_defeated)


## Shows [param value] out of [param maximum] hit points.
func set_health(value: int, maximum: int) -> void:
	max_hp = maxi(maximum, 1)
	hp = clampi(value, 0, max_hp)
	_apply()


## Returns the filled fraction of the bar in [code][0, 1][/code].
func health_ratio() -> float:
	return float(hp) / float(max_hp)


func _on_defeated() -> void:
	set_health(0, max_hp)


func _apply() -> void:
	if _background == null or _fill == null:
		return
	var size: Vector2 = Vector2(DEFAULT_WIDTH, DEFAULT_HEIGHT)
	var origin: Vector2 = Vector2(-size.x / 2.0, -size.y / 2.0)
	_background.position = origin
	_background.size = size
	_fill.position = origin
	_fill.size = Vector2(size.x * health_ratio(), size.y)
	_fill.visible = hp > 0


func _resolve_parts() -> void:
	_background = get_node_or_null("Background") as ColorRect
	_fill = get_node_or_null("Fill") as ColorRect
