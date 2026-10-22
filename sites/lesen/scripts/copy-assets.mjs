// Reproducible asset-copy step for the Android build.
// Copies the shared web source (static/) into the Capacitor webDir (www/).
// static/ remains the single shared source of truth; www/ is build output and
// must never be edited by hand. The website deploys from static/ independently.
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'static');
const dest = join(root, 'www');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`Copied shared assets: ${src} -> ${dest}`);
