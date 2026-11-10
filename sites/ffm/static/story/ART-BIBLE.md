# Story diorama art bible

Every diorama layer is checked against this list before it is accepted. The
approved character reference is
[references/hero-reference-sheet.png](references/hero-reference-sheet.png).

## Medium

- A hand-built **paper theatre**: hand-painted illustration printed on aged
  cardstock, cut out with scissors, visible fibres and grain.
- Every cutout layer has a **thin cream paper border** and slightly uneven cut
  edges. No hard digital outlines, no photographic textures, no 3D render look.
- Depth comes from **3-4 flat layers standing apart**, each casting a soft
  contact shadow (applied by the player, not painted into the PNG).
- Lighting is a **runtime overlay** (ambient tint, glows, motes, flashes), so
  layers stay reusable and are painted with neutral, even light.

## Palette

| Use | Colour |
| --- | --- |
| Night, cloak, act VI hall | midnight blue `#1d2f6b` |
| Tunic, distant scenery | slate blue `#4f6fa8` |
| Scarf, roofs, danger accents | crimson `#b3262d` |
| Clasp, crossguard, lantern light | brass gold `#c9a24a` |
| Sword, wards, runes, dragon | crystal blue glow `#7fd4ff` |
| Hair, harvest | golden blonde `#d9ac4f` |

Paper base: warm cream `#efe2c6`. Magic is always **blue**; warmth and safety
are **gold**; danger is crimson or sickly violet, never gore.

## The hero (must match the reference in every scene)

- About 14, friendly and determined; warm brown skin, amber-brown eyes.
- **Golden-blonde, slightly spiky tousled hair** with a short low ponytail. Not
  tall swept-back anime spikes.
- Long **crimson scarf**; **midnight-blue hooded cloak** with a tattered hem and
  a round **brass clasp engraved with a plus sign**.
- Slate-blue quilted tunic with brass buttons, brown belt and satchel,
  fingerless brown gloves, charcoal trousers, tall brown cuffed boots.
- **No shoulder pauldron, no oversized sword.**

## The sword

- Slender, straight, one-handed arming sword; translucent **crystal-blue blade**
  that glows softly.
- Four symbols engraved down the blade in this order: **+ − × ÷**.
- Simple brass crossguard, dark leather grip, round brass pommel.
- In the story the sword gains six marks (one per restored ward); show them as
  small brass dots on the crossguard when a scene needs them.

## Recurring cast

- **Blue ice dragon**: ancient ally; matches `static/game/dragon.png` (crystal
  spikes, pale blue-white belly), restyled as a paper cutout.
- **Fiends**: the existing fiend classes (`static/game/fiend-sprites/`),
  restyled as paper cutouts; slightly comical, never gory.
- **The Hollow King**: never shown as a body — a floating crown with shadow
  beneath it.

## Settings per act (match the in-game stage backgrounds)

| Act | Levels | Setting | Stage art |
| --- | --- | --- | --- |
| I | 1-10 | sunny village, rune fences, windmill | `stage-1.png` |
| II | 11-20 | golden fields at sunset, lanterns | `stage-2.png` |
| III | 21-30 | lantern-lit forest, rune-stones, blue flowers | `stage-3.png` |
| IV | 31-40 | green-roofed woodland hall, deer banners | `stage-4.png` |
| V | 41-50 | night town square, fountain, rune circles | `stage-5.png` |
| VI | 51-60 | blue-and-gold throne room | `stage-6.png` |

## Composition

- Stage is 1920×1080. Keep faces, the sword, and anything the subtitle refers
  to inside the **safe area x 240-1680, y 108-972**, which stays visible from
  4:3 tablets to 20:9 phones.
- Leave the lower ~20% calm: the parchment subtitle strip sits there. Foreground
  vegetation may rise into the lower third, but keep it low-contrast and
  free of faces or story-critical detail behind the strip.
- Backdrops overscan the stage by at least 5% so motion never exposes an edge.
- Motion is slow and theatrical: total drift ≤ 4% scale, background moves
  least, foreground most. No shaking.

## Reviewer rejects a layer when

- the hero's hair, scarf, cloak clasp, outfit or sword differ from the
  reference, or the sword is oversized;
- it contains text, letters, logos, watermarks, religious symbols (for example
  a cross on a roof), or extra characters;
- cutouts have a white halo, missing cream border, or cropped edges;
- the palette or lighting breaks the act's setting;
- it is frightening or violent beyond the in-game tone.
