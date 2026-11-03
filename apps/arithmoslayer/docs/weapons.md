# Weapons

Weapons are data only: `data/weapons/*.json` follows `data/weapons/schema.json`, and
`tools/validate_data.py` rejects unknown fields, unknown cancel targets, and a missing finisher.

A document holds `version` (`1`), `id`, `inputBufferFrames`, and ordered `steps`; each step
holds `input`, `frames`, `hitbox`, `cancel`, `orb`, `impulse`, `knockback`, `effects`,
`sounds`, and `finisher`, and the last step is the finisher. An optional `affinity` names the
weapon's arithmetic family, and an optional `mastery` block declares ascending levels.

## Launch set

| Weapon | Affinity | Role | Pattern | Reach | Orb |
| --- | --- | --- | --- | --- | --- |
| Sum Blade | `sum` | Balanced | Tap, tap, hold | Medium circles | Cone |
| Product Hammer | `product` | Heavy | Hold, charge, tap | Short, large rectangles | Single |
| Quotient Spear | `quotient` | Poke | Swipe, swipe, hold | Long lines | Line |
| Difference Daggers | `difference` | Rush | Fast taps | Short, small circles | Single |
| Equal Boomerang | `equal` | Returning | Throw right, return left, orbit | Medium circles | Chain |

Every weapon ships at least three base steps plus a mastery step and a finisher. The boomerang's
throw/return pair is its distinct mechanic: every step uses the chain orb.

## Mastery and affinity

`mastery.levels` is an ascending list of `{threshold, steps, finisher, trail}`. The first level
starts at `0` uses, lists at least three steps, and every level keeps the finisher playable;
later levels add combo steps and unlock a finisher variant and a trail.
`scripts/weapons/weapon_mastery.gd` counts uses per weapon, derives
the level and meter, and exposes `unlocked_step_ids()`, `finisher_variant()`, and `trail()`.

An affinity match grants `WeaponMastery.SHARD_BONUS` extra shards through
`shard_bonus(weapon_id, operation)`; a mismatch grants zero. The bonus is pure: it never changes
uses, mastery, or what the player can solve.

## Combo engine

`ComboEngine.tick()` advances one fixed frame: buffered input survives `inputBufferFrames`,
a hit confirmed during `active` advances the graph, a dropped hit restarts at the first
step, and a cancel window jumps to its declared target.
