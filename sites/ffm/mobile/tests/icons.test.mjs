// icons.test.mjs — pins the launcher icons to the generated store artwork.
//
// Run with: node --test sites/ffm/mobile/tests/icons.test.mjs
//
// The icons are produced by scripts/render-icons.py from
// ../store-art/app-store/icon-1024x1024.png. These checks read the PNG headers
// directly (no dependencies) and fail on the two mistakes that are invisible
// until a store review or a device shows them:
//
//   * a launcher icon with transparency, or with a rounded mask baked in
//     (the previous Android icon had transparent corners, which double-masks
//     inside Android's own adaptive mask and is rejected by Apple for iOS),
//   * adaptive layers whose size no longer matches the 108dp/16.7% convention
//     that mipmap-anydpi-v26 relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(root, 'android/app/src/main/res');
const IOS_ICON = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');

// 48dp legacy launcher at each density scale.
const LEGACY = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// 108dp adaptive layer at each density scale; the mask shows the inner 72dp.
const ADAPTIVE = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const PNG_COLOR_TYPE = { RGB: 2, RGBA: 6 };
const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

async function readPng(...parts) {
  const path = join(...parts);
  await stat(path);
  const data = await readFile(path);
  assert.equal(data.subarray(0, 8).toString('latin1'), PNG_SIGNATURE, `${path} is not a PNG`);
  assert.equal(data.subarray(12, 16).toString('latin1'), 'IHDR', `${path} has no IHDR`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

test('the iOS icon is a flat 1024px square with no alpha channel', async () => {
  const png = await readPng(IOS_ICON);
  assert.deepEqual([png.width, png.height], [1024, 1024], 'App Store Connect requires exactly 1024x1024');
  assert.equal(png.bitDepth, 8);
  assert.equal(png.colorType, PNG_COLOR_TYPE.RGB, 'iOS rejects an app icon with an alpha channel');
});

test('legacy Android launcher icons are full-bleed squares at every density', async () => {
  for (const [density, size] of Object.entries(LEGACY)) {
    const square = await readPng(RES, `mipmap-${density}`, 'ic_launcher.png');
    assert.deepEqual([square.width, square.height], [size, size], `mipmap-${density}/ic_launcher.png`);
    // No alpha means no baked rounded corners: Android applies its own mask.
    assert.equal(square.colorType, PNG_COLOR_TYPE.RGB, `mipmap-${density}/ic_launcher.png must not carry transparency`);
  }
});

test('the round launcher icon is a real circle, not a square in disguise', async () => {
  for (const [density, size] of Object.entries(LEGACY)) {
    const round = await readPng(RES, `mipmap-${density}`, 'ic_launcher_round.png');
    assert.deepEqual([round.width, round.height], [size, size], `mipmap-${density}/ic_launcher_round.png`);
    // The corners are masked away, so this layer is the one that needs alpha.
    assert.equal(round.colorType, PNG_COLOR_TYPE.RGBA, `mipmap-${density}/ic_launcher_round.png must be cut to a circle`);
  }
});

test('adaptive layers are 108dp and the XML keeps the 16.7% inset that fits them', async () => {
  // The layers are deliberately full-bleed. mipmap-anydpi-v26 shrinks each to
  // 72dp with android:inset="16.7%", which is what puts the whole icon — hero,
  // sword and wordmark — inside the circular mask. Drop the inset and the mask
  // crops the wordmark off; pre-shrink the art as well and the icon floats in
  // the middle of the tile.
  for (const [density, size] of Object.entries(ADAPTIVE)) {
    const foreground = await readPng(RES, `mipmap-${density}`, 'ic_launcher_foreground.png');
    assert.deepEqual([foreground.width, foreground.height], [size, size], `mipmap-${density}/ic_launcher_foreground.png`);
    const background = await readPng(RES, `mipmap-${density}`, 'ic_launcher_background.png');
    assert.deepEqual([background.width, background.height], [size, size], `mipmap-${density}/ic_launcher_background.png`);
  }

  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const adaptive = await readFile(join(RES, 'mipmap-anydpi-v26', name), 'utf8');
    assert.match(adaptive, /@mipmap\/ic_launcher_background/, `${name} must use the committed background layer`);
    assert.match(adaptive, /@mipmap\/ic_launcher_foreground/, `${name} must use the committed foreground layer`);
    assert.match(adaptive, /android:inset="16\.7%"/, `${name} must keep the 16.7% inset that fits 108dp into the 72dp safe zone`);
  }
});
