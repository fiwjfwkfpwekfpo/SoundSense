import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { UpdateArtifact, UpdateInstaller } from '../core/updates';

interface NativeUpdates {
  download(options: UpdateArtifact & { id: string; versionCode: number }): Promise<{ token: string }>;
  cancel(options: { id: string }): Promise<void>;
  install(options: { token: string }): Promise<{ status: 'opened' | 'permission' }>;
  addListener(event: 'progress', listener: (value: { id: string; bytes: number }) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<NativeUpdates>('Updates');
export function createUpdateInstaller(): UpdateInstaller | undefined {
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
