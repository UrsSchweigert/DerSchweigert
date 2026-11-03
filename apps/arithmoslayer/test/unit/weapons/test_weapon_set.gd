extends GutTest
## Guards the five-weapon launch set, its mastery unlocks, and its affinities.

const WEAPON_DIR: String = "res://data/weapons"
const SCHEMA_NAME: String = "schema.json"
const LAUNCH_IDS: Array[String] = [
	"difference_daggers",
	"equal_boomerang",
	"product_hammer",
	"quotient_spear",
	"sum_blade",
]
const MATCHING_OPERATIONS: Dictionary = {
	"sum": "addition",
	"product": "multiplication",
	"quotient": "division",
	"difference": "subtraction",
	"equal": "equality",
}
const MISMATCHED_OPERATIONS: Dictionary = {
	"sum": "division",
	"product": "subtraction",
	"quotient": "addition",
	"difference": "multiplication",
	"equal": "addition",
}


func test_the_launch_set_is_exactly_the_five_named_weapons() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	assert_eq(str(mastery.weapon_ids()), str(LAUNCH_IDS), "only the launch weapons may ship")
	for weapon_id: String in LAUNCH_IDS:
		var weapon: WeaponDefinition = mastery.definition(weapon_id)
		assert_not_null(weapon, "%s must load" % weapon_id)
		if weapon == null:
			continue
		assert_true(weapon.is_valid(), "%s: %s" % [weapon_id, [weapon.errors]])
		assert_eq(weapon.id, weapon_id)
		assert_true(WeaponDefinition.AFFINITIES.has(weapon.affinity), "%s affinity" % weapon_id)


func test_weapons_have_distinct_patterns_reach_speed_and_orb_interaction() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	var signatures: Dictionary = {}
	for weapon_id: String in LAUNCH_IDS:
		var weapon: WeaponDefinition = mastery.definition(weapon_id)
		assert_gte(weapon.steps.size(), 3, "%s needs at least three steps" % weapon_id)
		assert_true(
			weapon.is_finisher(weapon.steps[-1].id), "%s must end on a finisher" % weapon_id
		)
		var kinds: Array[String] = []
		var orbs: Array[String] = []
		var reach: float = 0.0
		var frames: int = 0
		for step: WeaponDefinition.Step in weapon.steps:
			kinds.append(step.input_kind)
			orbs.append(step.orb)
			reach += maxf(step.hitbox_size.x, step.hitbox_size.y)
			frames += step.total_frames()
		assert_gt(frames, 0, "%s must have frame data" % weapon_id)
		var signature: String = (
			"%s|%s|%d|%d"
			% [",".join(kinds), ",".join(orbs), int(reach / weapon.steps.size()), frames]
		)
		assert_false(
			signatures.has(signature),
			"%s must differ from %s" % [weapon_id, signatures.get(signature, "")]
		)
		signatures[signature] = weapon_id


func test_the_boomerang_has_a_distinct_returning_chain_mechanic() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	var boomerang: WeaponDefinition = mastery.definition("equal_boomerang")
	assert_eq(boomerang.steps[0].input_direction, "right", "the boomerang is thrown out")
	assert_eq(boomerang.steps[1].input_direction, "left", "and comes back")
	for step: WeaponDefinition.Step in boomerang.steps:
		assert_eq(step.orb, "chain", "%s keeps the chain orb" % step.id)


func test_every_weapon_declares_mastery_levels_that_unlock_more() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	for weapon_id: String in LAUNCH_IDS:
		var weapon: WeaponDefinition = mastery.definition(weapon_id)
		assert_gte(weapon.mastery_levels.size(), 3, "%s needs mastery levels" % weapon_id)
		assert_eq(weapon.mastery_levels[0].threshold, 0, "%s starts at zero uses" % weapon_id)
		assert_gte(weapon.mastery_levels[0].steps.size(), 3, "%s base steps" % weapon_id)
		var previous: int = -1
		var step_count: int = 0
		for index: int in weapon.mastery_levels.size():
			var level: WeaponDefinition.MasteryLevel = weapon.mastery_levels[index]
			assert_gt(level.threshold, previous, "%s thresholds must ascend" % weapon_id)
			previous = level.threshold
			for step_id: String in level.steps:
				assert_true(
					weapon.step_ids().has(step_id), "%s references %s" % [weapon_id, step_id]
				)
			assert_true(
				level.steps.has(weapon.steps[-1].id),
				"%s level %d must keep the finisher playable" % [weapon_id, index]
			)
			assert_gte(level.steps.size(), step_count, "%s never loses a step" % weapon_id)
			step_count = level.steps.size()
		var last: WeaponDefinition.MasteryLevel = weapon.mastery_levels[-1]
		assert_gte(
			last.steps.size(),
			weapon.mastery_levels[0].steps.size() + 1,
			"%s must unlock an extra combo step" % weapon_id
		)
		assert_false(last.finisher.is_empty(), "%s must unlock a finisher variant" % weapon_id)
		assert_false(last.trail.is_empty(), "%s must unlock a trail" % weapon_id)
		assert_eq(weapon.mastery_levels[0].finisher, "")
		assert_eq(weapon.mastery_levels[0].trail, "")


func test_using_a_weapon_fills_the_meter_and_unlocks_rewards() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	var weapon_id: String = "sum_blade"
	var weapon: WeaponDefinition = mastery.definition(weapon_id)
	var base_steps: Array[String] = mastery.unlocked_step_ids(weapon_id)
	assert_eq(mastery.level(weapon_id), 0, "a fresh weapon starts at level 0")
	assert_eq(mastery.meter(weapon_id), 0.0, "a fresh meter is empty")
	assert_eq(str(base_steps), str(weapon.mastery_levels[0].steps))
	var first_threshold: int = mastery.threshold(weapon_id, 1)
	mastery.register_use(weapon_id, first_threshold - 1)
	assert_eq(mastery.level(weapon_id), 0, "uses below the threshold stay at level 0")
	assert_almost_eq(
		mastery.meter(weapon_id), float(first_threshold - 1) / float(first_threshold), 0.001
	)
	mastery.register_use(weapon_id)
	assert_eq(mastery.uses_for(weapon_id), first_threshold)
	assert_eq(mastery.level(weapon_id), 1, "the threshold unlocks level 1")
	assert_gt(mastery.unlocked_step_ids(weapon_id).size(), base_steps.size(), "an extra step")
	assert_eq(mastery.trail(weapon_id), weapon.mastery_levels[1].trail, "the trail unlocks")
	assert_eq(mastery.finisher_variant(weapon_id), "", "the variant waits for the last level")
	var second_threshold: int = mastery.threshold(weapon_id, 2)
	mastery.register_use(weapon_id, second_threshold - first_threshold)
	assert_eq(mastery.level(weapon_id), 2)
	assert_eq(mastery.finisher_variant(weapon_id), weapon.mastery_levels[2].finisher)
	assert_eq(mastery.meter(weapon_id), 1.0, "the last level fills the meter")
	assert_eq(mastery.uses_for("equal_boomerang"), 0, "uses stay per weapon")
	assert_eq(mastery.register_use("missing"), 0, "an unknown weapon records nothing")


func test_an_affinity_match_grants_a_small_bonus_and_never_gates() -> void:
	var mastery: WeaponMastery = WeaponMastery.load_directory(WEAPON_DIR)
	for weapon_id: String in LAUNCH_IDS:
		var affinity: String = mastery.affinity_of(weapon_id)
		var matching: String = String(MATCHING_OPERATIONS[affinity])
		var mismatched: String = String(MISMATCHED_OPERATIONS[affinity])
		var bonus: int = mastery.shard_bonus(weapon_id, matching)
		assert_gt(bonus, 0, "%s must reward its affinity" % weapon_id)
		assert_lte(bonus, WeaponMastery.SHARD_BONUS, "%s bonus must stay small" % weapon_id)
		assert_eq(
			mastery.shard_bonus(weapon_id, mismatched), 0, "%s must not reward others" % weapon_id
		)
		assert_eq(mastery.shard_bonus(weapon_id, "unknown"), 0)
		var uses_before: int = mastery.uses_for(weapon_id)
		var level_before: int = mastery.level(weapon_id)
		mastery.shard_bonus(weapon_id, matching)
		assert_eq(mastery.uses_for(weapon_id), uses_before, "a bonus never changes uses")
		assert_eq(mastery.level(weapon_id), level_before, "a bonus never changes mastery")
	assert_eq(
		mastery.shard_bonus("equal_boomerang", "equality"),
		WeaponMastery.SHARD_BONUS,
		"equal matches equality problems"
	)
	assert_eq(mastery.shard_bonus("missing", "addition"), 0)


func test_loader_rejects_an_unknown_affinity_and_unsorted_mastery() -> void:
	var bad_affinity: Dictionary = _json(WEAPON_DIR.path_join("sum_blade.json"))
	bad_affinity["affinity"] = "exponent"
	var affinity_weapon: WeaponDefinition = WeaponDefinition.from_dictionary(bad_affinity)
	assert_false(affinity_weapon.is_valid(), "an unknown affinity must fail")
	assert_true(_has_error(affinity_weapon, "affinity 'exponent'"))
	var bad_mastery: Dictionary = _json(WEAPON_DIR.path_join("sum_blade.json"))
	(bad_mastery["mastery"]["levels"][1] as Dictionary)["threshold"] = 0
	var mastery_weapon: WeaponDefinition = WeaponDefinition.from_dictionary(bad_mastery)
	assert_false(mastery_weapon.is_valid(), "unsorted thresholds must fail")
	assert_true(_has_error(mastery_weapon, "thresholds must ascend"))


func _json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert_true(parsed is Dictionary, "%s must decode to an object" % path)
	return parsed as Dictionary if parsed is Dictionary else {}


func _has_error(weapon: WeaponDefinition, needle: String) -> bool:
	return weapon.errors.any(func(message: String) -> bool: return message.contains(needle))
