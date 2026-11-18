# Hero re-render session log (2026-11-17)

Branch: `hero-rerender`, cut from `origin/harness/run/20261116-arithmoslayer-hero-pack-md` (c4be2963).
Worktree used: `../DerSchweigert-rerender`. Nothing merged to main. The decision task
`decision-ffmhero-adventurer-cutover-1` was not touched. No hero art is committed to `static/game/heroes/`
(no hero reached an acceptable state); only the experiment record is committed here.

## The instruction (verbatim source)

`INSTRUCTION-rerender-session-prompt.md` (this folder) is the instruction this session executed: re-render the ArithmoSlayer
hero pack with the owner judging images; adventurer first (3 identity looks), then 9 others; prompts from
`hero_prompts.py` unchanged apart from a seed or one corrective sentence; generator `tools/fal_image.py` with
`fal-ai/flux-pro/kontext`; per-hero commit of atlas, frames, portrait, contact sheet and PROVENANCE rows; rules never
waived (no likeness to an existing game character; look rules; equal height; facing right; 56 px silhouette
difference).

## Outcome in one paragraph

Only the adventurer was worked on, and he is **not finished or approved**. The owner picked the generated idle
sheet "909" and accepted, in the owner's words, "the possible conflict" with the likeness rule: that sheet still has
spiky hair, a single pauldron, a cape and a dark outfit, so it **fails** the standing look rules and likeness rule.
Walk, hurt and swing clips are not acceptable. The decision to commission an artist follows from this. Nothing
below has been shown to pass the rules; do not ship it.

## What was tried (about 40 generator calls; credit use not verified, check the fal dashboard)

The harness ledger no longer counts credits; the plan had 320 and the previous run used 81. Call counts below are
mine; prices per call for the non-kontext models were not visible to me.

### A. Adventurer identity sheet (idle)

| Try | Method | Result |
|---|---|---|
| Today's plate (`hero_frames.py --style-reference`) shown | n/a | It is a near-exact copy of a known game hero (spiky mane, one pauldron, red scarf and cape, dark navy outfit, slab sword). Root cause of the earlier failures. |
| Hand-drawn grey mannequin as reference, front view (`scripts/man2.py`) | kontext, tool idle prompt + corrective sentence | Copied the mannequin into cell 1, front and back views. Rejected. |
| Profile mannequin (`scripts/man3.py`), seeds 101, 202, 303 (`idle/mannequin-look-*`) | kontext, same + "side view" sentence | Look A (101): soft rounded bob, scarf, round pauldron, faces **left**, light-blue tunic, no sword in cell 1. Closest. B (202) copied the mannequin. C (303) brought spikes back. |
| Today's plate unchanged, tool prompt unchanged, seeds 404, 505, 606 (`idle/plain-plate-seed*`) | kontext | Spiky hair, dark sleeveless top, head-and-shoulders crops. Rejected (same failure as the harness run). |
| Today's plate + one long corrective sentence (hair, light-blue plate, two pauldrons, detail), seeds 707, 808, 909 | kontext | Full body and high detail, but outfit unchanged. 707: bob hair in 3 of 4 cells, spikes in 1. 808, 909: spiky. **Owner chose 909.** |

Accepted by owner (with the likeness conflict acknowledged): `idle/ACCEPTED-adventurer-idle-909-padded.webp`
(944x1104 padded to 1104x1104 with magenta).

### B. Resolution / detail of the 909 sheet

| Try | Result |
|---|---|
| Local Lanczos 2x + unsharp, and a palette-reduce variant | Marginal; palette reduce made it worse. |
| `fal-ai/clarity-upscaler` 2x (`fal-upscale-clarity-909`) | Crisper edges, blockier, pink fringe on the sword. |
| kontext "regenerate with more detail", seeds 909 and 910 | Flatter and smaller on canvas than the original. Rejected. |
| **`fal-ai/gpt-image-1.5/edit`, reference only, prompt "Increase the level of detail ... keep everything else exactly the same"** | **Clear upgrade** (`idle/ACCEPTED-DETAIL-adventurer-idle-gpt-image-1.5`). The owner called it "great". Looser face, more saturated, painterly. |

### C. Six clip sheets (reference: padded 909 sheet, tool prompts unchanged, seed 909)

`clips/<clip>-1-kontext-first`: only dead was usable; walk, hurt, cast, victory had near-idle cells.
`clips/<clip>-2-kontext-corrective-retry`: corrective sentence per clip (below); swing, victory, cast improved;
hurt partial; walk still four identical poses.
`clips/<clip>-3-gpt-image-1.5-detail-pass`: the gpt-image-1.5 detail instruction applied to the best sheet of each
clip (walk used the gpt-image-1.5 walk below). Poses preserved and detail upgraded. Small hallucinated extras
(a hilt behind the shoulder in cast; straps), faint floor shadows, mildly noisy magenta backdrop.

Corrective sentences used with kontext (one per clip, all end "full-body side view facing right"):
- walk: cells 1 and 3 legs wide apart in mid-stride, 2 and 4 legs together, arms opposite to legs
- swing: sword high behind head, sweeping diagonally down, fully extended, carried low past the front foot
- hurt: head and chest thrown back, knees bent, one arm flung out, wincing in cells 1 and 2, straightening in 3 and 4
- victory: fist raised above the head, sword aloft in cell 2, feet planted and chest out in cell 4
- cast: free hand to chest, thrust forward palm open, held steady, drawn back; other hand holds the sword low

### D. Model comparison on the walk clip (`models/`)

All with the tool's walk prompt + the leg sentence, reference = padded 909 sheet.

| Model | Result |
|---|---|
| `fal-ai/flux-pro/kontext`, `.../kontext/max` | Four identical static front or three-quarter poses. Fail. |
| `fal-ai/nano-banana/edit` (Gemini 2.5 Flash Image) | True profile facing right, correct palette, magenta backdrop. **Same leg forward in all four cells**, sword dragged. |
| `fal-ai/nano-banana-pro/edit` | Profile, most varied stride and arm swing; **no sword, purple backdrop**. |
| `fal-ai/gpt-image-1.5/edit` | Profile, stride, cleanest pixels; floor shadow, one stride repeated. A second run with explicit leg wording (`clips/walk-gpt-image-1.5-leg-instruction`) fixed the backdrop and sword but not the legs. |
| `fal-ai/bytedance/seedream/v4/edit` | Mixed facing, mottled backdrop, 1536 px. |

Extra walk tries: nano-banana with explicit leg wording (`walk-nano-banana-leg-instruction`): cell 2 became a
passing pose, cells 1, 3, 4 still the same stride. Opposite-stride edit of a single cropped cell
(`walk-nano-banana-opposite-stride-failed`): returned the input unchanged.

**Core finding:** no model produced a left/right alternating walk cycle, and none changed the leg that leads.
Models also copy the reference's pose and outfit when asked to "keep the character" (it is why the spiky hair and
the dark outfit never went away).

## What is unfinished

- Adventurer: look rules not met (hair, pauldrons, outfit), walk and hurt not acceptable, facing is three-quarter
  in most clips, no portrait, no build, no contact sheet.
- The other nine heroes: untouched this session. Their manifest rows and "NEEDS RE-RENDER" PROVENANCE sections are
  unchanged.
- Gates (`check-heroes.mjs`, `hero-assets.test.js` etc.) were not run: no hero files changed.

## Decisions for the owner before commissioning

1. **The likeness conflict.** The 909 sheet and its detail-pass version still resemble the known character the
   rules forbid. `ARTIST-BRIEF.md` therefore tells the artist to use them only as a detail-level reference and
   not to copy the character. Consider not sending `reference/style-plate-today` and the 909 sheets at all if you
   want the artist's design to be clearly independent; the brief works without them.
2. Whether to commission all ten heroes or the adventurer first (the brief asks for the adventurer first).
3. Rights: full commercial buy-out for web, Android and iOS; no AI-generated source in the final art.
4. Harness plan 20261116-arithmoslayer-hero-pack-md: 29 of 31 issues are done; the cutover task and release wait on
   approved art.

## Files in this folder

- `ARTIST-BRIEF.md`: the brief to send (written for an external artist).
- `images/idle/`, `images/clips/`, `images/models/`, `images/reference/`: every kept image as lossless WebP.
  `ACCEPTED-*` marks the owner-accepted idle sheets (with the caveat above). Raw intermediates are in git history
  only if you ask for them; the tmp originals were PNG.
- `scripts/`: mannequin generators (`mannequin.py`, `man2.py`, `man3.py`) and `gen.sh`, the first identity generator.
  The later generator calls were inline Python through `tools/fal_image.py:generate()` (reading the key from the
  keychain or `~/.config/fal/key`), with these endpoints and parameters:
  - kontext: `{"prompt", "image_url": <data URI>, "seed", "output_format": "png", "image_size": {"width":1024,"height":1024}}`
  - nano-banana and nano-banana-pro `/edit`: `{"prompt", "image_urls": [<data URI>], "output_format": "png"}`
  - gpt-image-1.5 `/edit`: `{"prompt", "image_urls": [<data URI>], "image_size": "1024x1024", "output_format": "png"}`
  - seedream v4 `/edit`: `{"prompt", "image_urls": [...], "image_size": {"width":1536,"height":1536}}`
  - clarity-upscaler: `{"image_url", "prompt", "upscale_factor": 2, "creativity": 0.2, "resemblance": 0.9, "seed"}`
    (returns `{"image": {...}}`, not `images`, so `generate()` raises after the call succeeds; download the URL.)
  Sheets above 1024 px are padded to square with the backdrop colour first.
