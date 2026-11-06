import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const inputRoot = process.argv[2] ?? resolve(homedir(), '.config/HyprTheme');
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { readColorLiterals, importPalette } = await server.ssrLoadModule('/src/ui/appearance/palette-import.ts');
  const corrections = {};
  for (const [folder, id, name, file] of [['PURPLE','amethyst','Аметист','Colors.qml'], ['stardust','silver','Серебро','theme.json'], ['gamesense','lime','Лайм','Colors.qml'], ['urushi','gold','Золото','Colors.qml']]) {
    const text = await readFile(resolve(inputRoot, folder, 'quickshell', file), 'utf8');
    const input = file.endsWith('.qml') ? { palette: readColorLiterals(text) } : JSON.parse(text);
    const result = importPalette(input, name);
    await writeFile(resolve(root, 'src/ui/appearance/colors', `${id}.json`), JSON.stringify(result.pack, null, 2) + '\n');
    corrections[id] = { mainBgCompositedOverBlack: result.compositedMainBg, corrections: result.corrections };
    console.log(`${name}: ${result.corrections.length} contrast corrections`);
  }
  const output = resolve(root, 'docs/palette-corrections.json'); await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(corrections, null, 2) + '\n');
} finally { await server.close(); }
