import { Capacitor, registerPlugin } from '@capacitor/core';
import type { OfflinePort, OfflineState } from '../core/offline';
import { desktop } from './desktop';
interface NativeCache extends Omit<OfflinePort, 'subscribe'> {
  source(options: { id: string }): Promise<{ available: boolean }>;
  setPreferred(options: { ids: readonly string[] }): Promise<void>;
  addListener(event: 'change', listener: (value: OfflineState) => void): Promise<{ remove(): Promise<void> }>;
}
const cache = registerPlugin<NativeCache>('MusicCache');
export function createOfflinePort(): OfflinePort | undefined {
  const local = desktop?.cache;
  if (local) return { getSnapshot: () => local.snapshot(), configure: value => local.configure(value), download: value => local.download(value), remove: value => local.remove(value), clear: () => local.clear(), setPreferred: value => local.setPreferred(value.ids), subscribe: listener => local.onChange(listener) };
  if (!Capacitor.isNativePlatform()) return;
  return { getSnapshot: () => cache.getSnapshot(), configure: value => cache.configure(value), download: value => cache.download(value), remove: value => cache.remove(value), clear: () => cache.clear(), setPreferred: value => cache.setPreferred(value),
    subscribe(listener) { const handle = cache.addListener('change', listener); return () => { void handle.then(value => value.remove()); }; } };
}
export async function offlineSource(id: string): Promise<string | undefined> {
  if (desktop?.cache) { const found = await desktop.cache.source(id).catch(() => undefined); return found?.available ? found.uri : undefined; }
  if (!Capacitor.isNativePlatform()) return;
  return (await cache.source({ id })).available ? `soundsense-cache://${id}` : undefined;
}
