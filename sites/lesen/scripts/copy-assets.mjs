// Reproducible asset-copy step for the Android build.
// Copies the shared web source (static/) into the Capacitor webDir (www/).
// static/ remains the single shared source of truth; www/ is build output and
// must never be edited by hand. The website deploys from static/ independently.
import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REQUIRED_FILES } from './verify-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'static');
const dest = join(root, 'www');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

const missing = [];
for (const rel of REQUIRED_FILES) {
  const info = await stat(join(dest, rel)).catch(() => null);
  if (!info?.isFile()) missing.push(rel);
}
if (missing.length > 0) {
  throw new Error(
    `Asset copy is incomplete; missing from ${dest}: ${missing.join(', ')}`,
  );
}

console.log(
  `Copied shared assets: ${src} -> ${dest} (${REQUIRED_FILES.length} required files verified)`,
);
