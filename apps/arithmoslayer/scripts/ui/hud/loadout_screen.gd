class_name LoadoutScreen
extends Control
## Lists every owned weapon and equips it into one of the two quick-swap slots.
##
## Labels come from weapon ids, so the greybox screen needs no new translation
## keys, and the buttons call the same methods the tests drive.

signal weapon_equipped(slot_index: int, weapon_id: String)

const LOADOUT_PATH: String = "res://data/weapons/loadout.json"

var loadout: Loadout = null
var selected_slot: int = 0
var weapon_buttons: Dictionary = {}
var slot_buttons: Array[Button] = []

@onready var _title_label: Label = $TitleLabel
@onready var _weapon_list: VBoxContainer = $WeaponList
@onready var _slot_list: HBoxContainer = $SlotList
@onready var _status_label: Label = $StatusLabel


func _ready() -> void:
	if loadout == null:
		loadout = Loadout.load_file(LOADOUT_PATH)
	refresh()


## Binds the screen to [param model] and rebuilds its controls.
func bind(model: Loadout) -> void:
	loadout = model
	selected_slot = 0
	if is_inside_tree():
		refresh()


func select_slot(slot_index: int) -> bool:
	if loadout == null or slot_index < 0 or slot_index >= loadout.slot_count:
		return false
	selected_slot = slot_index
	_refresh_slots()
	return true


## Equips an owned weapon into [param slot_index], or the selected slot.
func equip_weapon(weapon_id: String, slot_index: int = -1) -> bool:
	if loadout == null:
		return false
	var target: int = selected_slot if slot_index < 0 else slot_index
	if not loadout.equip(weapon_id, target):
		_status_label.text = "Cannot equip %s" % weapon_id
		return false
	_status_label.text = "%s in slot %d" % [weapon_id.capitalize(), target + 1]
	weapon_equipped.emit(target, weapon_id)
	_refresh_weapons()
	_refresh_slots()
	return true


func refresh() -> void:
	if loadout == null:
		return
	_title_label.text = "Loadout"
	_refresh_weapons()
	_refresh_slots()
	_status_label.text = "Choose a slot, then a weapon."


func _refresh_weapons() -> void:
	_clear(_weapon_list)
	weapon_buttons.clear()
	for weapon_id: String in loadout.owned_weapon_ids():
		var button: Button = Button.new()
		button.text = weapon_id.capitalize()
		button.pressed.connect(equip_weapon.bind(weapon_id))
		_weapon_list.add_child(button)
		weapon_buttons[weapon_id] = button


func _refresh_slots() -> void:
	_clear(_slot_list)
	slot_buttons.clear()
	for index: int in loadout.slot_count:
		var equipped: String = loadout.slot(index)
		var label: String = equipped.capitalize() if not equipped.is_empty() else "empty"
		var button: Button = Button.new()
		button.text = "Slot %d: %s" % [index + 1, label]
		button.pressed.connect(select_slot.bind(index))
		_slot_list.add_child(button)
		slot_buttons.append(button)


func _clear(container: Node) -> void:
	for child: Node in container.get_children():
		container.remove_child(child)
		child.free()
