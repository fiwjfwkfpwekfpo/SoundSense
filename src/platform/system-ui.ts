import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isDesktop } from './desktop';
import type { LocalAudioFile, LocalAudioMetadata, LocalFileSelection } from '../core/local';
export interface InsetsSnapshot {
  top: number; bottom: number; left: number; right: number;
  density: number; windowWidthPx: number; windowHeightPx: number;
  webViewWidthPx: number; webViewHeightPx: number;
}
/** Android window timings complement JS RAF intervals; neither is a presented-frame trace. */
export interface NativeFrameSample {
  supported: boolean; metric: string; frames: number; elapsedMs: number; cancelled: boolean;
  p95: number; max: number; intervalP95: number; intervalMax: number;
  overBudget: number; over50ms: number; droppedReports: number; refreshRate: number;
  gpuP95?: number; gpuMax?: number;
}
interface SystemUiPlugin {
  pickFolder(): Promise<{ files: readonly { name: string; uri: string }[] | null }>;
  pickAudio(options: { kind: 'files' | 'folder' }): Promise<LocalFileSelection | { files: null }>;
  readAudioMetadata(options: { file: LocalAudioFile }): Promise<LocalAudioMetadata>;
  readWaveform(options: { uri: string; duration: number; loudness?: boolean; rhythm?: boolean }): Promise<import('../core/types').Waveform>;
  cancelWaveform(options: { uri: string }): Promise<void>;
  readStreamWaveform(options: { id: string; duration: number; loudness?: boolean; rhythm?: boolean }): Promise<import('../core/types').Waveform>;
  getWaveCache(): Promise<{ bytes: number; count: number; limit: number }>;
  clearWaveCache(): Promise<void>;
  setWaveCacheLimit(options: { bytes: number }): Promise<void>;
  getPendingLink(): Promise<{ text?: string }>;
  tick(): Promise<void>;
  getInsets(): Promise<InsetsSnapshot>;
  setStyle(options: { light: boolean }): Promise<void>;
  sampleFrames(options: { duration: number }): Promise<NativeFrameSample>;
  setReleaseChannel(options: { channel: 'stable' | 'beta' }): Promise<{ channel: string }>;
  saveJson(options: { filename: string; text: string; purpose?: 'diagnostics' }): Promise<{ status: 'saved' | 'cancelled' }>;
  addListener(event: 'incomingLink', listener: (data: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'waveformProgress', listener: (data: { uri: string; samples: readonly number[]; progress: number; status: 'building' | 'ready' | 'deferred' }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'powerChanged', listener: (data: { deferred: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'insetsChanged', listener: (snapshot: InsetsSnapshot) => void): Promise<PluginListenerHandle>;
}
export const SystemUi = registerPlugin<SystemUiPlugin>('SystemUi');
export function configureViewport(native = Capacitor.isNativePlatform(), development = import.meta.env.DEV, desktop = isDesktop()): void {
  // The phone frame is only for the browser preview; the desktop window is the app itself.
  document.documentElement.dataset.runtime = native ? 'native' : desktop ? 'desktop' : 'web';
  document.documentElement.dataset.preview = development && !native && !desktop ? 'true' : 'false';
}
export async function bindNativeInsets(): Promise<() => void> {
  const apply = (snapshot: InsetsSnapshot) => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      document.documentElement.style.setProperty(`--inset-${edge}`, `${Math.max(0, snapshot[edge])}px`);
    }
  };
  const handle = await SystemUi.addListener('insetsChanged', apply);
  apply(await SystemUi.getInsets());
  return () => { void handle.remove(); };
}
