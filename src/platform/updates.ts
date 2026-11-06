import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { UpdateArtifact, UpdateInstaller } from '../core/updates';
import { desktop } from './desktop';

interface NativeUpdates {
  download(options: UpdateArtifact & { id: string; versionCode: number }): Promise<{ token: string }>;
  cancel(options: { id: string }): Promise<void>;
  install(options: { token: string }): Promise<{ status: 'opened' | 'permission' }>;
  addListener(event: 'progress', listener: (value: { id: string; bytes: number }) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<NativeUpdates>('Updates');
export function createUpdateInstaller(): UpdateInstaller | undefined {
  if (desktop) return desktop.updates?.available ? desktopInstaller(desktop.updates) : undefined;
  if (Capacitor.getPlatform() !== 'android') return undefined;
  return {
    async download(artifact, progress, signal, versionCode) {
      signal.throwIfAborted();
      const id = crypto.randomUUID(), handle = await native.addListener('progress', value => { if (value.id === id && !signal.aborted) progress(value.bytes); });
      const cancel = () => { void native.cancel({ id }); };
      signal.addEventListener('abort', cancel, { once: true });
      try { signal.throwIfAborted(); const result = await native.download({ ...artifact, id, versionCode }); signal.throwIfAborted(); return result.token; }
      finally { signal.removeEventListener('abort', cancel); await handle.remove(); }
    },
    async install(token) { return (await native.install({ token })).status; },
  };
}

/** The AppImage replaces itself: the process downloads and verifies, the window only shows progress. */
function desktopInstaller(updates: NonNullable<typeof desktop>['updates']): UpdateInstaller {
  return {
    async download(artifact, progress, signal) {
      signal.throwIfAborted();
      const id = crypto.randomUUID(), stop = updates.onProgress(value => { if (value.id === id && !signal.aborted) progress(value.bytes); });
      const cancel = () => { void updates.cancel(id); };
      signal.addEventListener('abort', cancel, { once: true });
      try { const token = await updates.download(id, artifact); signal.throwIfAborted(); return token; }
      finally { signal.removeEventListener('abort', cancel); stop(); }
    },
    install: token => updates.install(token),
  };
}
