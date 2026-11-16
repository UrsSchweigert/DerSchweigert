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

## Adventurer

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0004..0006), then clip sheets and portrait at seed 303
(art-0007..0013). The result read as an existing game character (spiky blonde hair, single pauldron, red scarf,
dark outfit, oversized blade), so no adventurer art is committed (atlas, frames, portrait, contact sheet removed).
The manifest row is kept. Hair rule also missed (spikes, not at most three small rounded tufts): the softened
plate barely differed from today's idle-1 and carried the spikes over. The rows above record the generation calls.
