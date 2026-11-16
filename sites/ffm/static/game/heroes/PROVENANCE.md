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
| adventuress | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0014 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| adventuress | idle (identity try 2, rejected) | idle prompt + "Hair smooth and rounded, no spikes, tied back in a low ponytail; whole figure head to boots." | 202 | art-0015 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| monk | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0026 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| monk | idle (identity try 2, kept) | idle prompt + corrective sentence: profile facing right, plain wrapped orange robe, no shoulder armour, no buckle, bare bound fists | 202 | art-0027 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| monk | idle (identity try 3, rejected) | idle prompt + corrective sentence: same side view facing right, never from behind, white cloth hand bindings | 303 | art-0028 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| monk | walk | walk prompt, unchanged | 202 | art-0029 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | swing | swing prompt, unchanged | 202 | art-0030 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | hurt | hurt prompt, unchanged | 202 | art-0031 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | dead | dead prompt, unchanged | 202 | art-0032 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | victory | victory prompt, unchanged | 202 | art-0033 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | cast | cast prompt, unchanged | 202 | art-0034 | fal-ai/flux-pro/kontext | accepted idle sheet (try 2) | 2026-11-16 |
| monk | portrait | portrait prompt, unchanged | 202 | art-0035 | fal-ai/flux-pro/kontext | idle-1 portrait plate (hero_portrait.py --reference) | 2026-11-16 |
| rogue | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0051 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| rogue | idle (identity try 2, rejected) | idle prompt + corrective sentence: hair covered by a green hood, no spikes, no scarf, no shoulder armour, no sword, shortbow in the left hand | 202 | art-0052 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| rogue | idle (identity try 3, rejected) | idle prompt + corrective sentence: same side view facing right, green hood, leather tunic, no cape, no sword, wooden shortbow | 303 | art-0053 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |

## Adventurer

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0004..0006), then clip sheets and portrait at seed 303
(art-0007..0013). The result read as an existing game character (spiky blonde hair, single pauldron, red scarf,
dark outfit, oversized blade), so no adventurer art is committed (atlas, frames, portrait, contact sheet removed).
The manifest row is kept. Hair rule also missed (spikes, not at most three small rounded tufts): the softened
plate barely differed from today's idle-1 and carried the spikes over. The rows above record the generation calls.

## Adventuress

NEEDS RE-RENDER (not committed: likeness)

Attempts: 2 identity tries (seeds 101, 202; art-0014, art-0015). Both read as an existing game character (spiky
blonde hair, single pauldron, red scarf, dark outfit, oversized blade) and missed the hair rule; the softened
default plate carries the old spikes over (the adventurer was not delivered, so no regenerated idle-1 exists).
A third try from the same plate was not spent. No clip sheets or portrait were generated. No adventuress art is
committed; the manifest row is kept. Re-render once a delivered adventurer idle-1 can serve as the style reference.

## Monk

NEEDS RE-RENDER

Attempts: 3 identity tries (seeds 101, 202, 303; art-0026..0028) from the softened default plate (adventurer not
delivered); try 2 kept as least bad. Clip sheets and bust at seed 202 (art-0029..0035). The generator returned
944x1104 sheets, so they were padded to square with the backdrop colour before hero_poses.py --split; anchors are the
tool-detected ones (strike [48, -8], cast [[24, -82], [28, -42]]); contact-sheet.webp was re-encoded lossless WebP
(the tool writes PNG data, 491 KB).
Review gate: no likeness to an existing game character, no text, no frame or background, child-safe, no spiky hair
(shaved head), weapon (fist) reaches past idle in all swing frames, standing height equal at 163 px except the swing
clip, which is larger. Missed look rules: facing (cells 2 and 4 of most sheets are front or back views, not
facing right), hands not clearly bound, swing frames taller than idle, hurt/cast/victory poses barely differ from
idle. Re-render once a delivered adventurer idle-1 exists as style reference.

## Princess

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0039..0041) from the softened default plate (adventurer not
delivered). Every try read as an existing game character (spiky blonde hair, pauldron, belt and gloves carried over
from the plate; try 3 also kept the oversized blade and showed a back view) and missed the hair and facing rules. No
clip sheets or portrait were generated. No princess art is committed; the manifest row is kept. Re-render once a
delivered adventurer idle-1 can serve as the style reference.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| princess | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0039 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| princess | idle (identity try 2, rejected) | idle prompt + "Hair smooth and rounded in a low bun under the circlet, no spikes, no scarf, no shoulder armour, no cape." | 202 | art-0040 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| princess | idle (identity try 3, rejected) | idle prompt + "Long dark brown hair, smooth and rounded, no spikes, no scarf, no shoulder armour, a gold circlet, a slim rapier in the right hand." | 303 | art-0041 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |

## Princess-armed

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0045..0047), all with the unchanged idle prompt, from the softened
default plate (adventurer not delivered). Every try read as an existing game character (spiky blonde hair, red scarf,
pauldron, dark outfit, oversized blade carried over from the plate) and missed the hair rule; the staff and sword were
only partly present. No clip sheets or portrait were generated. No princess-armed art is committed; the manifest row
is kept. Re-render once a delivered adventurer idle-1 can serve as the style reference.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| princess-armed | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0045 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| princess-armed | idle (identity try 2, rejected) | idle prompt, unchanged | 202 | art-0046 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| princess-armed | idle (identity try 3, rejected) | idle prompt, unchanged | 303 | art-0047 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |

## Rogue

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0051..0053) from the softened default plate (adventurer not
delivered). Every try read as an existing game character (spiky blonde hair or dark hood over the same outfit, red
scarf, single pauldron, red cape, oversized blade) and ignored the shortbow; try 2 also turned one pose to the back.
Missed look rules: shortbow, forest-green leather, silhouette distinct from the old hero. No clip sheets or portrait
were generated. No rogue art is committed; the manifest row is kept. Re-render once a delivered adventurer idle-1
can serve as the style reference.

## Rogue-f

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0057..0059) from the softened default plate (adventurer not
delivered). Every try read as an existing game character (spiky blonde or brown hair, dark outfit, scarf or cape,
pauldron, oversized blade carried over from the plate) and ignored the shortbow; try 2 also turned one pose to the
back. Missed look rules: shortbow, hood and forest-green leather, silhouette distinct from the old hero. No clip
sheets or portrait were generated. No rogue-f art is committed; the manifest row is kept. Re-render once a delivered
adventurer idle-1 can serve as the style reference.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| rogue-f | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0057 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| rogue-f | idle (identity try 2, rejected) | idle prompt + "Hair long, smooth and rounded in a braid, no spikes, no scarf, no shoulder armour, no cape, a shortbow in the left hand in every pose." | 202 | art-0058 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| rogue-f | idle (identity try 3, rejected) | idle prompt + "Dark brown hair, smooth and rounded, no spikes, no scarf, no armour, no sword, a green hood and a curved shortbow held in the left hand." | 303 | art-0059 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |

## Soldier

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0063..0065) from the softened default plate (adventurer not
delivered). Every try carried over the old hero's look (spiky blonde or brown hair, red scarf, single pauldron, dark
outfit, oversized blade) and read as an existing game character; try 1 also had a cape, try 2 turned one pose to the
back and had no buckler, try 3 had a buckler but kept the spiky hair and scarf and a brass stripe instead of a nose
guard. Missed look rules: brass nose guard, round buckler on the left arm, arming sword, silhouette distinct from the
old hero. No clip sheets or portrait were generated. No soldier art is committed; the manifest row is kept. Re-render
once a delivered adventurer idle-1 can serve as the style reference.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| soldier | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0063 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| soldier | idle (identity try 2, rejected) | idle prompt + "No spiky hair, no scarf, no shoulder armour, no cape, a round buckler on the left arm and a sword in the right hand in every pose." | 202 | art-0064 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| soldier | idle (identity try 3, rejected) | idle prompt + "Short brown hair under a steel helmet with a brass nose guard, plain brown tunic, a round wooden buckler on the left arm, a short arming sword." | 303 | art-0065 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |

## Soldier (female)

NEEDS RE-RENDER (not committed: likeness)

Attempts: 3 identity tries (seeds 101, 202, 303; art-0069..0071) from the softened default plate (adventurer not
delivered). Tries 1 and 2 carried over the old hero's look (spiky blonde hair, shoulder pauldron, dark outfit,
oversized blade, red cape in some poses) and read as an existing game character; try 2 also turned one pose to the
back and had no buckler. Try 3 dropped the old look but came back as a bust crop with no buckler, no sword and a
brass pauldron instead of a nose guard. Missed look rules: round buckler on the left arm, arming sword, full-figure
poses, silhouette distinct from the old hero. No clip sheets or portrait were generated. No soldier-f art is
committed; the manifest row is kept. Re-render once a delivered adventurer idle-1 can serve as the style reference.

| hero | clip | prompt summary | seed | call id | model | reference | date |
|---|---|---|---|---|---|---|---|
| soldier-f | idle (identity try 1, rejected) | idle prompt, unchanged | 101 | art-0069 | fal-ai/flux-pro/kontext | softened style plate (hero_frames.py --style-reference, adventurer not delivered) | 2026-11-16 |
| soldier-f | idle (identity try 2, rejected) | idle prompt + "No spiky hair, no scarf, no shoulder armour, no cape, a round buckler on the left arm and a sword in the right hand in every pose." | 202 | art-0070 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
| soldier-f | idle (identity try 3, rejected) | idle prompt + "Long brown hair in a low braid under a steel helmet with a brass nose guard, plain brown tunic, a round wooden buckler on the left arm, a short arming sword." | 303 | art-0071 | fal-ai/flux-pro/kontext | softened style plate | 2026-11-16 |
