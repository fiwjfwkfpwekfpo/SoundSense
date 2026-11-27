// The only bridge between the window and the desktop process. Sandboxed preloads must be CommonJS.
// The shape is mirrored by DesktopBridge in src/platform/desktop.ts.
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
let flushHandler = null;
ipcRenderer.on('window:flush', async () => {
  try { await flushHandler?.(); } catch { /* Close anyway. */ }
  ipcRenderer.send('window:flushed');
});
contextBridge.exposeInMainWorld('soundsenseDesktop', {
  platform: process.platform,
  hostname: ipcRenderer.sendSync('app:hostname'),
  state: { read: () => call('state:read'), write: (key, value) => call('state:write', key, value), remove: key => call('state:remove', key) },
  http: { request: (id, options) => call('http:request', id, options), cancel: id => call('http:cancel', id) },
  secrets: { read: name => call('secrets:read', name), write: (name, value) => call('secrets:write', name, value), remove: name => call('secrets:remove', name), encrypted: () => call('secrets:encrypted') },
  accounts: { open: url => call('accounts:open', url) },
  files: { pickAudio: kind => call('files:pickAudio', kind), readAudioMetadata: file => call('files:readAudioMetadata', file), saveJson: (filename, text) => call('files:saveJson', filename, text) },
  clipboard: { read: () => call('clipboard:read') },
  waves: {
    read: options => call('waves:read', options), readStream: options => call('waves:readStream', options),
    register: (id, uri, headers, provider) => call('waves:register', id, uri, headers, provider), cancel: key => call('waves:cancel', key),
    stats: () => call('waves:stats'), clear: () => call('waves:clear'), setLimit: bytes => call('waves:limit', bytes),
    onProgress(listener) { const handler = (_event, value) => listener(value); ipcRenderer.on('waves:progress', handler); return () => ipcRenderer.removeListener('waves:progress', handler); },
  },
  cache: {
    snapshot: () => call('cache:snapshot'), configure: options => call('cache:configure', options), download: options => call('cache:download', options),
    remove: options => call('cache:remove', options), clear: () => call('cache:clear'), setPreferred: ids => call('cache:preferred', ids), source: id => call('cache:source', id),
    onChange(listener) { const handler = (_event, value) => listener(value); ipcRenderer.on('cache:change', handler); return () => ipcRenderer.removeListener('cache:change', handler); },
  },
  updates: {
    /** True only when running from an AppImage that can replace itself. */
    available: ipcRenderer.sendSync('updates:available') === true,
    download: (id, artifact) => call('updates:download', id, artifact), cancel: id => call('updates:cancel', id), install: token => call('updates:install', token),
    onProgress(listener) { const handler = (_event, value) => listener(value); ipcRenderer.on('updates:progress', handler); return () => ipcRenderer.removeListener('updates:progress', handler); },
  },
  window: {
    minimize: () => ipcRenderer.send('window:control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('window:control', 'maximize'),
    close: () => ipcRenderer.send('window:control', 'close'),
    maximized: () => ipcRenderer.sendSync('window:maximized') === true,
    onMaximized(listener) { const handler = (_event, value) => listener(value === true); ipcRenderer.on('window:maximized', handler); return () => ipcRenderer.removeListener('window:maximized', handler); },
  },
  onFlush(handler) { flushHandler = typeof handler === 'function' ? handler : null; },
});
