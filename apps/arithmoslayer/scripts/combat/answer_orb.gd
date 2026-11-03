class_name AnswerOrb
extends Area2D
## A greybox answer orb: a number plus a distinct shape, never colour alone.
##
## The number label and the shape label repeat what the polygon shows, so the
## orb is readable by shape and by value. [method pop] is harmless: it hides the
## orb and disables its collision but leaves the fight running.

signal struck(orb: AnswerOrb)
signal popped(orb: AnswerOrb)

const SHAPES: Array[String] = ["circle", "triangle", "square", "diamond"]
const SHAPE_RADIUS: float = 12.0

@export var value: int = 0
@export var shape: String = "circle"
@export var is_correct: bool = false

var is_popped: bool = false


## Applies the orb's value, shape, and correctness and refreshes its parts.
func configure(orb_value: int, orb_shape: String, correct: bool) -> void:
	value = orb_value
	shape = orb_shape if SHAPES.has(orb_shape) else SHAPES[0]
	is_correct = correct
	is_popped = false
	visible = true
	monitoring = true
	monitorable = true
	var number_label: Label = get_node_or_null("NumberLabel") as Label
	if number_label != null:
		number_label.text = str(value)
	var shape_label: Label = get_node_or_null("ShapeLabel") as Label
	if shape_label != null:
		shape_label.text = shape
	var polygon: Polygon2D = get_node_or_null("Shape") as Polygon2D
	if polygon != null:
		polygon.polygon = shape_points(shape, SHAPE_RADIUS)


## Returns the number and shape name a learner can read off the orb.
func readable_text() -> String:
	return "%d %s" % [value, shape]


## Announces a strike; the spawner decides what the strike means.
func strike() -> void:
	if is_popped:
		return
	struck.emit(self)


## Pops the orb harmlessly, leaving the fight untouched.
func pop() -> void:
	if is_popped:
		return
	is_popped = true
	visible = false
	monitoring = false
	monitorable = false
	popped.emit(self)


## Returns the polygon that draws [param name] at [param radius].
static func shape_points(name: String, radius: float) -> PackedVector2Array:
	var sides: int = 3 if name == "triangle" else 4 if name in ["square", "diamond"] else 8
	var offset: float = 0.0 if name == "diamond" else PI / 2.0
	var points: PackedVector2Array = PackedVector2Array()
	for index: int in sides:
		var angle: float = offset + TAU * float(index) / float(sides)
		points.append(Vector2(cos(angle), sin(angle)) * radius)
	return points
