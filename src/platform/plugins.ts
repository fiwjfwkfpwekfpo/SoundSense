import workerUrl from '../core/plugins/worker.ts?worker&url';
import type { PluginWorker } from '../core/plugins/host';
import type { HostMessage, WorkerMessage } from '../core/plugins/types';

/**
 * Scripts may come only from the app itself or blob: URLs. A worker created from a blob URL
 * inherits this policy, so plugin code cannot import code from the internet. Added once, when
 * the first plugin starts, so the rest of the app is not affected while no plugin is enabled.
 */
function ensurePolicy() {
  if (document.querySelector('meta[data-plugin-policy]')) return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:";
  meta.dataset.pluginPolicy = '';
  document.head.prepend(meta);
}
/** Each plugin gets its own module Worker: same code on Android (WebView) and desktop (Electron). */
export function spawnPluginWorker(): PluginWorker {
  ensurePolicy();
  const boot = URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL(workerUrl, location.href).href)};`], { type: 'text/javascript' }));
  const worker = new Worker(boot, { type: 'module', name: 'soundsense-plugin' });
  setTimeout(() => URL.revokeObjectURL(boot), 60_000);
  return {
    post: (message: HostMessage) => worker.postMessage(message),
    onMessage: listener => worker.addEventListener('message', event => listener(event.data as WorkerMessage)),
    onError: listener => { worker.addEventListener('error', event => { event.preventDefault(); listener(event.message || 'Worker failed to load'); }); worker.addEventListener('messageerror', () => listener('Unreadable message')); },
    terminate: () => worker.terminate(),
  };
}
