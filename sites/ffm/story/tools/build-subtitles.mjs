// build-subtitles.mjs — writes WebVTT subtitle files (one per locale) next to
// every scene.json, so the cues are also usable by standard <track>/video
// tooling. scene.json stays the single source of truth.
//
//   node sites/ffm/story/tools/build-subtitles.mjs          write the files
//   node sites/ffm/story/tools/build-subtitles.mjs --check  fail if any is stale
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES = ['en', 'de'];
const scenesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenes');

function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
}

export function toVtt(scene, locale) {
  const cues = scene.subtitles.map((cue, i) =>
    `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text[locale]}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export async function sceneIds() {
  const entries = await readdir(scenesDir, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

async function main() {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const id of await sceneIds()) {
    const scene = JSON.parse(await readFile(join(scenesDir, id, 'scene.json'), 'utf8'));
    for (const locale of LOCALES) {
      const file = join(scenesDir, id, `subtitles.${locale}.vtt`);
      const expected = toVtt(scene, locale);
      const current = await readFile(file, 'utf8').catch(() => null);
      if (current === expected) continue;
      if (check) stale.push(file);
      else await writeFile(file, expected);
    }
  }
  if (stale.length) {
    console.error(`Stale subtitles (run build-subtitles.mjs):\n${stale.join('\n')}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
