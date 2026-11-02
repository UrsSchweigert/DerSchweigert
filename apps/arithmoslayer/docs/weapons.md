# Weapons

Weapons are data only: `data/weapons/*.json` follows `data/weapons/schema.json`, and
`tools/validate_data.py` rejects unknown fields, unknown cancel targets, and a missing finisher.

A document holds `version` (`1`), `id`, `inputBufferFrames`, and ordered `steps`; each step
holds `input`, `frames`, `hitbox`, `cancel`, `orb`, `impulse`, `knockback`, `effects`,
`sounds`, and `finisher`, and the last step is the finisher.

`ComboEngine.tick()` advances one fixed frame: buffered input survives `inputBufferFrames`,
a hit confirmed during `active` advances the graph, a dropped hit restarts at the first
step, and a cancel window jumps to its declared target.
