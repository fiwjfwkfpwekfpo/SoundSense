import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseChannel } from './lib/channels.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command = 'build', requested = 'stable', ...args] = process.argv.slice(2);
if (!['dev', 'build', 'preview'].includes(command) || requested === 'all' && command !== 'build') {
  throw new Error('Usage: node scripts/web.mjs dev|build|preview stable|beta [Vite options]; build all');
}
if (command !== 'preview') await import('./prepare-assets.mjs');
for (const name of requested === 'all' ? ['stable', 'beta'] : [requested]) {
  const channel = releaseChannel(name);
  const result = spawnSync(process.execPath, [
    'node_modules/vite/bin/vite.js', ...(command === 'dev' ? [] : [command]),
    '--config', 'config/vite.config.ts', '--mode', channel.name,
    ...(command === 'build' ? [] : ['--host', '127.0.0.1']), ...args,
  ], { cwd: root, env: { ...process.env, SS_CHANNEL: channel.name }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
