import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = resolve(root, '.toolchain');
await mkdir(base, { recursive: true });
async function download(url, file, checksum) {
  console.log(`Downloading ${file.split('/').at(-1)}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error('SHA-256 mismatch');
  await writeFile(file, data);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.error ?? ''}`);
}
const jdk = resolve(base, 'jdk-21');
try { await readFile(resolve(jdk, 'release')); } catch {
  const response = await fetch('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=linux');
  if (!response.ok) throw new Error(`JDK metadata: ${response.status}`);
  const [asset] = await response.json();
  const archive = resolve(base, 'jdk.tar.gz');
  await download(asset.binary.package.link, archive, asset.binary.package.checksum);
  await mkdir(jdk, { recursive: true });
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', jdk]);
  await rm(archive);
}
const sdk = resolve(base, 'android-sdk');
const cli = resolve(sdk, 'cmdline-tools/latest/bin/sdkmanager');
try { await readFile(cli); } catch {
  const archive = resolve(base, 'commandline-tools.zip');
  await download('https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip', archive,
    '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583');
  const extract = resolve(base, 'extract');
  run('python3', ['-m', 'zipfile', '-e', archive, extract]);
  await mkdir(resolve(sdk, 'cmdline-tools'), { recursive: true });
  await rename(resolve(extract, 'cmdline-tools'), resolve(sdk, 'cmdline-tools/latest'));
  run('chmod', ['-R', 'u+x', resolve(sdk, 'cmdline-tools/latest/bin')]);
  await rm(extract, { recursive: true }); await rm(archive);
}
const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const licenses = spawnSync(cli, ['--sdk_root=' + sdk, '--licenses'], {
  env, input: 'y\n'.repeat(100), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
if (licenses.status !== 0) throw new Error(licenses.stderr || licenses.stdout);
run(cli, ['--sdk_root=' + sdk, 'platform-tools', 'platforms;android-36', 'build-tools;35.0.0'], { env });
console.log('Android SDK 36 and JDK 21 are ready in .toolchain/. No system settings were changed.');
