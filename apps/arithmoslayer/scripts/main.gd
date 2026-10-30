extends Node2D
## Root scene of the Arithmo Slayer shell.
##
## Every user-visible string comes from the localization table; the scene only
## owns layout and wiring.

@onready var _title_label: Label = $Ui/Root/TitleLabel
@onready var _tagline_label: Label = $Ui/Root/TaglineLabel


func _ready() -> void:
	_title_label.text = Localization.tr_key(&"app.title")
	_tagline_label.text = Localization.tr_key(&"shell.tagline")


func get_scene_title() -> String:
	return Localization.tr_key(&"app.title")


func get_tagline() -> String:
	return Localization.tr_key(&"shell.tagline")
