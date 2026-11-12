# FFM game assets: bundle size and the level-art budget

Measured on 2026-11-12 with Node 22 on a fresh `npm run copy-assets` build into a
temporary directory, so `sites/ffm/mobile/www/` is never touched by the
measurement:

```bash
cd sites/ffm/mobile
node -e 'import("./scripts/copy-assets.mjs").then(async (m) => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ffm-measure-"));
  await m.copyAssets(undefined, dir, m.APP_OVERLAY);
  let total = 0;
  for (const e of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) total += (await fs.stat(path.join(e.parentPath ?? e.path, e.name))).size;
  }
  console.log(total);
  await fs.rm(dir, { recursive: true, force: true });
});'
```

## Measured `www/` size

| Build | Bytes | MiB |
| --- | --- | --- |
| Before the shared sword row and the level manifest | 42,144,962 | 40.19 |
| After the shared sword row (`game/encounter-swords.js`, 5,206 B) | 42,150,168 | 40.20 |
| After the level manifest (`game/levels/manifest.json`, 4,381 B) | 42,154,549 | 40.20 |

The two additions together are 9,587 B (9.4 KiB) across 382 bundled files: the
sword row shares one module between web and app, and the manifest is metadata
only (dimensions, byte budget, file name and chapter per level).

## Committed level art

No level image is committed yet: `sites/ffm/static/game/levels/` holds
`manifest.json`, `check-art.mjs` and the art briefs, and the build copies zero
`level-NN.webp` files. The three ability icons
(`game/assets/ability-wind.webp`, `ability-storm.webp`, `ability-earth.webp`)
are likewise not committed; the ability bar falls back to its text labels.

Nothing in the app bundle depends on those files existing. The renderer
resolves level art first, then the chapter stage art, then the legacy
`background.webp`, and `bundle-check.mjs` reports absent icons instead of
requiring them.

## The 60-image budget

`game/levels/manifest.json` caps each level image at 409,600 B at 1536x1024:

| Item | Value |
| --- | --- |
| Per-image cap | 409,600 B (400 KiB) |
| 60 images at the cap | 24,576,000 B (23.4 MiB) |
| Accepted growth for all 60 images | ~19 MB (about 316,700 B each) |

At the accepted ~19 MB the bundle would grow from 40.20 MiB (42.15 MB) to
roughly 58 MiB (61 MB). That is a projection from the budget, not a
measurement: no level image is committed, so the measured growth today is the
9,587 B of the sword row and the manifest above. `node sites/ffm/static/game/levels/check-art.mjs --all`
reports each committed image's size and dimensions and fails an oversized or
malformed one; `--manifest` validates the budget and names with no image on
disk.

## Checks

```bash
node sites/ffm/mobile/scripts/bundle-check.mjs          # required files, manifest, copied art, offline rules
node --test sites/ffm/static/game/offline-assets.test.js # no new remote URL, fetch, XHR, beacon or analytics
node sites/ffm/static/game/levels/check-art.mjs --manifest
cd sites/ffm/mobile && npm test                          # includes the bundle and accessibility checks
```

`bundle-check.mjs` prints the present/total ability icons and the copied level
image count, and fails only when art that the source ships is missing from the
bundle (or is not WebP art).
