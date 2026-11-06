import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PlaybackPowerApi, PlaybackPowerState } from '../core/api';
interface NativePower { getStatus(): Promise<PlaybackPowerState>; request(): Promise<void>; addListener(event: 'change', listener: (value: PlaybackPowerState) => void): Promise<{ remove(): Promise<void> }> }
const native = registerPlugin<NativePower>('PlaybackPower');
export function createPlaybackPower(): PlaybackPowerApi | undefined {
  if (!Capacitor.isNativePlatform()) return;
  return { getStatus: () => native.getStatus(), request: () => native.request(), subscribe(listener) { const handle = native.addListener('change', listener); return () => { void handle.then(value => value.remove()); }; } };
}
