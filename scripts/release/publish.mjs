#!/usr/bin/env node
/**
 * Release: checks → APK → signed manifest → `releases` branch of the GitHub repository → (the Telegram bot announces it).
 *
 *   node scripts/release/publish.mjs [--channel=stable|beta] [--skip-tests] [--skip-build]
 *                                    [--full-tests] [--telegram] [--dry-run]
 *
 * The app looks at `<channel>.json` in the `releases` branch. If its versionCode is higher than the
 * installed one, the app downloads the APK listed there (size, SHA-256 and the Ed25519 signature
 * are checked on the device). The branch holds only the latest files of both channels and is
 * replaced by one commit on every release, so the repository does not grow with every APK.
 *
 * Version comes from package.json, release notes from src/core/release-notes.json.
 * Secrets (Telegram token, APK key) stay outside Git: .release/config.json and the local keystore.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, copyFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { channelVersionCode, releaseChannel } from '../lib/channels.mjs';
import { verifyApk } from './verify-apk.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const channel = releaseChannel([...args].find(arg => arg.startsWith('--channel='))?.slice('--channel='.length) ?? process.env.SS_CHANNEL ?? 'stable');
if (args.has('--help')) {
  console.log('Usage: npm run release:stable|release:beta -- [--dry-run] [--skip-tests] [--skip-build] [--full-tests] [--telegram]');
  console.log('--dry-run builds, verifies and signs locally without pushing to the releases branch or posting to Telegram.');
  process.exit(0);
}
const REPO = 'fiwjfwkfpwekfpo/SoundSense', BRANCH = 'releases';
const TOKEN_FILE = join(root, '.release/github-token');
// With a token file (fine-grained, Contents: read and write) the branch is pushed over HTTPS; otherwise over SSH.
const REMOTE = process.env.SS_RELEASES_REMOTE ?? (existsSync(TOKEN_FILE) ? `https://github.com/${REPO}.git` : `git@github.com:${REPO}.git`);
const ORIGIN = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const CONFIG = join(root, '.release/config.json'), BUILDS = join(root, `artifacts/android/${channel.name}`);
const EXPECTED_CERT = process.env.SS_APK_CERT_SHA256 ?? '8a837ef4482d01e8367f82ed74d6b50de24743bd0ce5fb23385062231fe00c4e';

const step = title => console.log(`\n▶ ${title}`);
const fail = message => { console.error(`\n✖ ${message}`); process.exit(1); };
function run(cmd, list, options = {}) {
  const result = spawnSync(cmd, list, { cwd: options.cwd ?? root, stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', env: { ...process.env, ...options.env } });
  if (result.status !== 0 && !options.soft) fail(`${cmd} ${list.join(' ')} failed${options.capture ? `\n${result.stderr || result.stdout}` : ''}`);
  return options.soft ? result : result.stdout ?? '';
}

const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
const via = config.proxy ? ['-x', config.proxy] : [];
const gitAuth = existsSync(TOKEN_FILE) ? ['-c', `http.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${readFileSync(TOKEN_FILE, 'utf8').trim()}`).toString('base64')}`, ...(config.proxy ? ['-c', `http.proxy=${config.proxy}`] : [])] : [];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const notes = JSON.parse(readFileSync(join(root, 'src/core/release-notes.json'), 'utf8'));
const { version } = pkg, versionCode = channelVersionCode(pkg.versionCode, channel.name);
if (notes.version !== version) fail(`release-notes.json is for ${notes.version}, package.json is ${version}`);
const filename = `SoundSense-${version}-${channel.name}.apk`;
const jdk = process.env.JAVA_HOME || resolve(root, '.toolchain/jdk-21');
const apk = join(BUILDS, filename);
console.log(`SoundSense ${version} ${channel.name} (${versionCode})${dry ? ' — dry run' : ''}`);

if (!args.has('--skip-tests')) {
  step('Checks');
  run('npm', ['run', 'check']); run('npm', ['run', 'lint']); run('npm', ['test']);
  if (args.has('--full-tests')) { run('npm', ['run', 'test:ui']); run('npm', ['run', 'test:channels']); }
}
if (!args.has('--skip-build')) { step('Build APK'); run('npm', ['run', `android:apk:${channel.name}`]); }
if (!existsSync(apk)) fail('APK not found');

step('Verify APK');
const { tools } = verifyApk(apk, channel.name, version, versionCode);
const certs = run(join(tools, 'apksigner'), ['verify', '--print-certs', apk], { capture: true, env: { PATH: `${jdk}/bin:${process.env.PATH}` } });
if (!certs.includes(EXPECTED_CERT)) fail('APK is signed with a different certificate — Android would refuse the update. Use the original signing key.');
const sha = createHash('sha256').update(readFileSync(apk)).digest('hex'), size = statSync(apk).size;
console.log(`${filename}: ${size} bytes, sha256 ${sha}`);

step('Sign manifest');
const signed = join(BUILDS, `${channel.name}-${version}.json`);
run('node', ['scripts/release/sign-manifest.mjs', apk, signed, version, String(versionCode), ORIGIN], { env: { SS_CHANNEL: channel.name } });

if (!dry) {
  step(`Publish to the ${BRANCH} branch`);
  const work = mkdtempSync(join(tmpdir(), 'ss-releases-'));
  try {
    run('git', ['init', '-q', '-b', BRANCH], { cwd: work });
    run('git', ['remote', 'add', 'origin', REMOTE], { cwd: work });
    // Keep the other channel's files from the previous release commit.
    const fetched = run('git', [...gitAuth, 'fetch', '-q', '--depth=1', 'origin', BRANCH], { cwd: work, soft: true, capture: true });
    if (fetched.status === 0) {
      run('git', ['checkout', '-q', 'FETCH_HEAD', '--', '.'], { cwd: work });
      const old = readdirSync(work).filter(name => name.endsWith(`-${channel.name}.apk`));
      for (const name of old) { if (name === filename && createHash('sha256').update(readFileSync(join(work, name))).digest('hex') !== sha) fail(`${filename} is already published with other content. Raise version/versionCode.`); rmSync(join(work, name)); }
    }
    copyFileSync(apk, join(work, filename)); copyFileSync(signed, join(work, `${channel.name}.json`));
    writeFileSync(join(work, 'README.md'), `# SoundSense releases\n\nThis branch is updated automatically by the release script and is read by the app. It holds the latest signed \`stable.json\` / \`beta.json\` and the matching APK files. Do not edit by hand.\n\nSource code: the \`main\` branch.\n`);
    run('git', ['add', '-A'], { cwd: work });
    run('git', ['-c', 'user.name=SoundSense Releases', '-c', 'user.email=releases@users.noreply.github.com', 'commit', '-q', '-m', `SoundSense ${version} ${channel.name}`], { cwd: work });
    run('git', [...gitAuth, 'push', '-f', 'origin', `${BRANCH}:${BRANCH}`], { cwd: work });
  } finally { rmSync(work, { recursive: true, force: true }); }
  const live = JSON.parse(run('curl', ['-fsSL', '--connect-timeout', '20', ...via, `${ORIGIN}/${channel.name}.json?ts=${Date.now()}`], { capture: true }));
  const payload = JSON.parse(Buffer.from(live.payload, 'base64').toString('utf8'));
  if (payload.versionCode !== versionCode || payload.channel !== channel.name) console.log('Note: raw.githubusercontent.com may serve the previous file for a few minutes (CDN cache).');
  else console.log('Branch: OK');
}

// Announcements are posted by the channel bot (tools/telegram), which watches the releases branch. This step only attaches the APK on request.
if (args.has('--telegram')) {
  step('Post to Telegram');
  const { token, chat } = config.telegram?.[channel.name] ?? config.telegram ?? {};
  if (!token) console.log(`Skipped: no token in ${CONFIG}`);
  else if (!dry) {
    const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
    const lines = notes.channel ?? { ru: notes.ru, en: notes.en };
    const quote = list => `<blockquote expandable>${list.map(line => `– ${escape(line)}`).join('\n')}</blockquote>`;
    const caption = [
      `<b>🎧 SoundSense ${escape(version)}${channel.name === 'beta' ? ' beta' : ''}</b>`,
      ...(channel.name === 'beta' ? ['', '⚠️ Бета-версия: возможны ошибки.'] : []),
      '', '🔄 Обновление приходит в самом приложении — скачивать вручную не обязательно.',
      '', '🇷🇺 RU:', quote(lines.ru), '', '🇺🇸 EN:', quote(lines.en),
    ].join('\n');
    const visible = caption.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot);/g, 'x').length;
    if (visible > 1024) fail(`Telegram caption is ${visible} characters (limit 1024): shorten "channel" notes in release-notes.json`);
    mkdirSync(BUILDS, { recursive: true });
    const captionFile = join(BUILDS, 'telegram-caption.html'); writeFileSync(captionFile, caption);
    const answer = JSON.parse(run('curl', ['-sS', '--connect-timeout', '20', '-m', '600', ...via, '-F', `chat_id=${chat}`, '-F', 'parse_mode=HTML', '-F', `caption=<${captionFile}`, '-F', `document=@${apk};type=application/vnd.android.package-archive;filename=${filename}`, `https://api.telegram.org/bot${token}/sendDocument`], { capture: true }) || '{}');
    if (!answer.ok) fail(`Telegram: ${answer.description ?? 'no answer'}`);
    console.log('Telegram: posted');
  }
}
console.log(`\n✔ SoundSense ${version} ${channel.name} ${dry ? 'prepared (dry run)' : 'released'}`);
