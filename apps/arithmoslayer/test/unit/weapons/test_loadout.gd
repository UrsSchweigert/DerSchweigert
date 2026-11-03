extends GutTest
## Guards the two quick-swap slots, the loadout screen, and unlock gating.

const LOADOUT_PATH: String = "res://data/weapons/loadout.json"
const LOADOUT_SCENE: String = "res://scenes/ui/loadout.tscn"
const ARENA_PATH: String = "res://scenes/combat/arena.tscn"
const STARTING: String = "sum_blade"
const QUEST_WEAPON: String = "equal_boomerang"


func test_the_loadout_declares_two_slots_and_every_shipped_weapon() -> void:
	var loadout: Loadout = Loadout.load_file(LOADOUT_PATH)
	assert_true(loadout.is_valid(), "loadout.json must be valid: %s" % [loadout.errors])
	assert_eq(loadout.slot_count, Loadout.SLOT_COUNT, "there are exactly two quick-swap slots")
	assert_eq(
		str(loadout.sources), str(Loadout.SOURCES), "only exploration, quest, and boss unlock"
	)
	assert_gt(loadout.swap_cooldown_frames, 0, "the swap needs a cooldown")
	assert_lte(
		loadout.swap_cooldown_frames,
		Loadout.MAX_COOLDOWN_FRAMES,
		"the swap cooldown must stay short"
	)
	var mastery: WeaponMastery = WeaponMastery.load_directory()
	for weapon_id: String in mastery.weapon_ids():
		assert_true(loadout.is_known(weapon_id), "%s must be manageable" % weapon_id)
	assert_true(loadout.is_owned(STARTING), "the starting weapon is owned")


func test_weapons_unlock_only_through_exploration_quests_and_bosses() -> void:
	var loadout: Loadout = Loadout.load_file(LOADOUT_PATH)
	assert_false(loadout.is_owned(QUEST_WEAPON), "a quest weapon starts locked")
	var route: String = loadout.source_of(QUEST_WEAPON)
	assert_eq(route, "quest", "the boomerang is a quest reward")
	assert_false(loadout.unlock(QUEST_WEAPON, "shop"), "there is no shop")
	assert_false(loadout.is_owned(QUEST_WEAPON), "a rejected route grants nothing")
	assert_false(loadout.unlock(QUEST_WEAPON, "boss"), "another route is rejected")
	assert_true(loadout.unlock(QUEST_WEAPON, route), "the declared route unlocks")
	assert_true(loadout.is_owned(QUEST_WEAPON), "the declared route grants ownership")
	assert_false(loadout.unlock("phantom", "boss"), "unknown weapons never unlock")
	for weapon_id: String in loadout.weapon_ids():
		assert_true(
			Loadout.SOURCES.has(loadout.source_of(weapon_id)),
			"%s must use an allowed unlock source" % weapon_id
		)


func test_the_loadout_screen_lists_all_owned_weapons_and_equips_them() -> void:
	var loadout: Loadout = Loadout.load_file(LOADOUT_PATH)
	assert_true(loadout.unlock(QUEST_WEAPON, loadout.source_of(QUEST_WEAPON)))
	var screen: LoadoutScreen = _screen(loadout)
	assert_eq(
		screen.weapon_buttons.size(),
		loadout.owned_weapon_ids().size(),
		"the screen lists every owned weapon"
	)
	assert_true(screen.weapon_buttons.has(STARTING), "the starting weapon is listed")
	assert_true(screen.weapon_buttons.has(QUEST_WEAPON), "the unlocked weapon is listed")
	assert_false(screen.weapon_buttons.has("product_hammer"), "unowned weapons stay hidden")
	assert_eq(screen.slot_buttons.size(), 2, "both quick-swap slots are shown")
	assert_true(screen.select_slot(1), "the standby slot is selectable")
	assert_true(screen.equip_weapon(QUEST_WEAPON), "an owned weapon equips")
	assert_eq(loadout.slot(1), QUEST_WEAPON, "the selected slot holds the weapon")
	assert_false(screen.equip_weapon("product_hammer"), "an unowned weapon is refused")


func test_two_quick_swap_slots_share_a_short_cooldown() -> void:
	var loadout: Loadout = _two_weapon_loadout()
	assert_eq(loadout.active_weapon_id(), STARTING, "the first slot starts active")
	assert_true(loadout.try_swap(), "the first swap is allowed")
	assert_eq(loadout.active_weapon_id(), QUEST_WEAPON, "the standby slot becomes active")
	assert_eq(
		loadout.cooldown_frames_left(), loadout.swap_cooldown_frames, "the swap starts the cooldown"
	)
	assert_false(loadout.try_swap(), "the cooldown blocks a second swap")
	assert_eq(loadout.active_weapon_id(), QUEST_WEAPON, "a blocked swap changes nothing")
	_clear_cooldown(loadout)
	assert_true(loadout.try_swap(), "the cooldown expires")
	assert_eq(loadout.active_weapon_id(), STARTING, "the slots toggle back")
	_clear_cooldown(loadout)
	assert_eq(loadout.cooldown_frames_left(), 0, "fixed frames advance the cooldown")


func test_quick_swap_works_from_touch_gamepad_and_keyboard() -> void:
	var arena: Arena = (load(ARENA_PATH) as PackedScene).instantiate() as Arena
	add_child_autofree(arena)
	arena.loadout = _two_weapon_loadout()
	assert_eq(arena.loadout.active_weapon_id(), STARTING)
	assert_true(arena.actions.press("swap"), "the shared abstraction accepts swap")
	assert_eq(arena.loadout.active_weapon_id(), QUEST_WEAPON, "the arena swaps on the action")
	arena.actions.release("swap")
	_clear_cooldown(arena.loadout)
	arena.gamepad_keyboard.poll_state({"k": true}, {}, Vector2.ZERO)
	assert_eq(arena.loadout.active_weapon_id(), STARTING, "the keyboard swaps")
	arena.gamepad_keyboard.poll_state({}, {}, Vector2.ZERO)
	_clear_cooldown(arena.loadout)
	arena.gamepad_keyboard.poll_state({}, {"y": true}, Vector2.ZERO)
	assert_eq(arena.loadout.active_weapon_id(), QUEST_WEAPON, "the gamepad swaps")
	arena.gamepad_keyboard.poll_state({}, {}, Vector2.ZERO)
	_clear_cooldown(arena.loadout)
	arena.touch_controls.set_anchors_preset(Control.PRESET_TOP_LEFT)
	arena.touch_controls.size = Vector2(1152.0, 648.0)
	var point: Vector2 = arena.touch_controls.button_center("swap")
	_touch_event(arena.touch_controls, point, true)
	_touch_event(arena.touch_controls, point, false)
	assert_eq(arena.loadout.active_weapon_id(), STARTING, "touch swaps")


func test_a_level_cannot_start_with_an_unowned_weapon() -> void:
	var loadout: Loadout = Loadout.load_file(LOADOUT_PATH)
	assert_true(loadout.start_level(), "the starting loadout is legal")
	loadout.apply_profile(_profile([STARTING], [STARTING, "product_hammer"]))
	assert_false(loadout.start_level(), "an unowned weapon blocks the level")
	assert_true(
		loadout.level_errors.any(func(message: String) -> bool: return message.contains("unowned")),
		"the reason names the unowned weapon: %s" % [loadout.level_errors]
	)
	assert_false(loadout.start_level(), "the check is repeatable")
	loadout.apply_profile(_profile([STARTING], [STARTING, "phantom"]))
	assert_false(loadout.start_level(), "an unknown weapon also blocks the level")
	assert_true(
		loadout.level_errors.any(func(message: String) -> bool: return message.contains("unknown")),
		"the reason names the unknown weapon: %s" % [loadout.level_errors]
	)


func test_a_saved_profile_round_trips_owned_weapons_and_slots() -> void:
	var loadout: Loadout = _two_weapon_loadout()
	var saved: Dictionary = loadout.write_profile()
	var restored: Loadout = Loadout.load_file(LOADOUT_PATH)
	restored.apply_profile(saved)
	assert_eq(
		str(restored.owned_weapon_ids()), str(loadout.owned_weapon_ids()), "ownership round-trips"
	)
	assert_eq(restored.slot(0), loadout.slot(0), "the active slot round-trips")
	assert_eq(restored.slot(1), loadout.slot(1), "the standby slot round-trips")
	assert_eq(
		restored.active_weapon_id(), loadout.active_weapon_id(), "the active slot round-trips"
	)
	assert_true(restored.start_level(), "the restored loadout can start a level")


func _profile(owned: Array, slots: Array) -> Dictionary:
	return {Loadout.PROFILE_OWNED_KEY: owned, Loadout.PROFILE_SLOTS_KEY: slots}


func _two_weapon_loadout() -> Loadout:
	var loadout: Loadout = Loadout.load_file(LOADOUT_PATH)
	assert_true(loadout.unlock(QUEST_WEAPON, loadout.source_of(QUEST_WEAPON)))
	assert_true(loadout.equip(STARTING, 0), "the starting weapon equips")
	assert_true(loadout.equip(QUEST_WEAPON, 1), "the unlocked weapon equips")
	return loadout


func _screen(model: Loadout) -> LoadoutScreen:
	var screen: LoadoutScreen = (load(LOADOUT_SCENE) as PackedScene).instantiate() as LoadoutScreen
	add_child_autofree(screen)
	screen.bind(model)
	return screen


func _clear_cooldown(loadout: Loadout) -> void:
	for _frame: int in loadout.swap_cooldown_frames:
		loadout.tick()
	assert_eq(loadout.cooldown_frames_left(), 0, "the cooldown must clear")


func _touch_event(touch: TouchControls, point: Vector2, pressed: bool) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = 0
	event.position = point
	event.pressed = pressed
	touch.handle_event(event)
