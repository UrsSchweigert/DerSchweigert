// card-timing.mjs — paces every story scene by the reading time of its cards.
//
// The scenes have no voice-over, so nothing but the text decides how long a
// card stays up. Each card gets a fixed lead (it fades in, the eye finds it)
// plus its visible characters at a young reader's speed, never less than a
// minimum. Both locales share one timeline, so the slower one (German runs
// about a fifth longer) sets the window.
//
//   node sites/ffm/static/story/tools/card-timing.mjs          retime every scene.json
//   node sites/ffm/static/story/tools/card-timing.mjs --check  fail if any scene is off
//
// When a scene's length changes, every other time in it (layer keyframes, glow
// windows, lighting events) is stretched by the same factor, so the art keeps
// its pacing relative to the cards. An event may instead name the card it
// belongs to ("atCue": index, optional "offset" in seconds): it then sits that
// far from the card's start, e.g. the dim that brings in an act's title card.
// Run build-subtitles.mjs afterwards.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { plainText } from '../player/diorama-player.js';
import { LOCALES, sceneIds, scenesDir } from './build-subtitles.mjs';

export const READING = Object.freeze({
  // Characters per second: comfortable for a confident primary-school reader.
  charsPerSecond: 15,
  // Fade-in plus the moment it takes to find the card on the scene.
  leadSeconds: 1.5,
  // Even a three-word card stays up long enough to be read twice.
  minSeconds: 4,
  // Blank paper between two cards, so each one visibly arrives.
  gapSeconds: 0.4,
  // The first card waits for the scene to fade in.
  firstStart: 0.8,
  // The last card holds a little before the scene ends by itself.
  tailSeconds: 0.6,
});

const round = value => Math.round(value * 10) / 10;

/** Seconds one card needs on screen in one locale. */
export function cardSeconds(text) {
  const length = [...plainText(text)].length;
  return Math.max(READING.minSeconds, READING.leadSeconds + length / READING.charsPerSecond);
}

/** Seconds a cue needs: the slowest of its locales. */
export function cueSeconds(cue) {
  return Math.max(...LOCALES.map(locale => cardSeconds(cue.text?.[locale] ?? '')));
}

function stretch(value, factor) {
  return Number.isFinite(value) ? round(value * factor) : value;
}

/**
 * The scene with its cues laid out back to back at reading speed and the rest
 * of its timeline stretched to the new length. Returns a new object.
 */
export function retimeScene(scene) {
  const next = structuredClone(scene);
  let at = READING.firstStart;
  next.subtitles = scene.subtitles.map((cue, index) => {
    if (index) at += READING.gapSeconds;
    const start = round(at);
    // Rounded up, so the window never drops below the reading estimate.
    const end = Math.ceil((start + cueSeconds(cue)) * 10) / 10;
    at = end;
    return { ...cue, start, end };
  });
  const duration = round(at + READING.tailSeconds);
  const factor = duration / scene.duration;
  next.duration = duration;
  if (Math.abs(factor - 1) > 1e-9) {
    for (const layer of next.layers) {
      for (const key of layer.motion ?? []) key.t = Math.min(duration, stretch(key.t, factor));
    }
    for (const glow of next.lighting?.glows ?? []) {
      if ('from' in glow) glow.from = stretch(glow.from, factor);
      if ('to' in glow) glow.to = stretch(glow.to, factor);
    }
    for (const event of next.lighting?.events ?? []) {
      if (!Number.isInteger(event.atCue)) event.at = stretch(event.at, factor);
    }
  }
  for (const event of next.lighting?.events ?? []) {
    if (!Number.isInteger(event.atCue)) continue;
    const cue = next.subtitles[event.atCue];
    if (cue) event.at = round(cue.start + (event.offset ?? 0));
  }
  return next;
}

async function main() {
  const check = process.argv.includes('--check');
  const off = [];
  for (const id of await sceneIds()) {
    const file = join(scenesDir, id, 'scene.json');
    const scene = JSON.parse(await readFile(file, 'utf8'));
    const timed = retimeScene(scene);
    const text = `${JSON.stringify(timed, null, 2)}\n`;
    if (JSON.stringify(timed) === JSON.stringify(scene)) continue;
    if (check) off.push(file);
    else await writeFile(file, text);
  }
  if (off.length) {
    console.error(`Scenes not paced to their cards (run card-timing.mjs):\n${off.join('\n')}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
