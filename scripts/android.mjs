import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseChannel } from './lib/channels.mjs';
import manifest from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const [command = 'apk', requested = 'stable', ...args] = process.argv.slice(2);
const channel = releaseChannel(requested);
const buildType = args.includes('--debug') || command === 'run' ? 'debug' : 'release';
if (!['apk', 'run'].includes(command) || args.some(arg => arg !== '--debug')) throw new Error('Usage: node scripts/android.mjs apk|run stable|beta [--debug]');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || resolve(root, '.toolchain/android-sdk');
const jdk = process.env.JAVA_HOME || resolve(root, '.toolchain/jdk-21');
if (!existsSync(sdk) || !existsSync(jdk)) throw new Error('Run npm run android:setup, or set ANDROID_HOME and JAVA_HOME.');
// Preserve the certificate used by earlier local releases; never generate or replace a key.
const legacyHome = [join(homedir(), '.config/.android'), join(homedir(), '.android')].find(path => existsSync(join(path, 'debug.keystore')));
const androidUserHome = process.env.ANDROID_USER_HOME || legacyHome;
const signingStore = process.env.SS_ANDROID_KEYSTORE || (androidUserHome && join(androidUserHome, 'debug.keystore'));
if (buildType === 'release' && (!signingStore || !existsSync(signingStore))) throw new Error('Release signing key missing. Set SS_ANDROID_KEYSTORE and signing credentials, or use --debug for a development APK.');
const env = { ...process.env, SS_CHANNEL: channel.name, ...(androidUserHome ? { ANDROID_USER_HOME: androidUserHome } : {}), ...(signingStore ? { SS_ANDROID_KEYSTORE: signingStore } : {}), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, JAVA_HOME: jdk, PATH: `${jdk}/bin:${sdk}/platform-tools:${process.env.PATH}` };
function run(cmd, list, cwd = root) {
  const result = spawnSync(cmd, list, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['scripts/web.mjs', 'build', channel.name]);
if (!existsSync(resolve(root, 'android'))) run('npx', ['cap', 'add', 'android']);
writeFileSync(resolve(root, 'android/local.properties'), `sdk.dir=${sdk.replaceAll('\\', '\\\\')}\n`);
run('npx', ['cap', 'sync', 'android']);
const variant = channel.name + (buildType === 'release' ? 'Release' : 'Debug');
run('./gradlew', [`assemble${variant[0].toUpperCase()}${variant.slice(1)}`, '--console=plain'], resolve(root, 'android'));
const apk = resolve(root, `android/app/build/outputs/apk/${channel.name}/${buildType}/app-${channel.name}-${buildType}.apk`);
const output = resolve(root, `artifacts/android/${channel.name}/SoundSense-${manifest.version}-${channel.name}${buildType === 'debug' ? '-debug' : ''}.apk`);
mkdirSync(resolve(root, `artifacts/android/${channel.name}`), { recursive: true });
copyFileSync(apk, output);
console.log(`APK: ${output}`);
if (command === 'run') run('npx', ['cap', 'run', 'android', '--flavor', channel.name, '--no-sync']);
