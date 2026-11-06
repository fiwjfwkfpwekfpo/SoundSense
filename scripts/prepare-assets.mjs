import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Packaging copies are generated from the single source in assets/branding/.
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
await copyFile(new URL('assets/branding/SoundSense.png', root), new URL('public/SoundSense.png', root));
console.log(`Brand asset prepared from ${fileURLToPath(new URL('assets/branding/SoundSense.png', root))}`);
