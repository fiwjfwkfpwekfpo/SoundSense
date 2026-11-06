import { readFileSync } from 'node:fs';

export const channels = JSON.parse(readFileSync(new URL('../../config/channels.json', import.meta.url), 'utf8'));

export function releaseChannel(value = process.env.SS_CHANNEL ?? 'stable') {
  if (!Object.hasOwn(channels, value)) throw new Error(`Unknown release channel: ${value}. Choose stable or beta.`);
  return { name: value, ...channels[value] };
}

/**
 * Android versionCode per channel from the shared package.json versionCode: base·10, stable +5.
 * A beta build is always older than the stable build of the same base, so beta → stable of the
 * same release updates; a newer beta (higher base) is newer than any older stable.
 * Keep in sync with android/app/build.gradle and config/vite.config.ts.
 */
export function channelVersionCode(base, channel) { return Number(base) * 10 + (channel === 'stable' ? 5 : 0); }
