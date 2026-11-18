# Project brief: ten playable heroes for the pixel-art maths game "Arithmo Slayer"

Prepared for an illustrator / pixel artist. Date: 2026-11-17. Contact and fee: to be filled in by the commissioner.

## 1. The project in two minutes

Arithmo Slayer is a children's maths game (web, Android, iOS). A hero fights monsters; each correct answer is a hit.
We are adding **ten playable heroes**. Each hero is a full character: a **256 x 256 portrait** and an **animated
in-game figure** with its own weapon. All ten must look like one family, in one pixel-art style, and be
**child-safe**.

We tried to produce the art with image-generation models. They gave us good detail, but they could not deliver
consistent walk cycles, clean side-profile poses, distinct silhouettes, or a character that does not resemble an
existing game hero. That is the work we need a human artist for.

## 2. What we need from you

For **each of the ten heroes**:

1. **Seven animation clips of four frames each (28 frames)**, all facing right, same character in every frame.
2. **One portrait**: head-and-shoulders, facing right, 256 x 256.
3. Source files (layered or per-frame, with transparent background) so we can re-export.

Delivery as transparent PNG frames plus your source files. We run our own build script that packs the frames into
the final game atlas, so **you do not need to build the atlas**, but frames must follow the rules below so the script
accepts them.

### Priority order

1. **Adventurer** first. It is the default (free) hero and the style reference for the other nine. Please deliver it
   (idle pose and the full clip set) and wait for approval before the rest.
2. Then: adventuress, princess, princess-armed, rogue, rogue-f, soldier, soldier-f, monk, priestess.

If budget is limited, tell us which subset you can do; the adventurer plus any few heroes is useful on its own.

## 3. The seven clips (four frames each)

All clips play at the same speed for every hero, so frame order and meaning matter more than flourish.

| Clip | Frame 1 | Frame 2 | Frame 3 | Frame 4 |
|---|---|---|---|---|
| **idle** | neutral stance | inhale, chest slightly raised | full breath, shoulders high | exhale, settling back |
| **walk** | contact, front foot forward | pass, legs together | contact, **other** foot forward | pass, legs together on the other side |
| **swing** (strike) | windup, weapon drawn back | strike, weapon sweeping forward | impact, weapon fully extended | follow-through, weapon carried past the target |
| **hurt** | recoil, head and shoulders thrown back | recoil at its deepest | starting to recover | nearly upright |
| **dead** | buckle, knees giving way | fall, body toppling backwards | on the ground, lying flat | still, motionless on the ground |
| **victory** | raise, one arm lifted | cheer, arm high, chest out | plant, arm lowered, feet set | hold, proud upright stance |
| **cast** | gather, the free casting hand drawn to the chest | thrust, the free hand thrust forward, palm open | hold, hand held out steady | recover, hand drawn back |

Bow heroes (rogue, rogue-f): the swing clip is *loose, bow held forward at full draw / bow held forward, string just
released / follow-through, bow arm extended / recover, bow lowered*. **Paint no arrow in flight**; the game draws it.

Fists heroes (monk, priestess): the strike is a palm strike or kick with bound fists.

### Known failure from the generated attempts: the walk

Every generated walk had **the same leg forward in all four frames** and no true passing pose. Please make a real
alternating cycle: left foot forward, legs together, **right** foot forward, legs together. Carry the weapon at the
hip so both legs stay visible.

## 4. Technical rules (the build script enforces these)

- **Facing:** right, in every frame, side view / profile (a slight three-quarter turn for the head is fine).
- **Standing height:** equal across all clips of a hero. Our target is **163 px** from sole to top of head in the
  final atlas; please draw at the same scale for every frame, or at an exact whole-number multiple of it. Swing
  frames may extend with the weapon, but the body height stays the same.
- **Foot pivot:** the feet sit on the same baseline in every standing frame so the figure does not bob or slide.
- **Weapon:** visible in **every swing frame**. Hurt, cast and victory must read as clearly different from idle.
- **Hands:** as the hero's brief says (e.g. bound fists for monk and priestess, a buckler arm for soldiers).
- **Background:** transparent. No text, no frame, no ground shadow.
- **Style:** pixel art, dark outline, limited palette, flat shading with a few tones of shading per material.
  Detail level at least as rich as the reference images (see section 7): visible armour plates, rivets, stitching,
  cloth folds, a readable face.
- **Silhouette:** at **56 px** high and at playfield size, every hero's outline must differ from every other
  hero's (hair, hood, helmet, weapon, cape or gown), not only the colours.
- **Portrait:** 256 x 256, head-and-shoulders bust, facing right, transparent or flat backdrop.
- **File budget (we handle this, but it shapes detail):** the final atlas per hero is one lossless WebP of at most
  about 700 KB, so avoid noisy dithering and photo-like gradients.

## 5. The ten heroes

Look rules in bold are hard rules from the owner.

| id | Name (EN / DE) | Figure | Strike weapon |
|---|---|---|---|
| `adventurer` | Adventurer / Abenteurer | Young adventurer. **Short, soft golden-blonde hair with at most three small rounded tufts (no spikes, no starburst outline).** Crimson scarf, **blue plate cuirass with two pauldrons (one on each shoulder)**, longsword. | Longsword |
| `adventuress` | Adventuress / Abenteurerin | Female counterpart: same scarf, blue plate and longsword, **longer hair tied back**. | Longsword |
| `princess` | Princess / Prinzessin | Courtly princess, midnight-blue and gold gown, gold circlet. | Light rapier |
| `princess-armed` | Warrior Princess / Kriegerprinzessin | The princess in travel armour with a gold circlet, **sword in one hand, staff in the other**; casts with the staff. | Sword |
| `rogue` | Rogue / Waldläufer | Male rogue, **hood half down**, leather and forest-green clothes. | Shortbow |
| `rogue-f` | Rogue / Waldläuferin | Female rogue, hood half down, **distinct hair and face**, leather and forest green. | Shortbow |
| `soldier` | Soldier / Soldat | Male soldier, **steel helmet with a brass nose guard**, round buckler on the left arm. | Arming sword |
| `soldier-f` | Soldier / Soldatin | Female soldier, same helmet, buckler and sword, **distinct face**. | Arming sword |
| `monk` | Monk / Mönch | Male monk, wrapped orange robe, **shaved head**, **bound fists**. | Bound fist (palm strike or kick) |
| `priestess` | Priestess / Priesterin | Priestess, wrapped robe with a sash, **hair in a high knot**, **bound fists**. | Bound fist |

Each pair (adventurer/adventuress, rogue/rogue-f, soldier/soldier-f) must be easy to tell apart at a glance.

## 6. Rules we never waive

- **No likeness to an existing game or media character.** Do not base any hero on a known character. The
  generated attempts failed this repeatedly: they came out as one specific famous game hero, through the
  *combination* of spiky blond hair, a single oversized shoulder pauldron, a red scarf with a long cape, a dark
  sleeveless outfit with black gloves, and an oversized slab sword. Please avoid that combination. If you can name
  a character your design reminds you of, change it.
- Child-safe: no gore, no blood, no frightening expressions, no revealing outfits. The "dead" clip is a gentle
  fall and lie-down, not violence.
- No text, logos or watermarks in the art.
- The art must be your own original work or properly licensed, with **full commercial rights** to us for the game
  on web, Android and iOS. No AI-generated source imagery in the final art unless we agree in writing.

## 7. References (in this repository folder `rerender-session/images/`)

These are **quality and layout references only**, not designs to copy. They were generated by image models.

- `idle/ACCEPTED-DETAIL-adventurer-idle-gpt-image-1.5.webp`: the level of detail and finish we like (armour
  texture, cloth folds, stitching, shading). **Do not copy the character**: its hair, cape, outfit and sword fail
  the likeness rule above.
- `clips/swing-3-gpt-image-1.5-detail-pass.webp`: the windup and strike we liked as a pose arc.
- `clips/dead-3-gpt-image-1.5-detail-pass.webp`: good fall and lying poses.
- `clips/victory-3-gpt-image-1.5-detail-pass.webp`, `clips/cast-3-gpt-image-1.5-detail-pass.webp`: workable
  victory and cast gestures.
- `models/walk-comparison-6-models.webp`: what the generated walks looked like. All wrong; do not follow them.
- `reference/style-plate-today.webp`: the **current in-game hero** (today's default). It is being replaced and must
  not be reused as a design.

## 8. Acceptance

For each hero we review one **contact sheet**: all 28 frames in a grid plus the portrait. A hero passes when:

1. It looks like the brief and clearly like no existing character.
2. Standing height is equal across clips; feet on one baseline; facing right everywhere.
3. The weapon is present in all swing frames; hurt, cast and victory differ visibly from idle; the walk alternates
   legs.
4. At 56 px the silhouette differs from every other hero.
5. No text, frame, background or shadow; child-safe.

Up to **three rounds** of revisions per hero should be expected. Please quote per hero, plus a rate for the
adventurer as the style-defining first hero.

## 9. Open items for you to answer when you quote

- Your preferred working scale (a 1x frame at the final height, or an exact 2x or 4x version).
- Whether you can deliver layered source files.
- How many heroes you can take, and timing.
- Your licence terms: full commercial buy-out for web, Android and iOS, with the right to adjust or recolour.
