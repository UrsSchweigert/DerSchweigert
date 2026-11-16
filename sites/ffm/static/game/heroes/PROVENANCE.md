# Hero art provenance

Model for every row: `fal-ai/flux-pro/kontext` (harness art service). Prompts come unchanged from
`hero_prompts.py --hero adventurer --sheet <sheet>` unless a corrective sentence is listed.
Raw sheets are not committed. Date: 2026-11-16.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| adventurer | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0004 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference) | 2026-11-16 |
| adventurer | idle (identity try 2, rejected) | idle prompt + "hair short and soft, no spikes, whole figure head to boots" | 202 | art-0005 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| adventurer | idle (identity try 3, kept) | idle prompt + "hair short, flat and rounded, no spikes; longsword in the right hand in every pose" | 303 | art-0006 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| adventurer | walk | walk prompt, unchanged | 303 | art-0007 | fal-ai/flux-pro/kontext | accepted idle sheet (try 3) | 2026-11-16 |
| adventurer | swing | swing prompt, unchanged | 303 | art-0008 | fal-ai/flux-pro/kontext | accepted idle sheet | 2026-11-16 |
| adventurer | hurt | hurt prompt, unchanged | 303 | art-0009 | fal-ai/flux-pro/kontext | accepted idle sheet | 2026-11-16 |
| adventurer | dead | dead prompt, unchanged | 303 | art-0010 | fal-ai/flux-pro/kontext | accepted idle sheet | 2026-11-16 |
| adventurer | victory | victory prompt, unchanged | 303 | art-0011 | fal-ai/flux-pro/kontext | accepted idle sheet | 2026-11-16 |
| adventurer | cast | cast prompt, unchanged | 303 | art-0012 | fal-ai/flux-pro/kontext | accepted idle sheet | 2026-11-16 |
| adventurer | portrait | portrait prompt, unchanged | 303 | art-0013 | fal-ai/flux-pro/kontext | idle-1 portrait plate (hero_portrait.py --reference) | 2026-11-16 |

## Adventurer review gate (self-check, for the owner's review of source/contact-sheet.webp)

Delivered as the closest try, per the human guidance; the owner judges it at the pause after P4.

- **Hair (rule missed):** all three tries kept spiky hair, far more than three small rounded tufts. The
  softened plate barely differs from today's idle-1 (hair area 940 -> 924 px), so the reference carried
  the spikes over and the corrective sentences did not remove them. This is the main miss.
- **Likeness (needs owner attention):** the figure (spiky blonde hair, one pauldron, red scarf, dark outfit,
  large blade) is derived from today's hero and may read as an existing game character. Not cleared.
- Equal standing height: idle/walk/hurt/cast/victory frames scale to 163 px (others 154-165).
- Weapon in every swing frame: visible in the contact sheet, but the sword check reports
  `idle-3: tip is cut off by the sprite edge` (FAIL) and "no blade visible" / "blade shorter than 40px"
  warnings in many non-swing frames, so `--strict` exits 1. The files were still written.
- Sheet framing: generated sheets came back 944x1104 (the plate's aspect, not square), so each cell was
  placed unscaled on a square magenta sheet before `hero_poses.py --split`. Figures touch the bottom of
  their cells, which cut the idle-3 sword tip.
- dead-3 / dead-4 carry small stray scraps above the figure; dead-1 has a loose scarf piece beside it.
- Silhouette distinct from adventuress: not measured; left to the owner.
- No text, frame or background seen. Child-safe: nothing beyond the sword and a fallen pose.
- Anchors used: strike [80, -139], cast [[39, -108], [54, -95]] (detected).
- Contact sheet (28 frames plus portrait): 192-colour quantised lossless WebP, 216 KB, to fit the 400 KB cap.
