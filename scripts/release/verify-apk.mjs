import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { releaseChannel } from '../lib/channels.mjs';

/** Validate the native identity AND the web payload, including --skip-build releases. */
export function verifyApk(apk, name, version, versionCode) {
  const channel = releaseChannel(name);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || fileURLToPath(new URL('../../.toolchain/android-sdk/', import.meta.url));
  const tools = readdirSync(join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const aapt = spawnSync(join(sdk, 'build-tools', tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
  const identity = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(aapt.stdout ?? '');
  if (aapt.status !== 0 || !identity || identity[1] !== channel.appId || Number(identity[2]) !== Number(versionCode) || identity[3] !== version) throw new Error('APK identity does not match the requested channel/version');
  if (aapt.stdout.includes('application-debuggable')) throw new Error('Publish a release APK; Android debug builds are for local development');
  const metadataPath = 'assets/public/release.json', configPath = 'assets/capacitor.config.json';
  const files = unzipSync(readFileSync(apk), { filter: file => file.name === metadataPath || file.name === configPath });
  if (!files[metadataPath] || !files[configPath]) throw new Error('APK is missing release metadata or Capacitor configuration');
  const metadata = JSON.parse(strFromU8(files[metadataPath])), config = JSON.parse(strFromU8(files[configPath]));
  if (metadata.channel !== channel.name || metadata.appId !== channel.appId || metadata.debugTools !== channel.debugTools || metadata.version !== version || metadata.versionCode !== Number(versionCode) || config.appId !== channel.appId || config.android?.webContentsDebuggingEnabled !== channel.debugTools || config.loggingBehavior !== 'none') throw new Error('APK contains web assets/configuration from a different channel or version');
  return { channel, tools: join(sdk, 'build-tools', tools) };
}
