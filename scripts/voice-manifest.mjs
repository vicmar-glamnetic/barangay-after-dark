// Builds public/voice/manifest.json from the recordings in public/voice/fil and public/voice/en.
// A file named after a line's slug (see public/voice/lines.csv) replaces the browser voice for that line.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/voice/', import.meta.url)); // (works with spaces in the path)
const manifest = {};
for (const lang of ['fil', 'en']) {
  manifest[lang] = {};
  mkdirSync(join(dir, lang), { recursive: true });
  for (const f of readdirSync(join(dir, lang))) {
    const m = f.match(/^([a-z0-9-]+)\.(mp3|m4a|ogg|wav)$/);
    if (m) manifest[lang][m[1]] = `${lang}/${f}`;
  }
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`voice: ${Object.keys(manifest.fil).length} Filipino + ${Object.keys(manifest.en).length} English recordings`);

// Ambience recordings: public/sfx/<name>.(mp3|ogg|m4a|wav) for rooster, kids, crowd, dogs, crickets, motorbike.
const sfxDir = fileURLToPath(new URL('../public/sfx/', import.meta.url));
mkdirSync(sfxDir, { recursive: true });
const NAMES = ['rooster', 'kids', 'crowd', 'dogs', 'crickets', 'motorbike'];
const sfx = {};
for (const f of readdirSync(sfxDir)) {
  const m = f.match(/^([a-z]+)\.(mp3|m4a|ogg|wav)$/);
  if (m && NAMES.includes(m[1])) sfx[m[1]] = f;
}
writeFileSync(join(sfxDir, 'manifest.json'), JSON.stringify(sfx, null, 2) + '\n');
console.log(`sfx: ${Object.keys(sfx).join(', ') || 'none (using synthesized sounds)'}`);
