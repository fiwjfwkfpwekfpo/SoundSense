import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const violations = [];
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (/\.(svelte|ts)$/.test(path)) {
      const name = relative(root, path);
      const source = await readFile(path, 'utf8');
      if (!name.startsWith('src/mock/') && name !== 'src/main.ts' && /(?:from\s*|import\s*\()["'][^"']*\bmock\//.test(source)) violations.push(`${name}: mock import outside composition root`);
      if (name.startsWith('src/core/') && /(?:from\s*)["'][^"']*\bui\//.test(source)) violations.push(`${name}: core depends on UI`);
    }
  }
}
await scan(resolve(root, 'src'));
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Architecture: UI and core are independent of mock implementations.');
