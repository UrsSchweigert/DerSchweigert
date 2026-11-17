Re-render the ArithmoSlayer hero pack with me, in this session. The harness run is finished, so I'm the one who judges the images.

## Where things stand
- Plan 20261116-arithmoslayer-hero-pack-md: 29 of 31 issues are done. All the code and tooling is merged on the run branch `harness/run/20261116-arithmoslayer-hero-pack-md`. That branch is NOT merged to main yet, and the hero tools only exist on it. Work on a branch or worktree created from `origin/harness/run/20261116-arithmoslayer-hero-pack-md`. Don't merge to main without asking me.
- No hero has acceptable art. Ten heroes: adventurer, adventuress, princess, princess-armed, rogue, rogue-f, soldier, soldier-f, monk, priestess.
  - Eight have no art files committed (adventurer, adventuress, princess, princess-armed, rogue, rogue-f, soldier, soldier-f). The generated images read as an existing game character: spiky blond hair, a single pauldron, a red scarf, a dark outfit, an oversized blade. Their manifest rows are kept, and their PROVENANCE.md sections say "NEEDS RE-RENDER (not committed: likeness)".
  - Monk and priestess have placeholder art committed (they missed facing, hand bindings and pose variety). They are marked "NEEDS RE-RENDER".
- Root cause: every hero takes the adventurer's idle-1 as the style reference, and today's idle-1 is the problem. The softened style plate (`hero_frames.py --style-reference`) still carries the spikes. So the adventurer comes first, and its look must change enough that no known character comes to mind. Then the other nine take the new adventurer's idle-1 as their reference.
- Open decision task `decision-ffmhero-adventurer-cutover-1`. The harness issue `ffmhero-adventurer-cutover` deletes the old default hero art, and `ffmhero-release` follows it. I'll answer it with option 1 myself after I approve the new adventurer. Don't touch it.

## Tools (all on the run branch)
- Prompts: `python3 sites/ffm/scripts/hero_prompts.py --hero <id> --sheet idle|walk|swing|hurt|dead|victory|cast|portrait`. The prompt comes from this tool unchanged. The only allowed edits are a new seed or one corrective sentence about the defect. Never name or describe a game, franchise or third-party character, and never use "in the style of".
- Generation: the harness art service is not running, so call the generator directly with `tools/fal_image.py`. Its key comes from the keychain or `~/.config/fal/key`. Model is `fal-ai/flux-pro/kontext`, 1024 square, magenta or flat backdrop, facing right, no text, no shadow. The plan had 320 credits and used 81. Tell me before each batch of calls and how many credits it costs, since the ledger no longer counts them.
- Build: `hero_poses.py --split <sheet> --name <clip> --height 163 --out <dir>`, then `hero_frames.py --from-frames <dir> --hero <id> --weapon <w> --strict` with the strike and cast anchors measured on the built frames. Then one bust pass on the idle-1 plate and `hero_portrait.py --hero <id> --from bust.png`. Then `hero_frames.py --contact-sheet` writes `heroes/<id>/source/contact-sheet.webp` (at most 400 KB, lossless).
- Generated sheets may come back non-square (944x1104 happened). Pad them to square with the backdrop colour before splitting.
- Per hero, the commit holds exactly `sites/ffm/static/game/heroes/<id>/{hero-atlas.webp (at most 700 KB), hero-frames.js, portrait.webp (256x256, at most 24 KB), source/contact-sheet.webp}` plus that hero's rows in `heroes/PROVENANCE.md` (hero, clip, prompt summary, seed, model, reference, date). Raw sheets are not committed.
- Gates: `node sites/ffm/static/game/heroes/check-heroes.mjs` (once all ten are done, also with `--settled`), `node --test sites/ffm/static/game/hero-assets.test.js`, `node --test sites/ffm/static/game/*.test.js`, and the Python tests under `sites/ffm/tests/test_hero_*.py`.
- Full requirements: `docs/harness/requirements/20261116_arithmoslayer-hero-pack.md`. Per-hero look rules (hair, headgear, weapon, strike family, display names EN/DE) live in `hero_prompts.py` BRIEFS and in `uploads/20261116_arithmoslayer-hero-pack_plan/issues.json` (the `ffmhero-art-*` issues).

## Rules I never waive
- No likeness to an existing game character. If you can name one, reject the image.
- Look rules per hero. The adventurer has soft golden-blonde hair with at most three small rounded tufts, a crimson scarf, a blue plate cuirass with pauldrons and a longsword. No spikes, no starburst outline.
- Equal standing height across clips. The weapon is present in every swing frame. Facing right in every frame. Hands as the hero's brief says. Hurt, cast and victory differ visibly from idle. No text, frame or background. Child-safe.
- At 56 px and at playfield scale, every hero's silhouette must differ from every other hero's.

## How to work
1. Adventurer first: give me up to three identity looks (idle sheet only), each saved as a PNG I can open. Don't continue until I pick one. Then the six clip sheets, the portrait, the build, the contact sheet, and I review it.
2. After I approve the adventurer, the other nine, one at a time, in the order: adventuress, princess, princess-armed, rogue, rogue-f, soldier, soldier-f, monk, priestess. Show me each identity sheet before spending credits on its clips.
3. Commit per hero on the work branch, never to main. Update that hero's PROVENANCE.md section (remove "NEEDS RE-RENDER" only when it's really done).
4. When all ten are done, run all gates and tell me what is left: merge the run branch, answer the cutover task, release.

Start by reading `heroes/PROVENANCE.md` and the adventurer's BRIEFS entry, then propose the new adventurer look (hair, silhouette) in a few lines for me to approve before generating anything.
