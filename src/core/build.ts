export type ReleaseChannel = 'stable' | 'beta';
/** Channel the installed APK was published to; used until the user picks one in Settings. */
export const BUILD_CHANNEL: ReleaseChannel = __APP_CHANNEL__;
export const CHANNEL_STORAGE_KEY = 'ss_release_channel';
function readChannel(): ReleaseChannel {
  try { const value = globalThis.localStorage?.getItem(CHANNEL_STORAGE_KEY); if (value === 'stable' || value === 'beta') return value; } catch { /* Storage may be unavailable. */ }
  return BUILD_CHANNEL;
}
/**
 * One package, two update channels. The choice lives in Settings and applies after a
 * reload: it decides the update manifest and whether the beta debug tools are loaded.
 */
export const APP_CHANNEL: ReleaseChannel = readChannel();
export const DEBUG_TOOLS = __DEBUG_TOOLS__ && APP_CHANNEL === 'beta';
/** Features still being tested: visible and active only in the beta channel. */
export const BETA_FEATURES = APP_CHANNEL === 'beta';
export function storeReleaseChannel(channel: ReleaseChannel): void {
  try { globalThis.localStorage?.setItem(CHANNEL_STORAGE_KEY, channel); } catch { /* Kept for this session only. */ }
}
