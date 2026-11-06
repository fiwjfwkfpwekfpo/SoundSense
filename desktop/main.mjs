import { app, BrowserWindow, clipboard, ipcMain, protocol, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, normalize, relative, isAbsolute, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPaths } from './paths.mjs';
import { createStateStore } from './state.mjs';
import { createSecrets } from './secrets.mjs';
import { createHttp } from './http.mjs';
import { createFiles } from './files.mjs';
import { mediaHandler } from './media.mjs';
import { createWaveforms } from './waveform.mjs';
import { integrate, unintegrate } from './integration.mjs';
import { linkCaches } from './caches.mjs';
/*
 * SoundSense desktop (Electron). The window runs the same Svelte app as Android; this process
 * only provides what a browser page cannot do itself: files on disk, network without CORS,
 * the keyring, the system dialogs. Everything is exposed through desktop/preload.cjs.
 */
const here = dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.SS_DEV_URL;                      // set by `npm run desktop` (Vite dev server)
const WEB_ROOT = process.env.SS_WEB_ROOT ?? join(here, 'web');   // the packaged app keeps the web build next to main.mjs
const ICON = [join(here, 'icon.png'), join(here, '..', 'assets', 'branding', 'SoundSense.png')].find(path => existsSync(path));
const ORIGIN = 'app://soundsense';
const log = process.env.SS_DESKTOP_LOG ? (...args) => console.log('[desktop]', ...args) : () => {};

// Folders must be set before anything touches userData (SPEC §15). Chromium storage
// (localStorage, IndexedDB) is app data. Electron ignores --disk-cache-dir and the 'cache' path, so on Linux
// Chromium's cache folders inside data/chromium are links into the cache folder (desktop/caches.mjs).
const paths = appPaths();
app.setName('SoundSense');
app.setPath('userData', join(paths.data, 'chromium'));
app.setPath('sessionData', join(paths.data, 'chromium'));
app.setPath('crashDumps', join(paths.cache, 'crashes'));
app.setAppLogsPath(join(paths.data, 'logs'));
if (process.platform === 'linux') { try { linkCaches(join(paths.data, 'chromium'), join(paths.cache, 'chromium')); } catch (error) { log('cache folders stay in the data folder', error); } }
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
// Some CDNs reject unknown clients; the window identifies as plain Chromium.
app.userAgentFallback = app.userAgentFallback.replace(/\s(SoundSense|soundsense|Electron)\/\S+/g, '');
if (process.platform === 'linux') app.setDesktopName('soundsense.desktop');

// Menu entry and icons for the AppImage (desktop/integration.mjs). Flags: `--integrate` forces it
// and exits, `--remove-integration` removes what it wrote and exits; SS_NO_INTEGRATION=1 turns the automatic step off.
const iconsFolder = join(here, 'icons');
if (process.platform === 'linux') {
  const flags = process.argv.slice(1);
  if (flags.includes('--remove-integration')) { const { removed } = unintegrate(); console.log(removed.length ? `Removed:\n${removed.join('\n')}` : 'Nothing to remove.'); process.exit(0); }
  if (flags.includes('--integrate')) {
    const { changed, skipped } = integrate({ appImage: process.env.APPIMAGE, iconsFolder, version: app.getVersion(), force: true });
    console.log(skipped === 'not-appimage' ? 'Run this from the AppImage file.' : skipped ? `Skipped: ${skipped}` : changed.length ? `Written:\n${changed.join('\n')}` : 'Already up to date.');
    process.exit(0);
  }
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (process.platform === 'linux' && process.env.APPIMAGE && !process.env.SS_NO_INTEGRATION) {
  try { const result = integrate({ appImage: process.env.APPIMAGE, iconsFolder, version: app.getVersion() }); log('integration', result); } catch (error) { log('integration failed', error); }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  { scheme: 'ss-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

const state = createStateStore(paths), secrets = createSecrets(paths), http = createHttp();
let window;
const files = createFiles(paths, () => window);
const waves = createWaveforms(paths, value => window?.webContents.send('waves:progress', value));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

/** app://soundsense/… serves the built web app; unknown paths fall back to index.html. */
async function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== 'soundsense') return new Response('Not found', { status: 404 });
  let path = normalize(join(WEB_ROOT, decodeURIComponent(url.pathname)));
  const rel = relative(WEB_ROOT, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
  if (!extname(path)) path = join(WEB_ROOT, 'index.html');
  try {
    const body = await readFile(path);
    return new Response(body, { headers: { 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' } });
  } catch { return new Response('Not found', { status: 404 }); }
}

// Node's URL reports origin "null" for custom schemes, so the app origin is compared by parts.
const ownPage = input => { try { const url = new URL(input); return url.protocol === 'app:' && url.host === 'soundsense' || !!DEV_URL && url.origin === new URL(DEV_URL).origin; } catch { return false; } };
const trusted = frame => ownPage(frame?.url ?? '');
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => { if (!trusted(event.senderFrame)) throw new Error('Untrusted sender'); return fn(...args); });
}
const AUTH_HOSTS = new Set(['oauth.yandex.ru', 'oauth.yandex.com']);
function authorizationPage(input) {
  const url = new URL(input);
  const allowed = AUTH_HOSTS.has(url.hostname) || url.hostname === 'ya.ru' && /^\/device\/?$/.test(url.pathname);
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port && url.port !== '443') throw new Error('Invalid authorization page');
  return url.href;
}

function registerIpc() {
  handle('state:read', () => state.read());
  handle('state:write', (key, value) => state.write(key, value));
  handle('state:remove', key => state.remove(key));
  handle('http:request', (id, options) => http.request(id, options));
  handle('http:cancel', id => http.cancel(id));
  handle('secrets:read', async name => ({ value: await secrets.read(name) }));
  handle('secrets:write', async (name, value) => { await secrets.write(name, value); return {}; });
  handle('secrets:encrypted', () => secrets.encrypted());
  handle('secrets:remove', name => secrets.remove(name));
  handle('accounts:open', url => shell.openExternal(authorizationPage(url)));
  handle('files:pickAudio', kind => files.pickAudio(kind === 'folder' ? 'folder' : 'files'));
  handle('files:readAudioMetadata', file => files.readAudioMetadata(file));
  handle('files:saveJson', (filename, text) => files.saveJson(String(filename), String(text)));
  handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('app:hostname', event => { event.returnValue = trusted(event.senderFrame) ? hostname().slice(0, 40) : ''; });
  handle('waves:read', options => waves.readWaveform(options ?? {}));
  handle('waves:readStream', options => waves.readStreamWaveform(options ?? {}));
  handle('waves:register', (id, uri, headers) => waves.registerStream(id, uri, headers));
  handle('waves:cancel', key => waves.cancel(key));
  handle('waves:stats', () => waves.stats());
  handle('waves:clear', () => waves.clear());
  handle('waves:limit', bytes => waves.setLimit(bytes));
  // The window asks to be closed for real after it has written pending state.
  ipcMain.on('window:flushed', event => { if (trusted(event.senderFrame)) void state.flush().finally(() => { log('state flushed, closing'); closing = true; window?.close(); }); });
}

let closing = false;
function createWindow() {
  window = new BrowserWindow({
    width: 460, height: 900, minWidth: 360, minHeight: 560,
    backgroundColor: '#101010', title: 'SoundSense', show: false, autoHideMenuBar: true,
    ...(ICON ? { icon: ICON } : {}),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      // Crossfades and track changes are driven by timers in the window; a hidden or
      // minimised window must keep them running at full rate.
      backgroundThrottling: false },
  });
  window.setMenu(null);
  window.once('ready-to-show', () => window.show());
  // Navigation stays inside the app; links to the web open in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!ownPage(url)) event.preventDefault(); });
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); log('close requested, flushing'); window.webContents.send('window:flush');
    setTimeout(() => { closing = true; window?.close(); }, 2500); // A frozen window must not keep the app open.
  });
  window.on('closed', () => { window = undefined; });
  void window.loadURL(DEV_URL ?? `${ORIGIN}/`);
}

function configureSession() {
  const web = session.defaultSession;
  web.setPermissionRequestHandler((_contents, permission, callback) => callback(['clipboard-sanitized-write', 'media', 'fullscreen'].includes(permission)));
  // Streams, covers and HLS segments are read by <audio>/<img>/XHR in the window. Native
  // clients do not send an Origin, and cover colours need readable (CORS) images, so the
  // window's origin is removed from requests and the responses are made readable to it.
  web.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }; delete headers.Origin; delete headers.Referer; callback({ requestHeaders: headers });
  });
  web.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, callback) => {
    const headers = Object.fromEntries(Object.entries(details.responseHeaders ?? {}).filter(([key]) => !/^access-control-allow-(origin|credentials)$/i.test(key)));
    headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });
  protocol.handle('app', serveApp);
  protocol.handle('ss-media', mediaHandler(paths));
}

app.on('second-instance', () => { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
app.on('window-all-closed', () => app.quit());
// Logout / `kill`: close the window the normal way, so pending state is written first.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { if (window) window.close(); else app.quit(); });
app.whenReady().then(async () => {
  await state.cleanup();
  configureSession(); registerIpc(); createWindow();
});
