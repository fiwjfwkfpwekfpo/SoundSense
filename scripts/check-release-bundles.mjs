import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { channelVersionCode, releaseChannel } from './lib/channels.mjs';
import manifest from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['stable', 'beta']) {
  const channel = releaseChannel(name), directory = join(root, 'dist', name);
  const metadata = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
  if (metadata.channel !== name || metadata.debugTools !== channel.debugTools || metadata.appId !== channel.appId || metadata.version !== manifest.version || metadata.versionCode !== channelVersionCode(manifest.versionCode, name)) throw new Error(`Wrong ${name} metadata`);
  const assets = readdirSync(join(directory, 'assets'));
  const source = assets.filter(file => file.endsWith('.js')).map(file => readFileSync(join(directory, 'assets', file), 'utf8')).join('\n');
  for (const marker of ['ss_diagnostics_v1', 'SoundSense-diagnostics-', 'long-animation-frame', 'Журнал хранится на устройстве', 'track.transition.frames', 'track.transition.nativeFrames']) {
    if (source.includes(marker) !== channel.debugTools) throw new Error(`${name}: unexpected presence/absence of ${marker}`);
  }
  if (!channel.debugTools && assets.some(file => /diagnostics|profiler/i.test(file))) throw new Error('Debug chunks leaked into stable');
  console.log(`${name}: identity and debug code exclusion verified`);
}
