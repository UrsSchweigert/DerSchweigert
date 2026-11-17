# Hero art provenance

One hero, six colour schemes. The art is the original hero in `static/game/hero/` (built by
`sites/ffm/scripts/hero_frames.py` from `static/game/source-assets/`). It is shown as "Ari" (id `adventurer`).

Wood, Flint, Carl, Ori and Quirl are not separate art: `sites/ffm/scripts/hero_recolor.py` recolours the original atlas
region by region (hair, skin, tunic, scarf, cape, gloves, boots) using `sites/ffm/scripts/data/hero-regions.png`
(built by `hero_regions.py`) and the schemes in `sites/ffm/scripts/hero_schemes.json`. Edit a scheme and rerun the
script to change it; each scheme's `hero-atlas.webp`, `portrait.webp` and `hero-frames.js` are generated.

History: ten separate heroes (generated with an image model, later hue-tinted stand-ins) were tried and dropped
on 2026-11-17 in favour of colour schemes. The generation scripts and their prompt log were removed; see git history.
