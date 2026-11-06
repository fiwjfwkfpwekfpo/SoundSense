import manifest from '../../package.json';
import { BUILD_CHANNEL } from './build';
export const APP_VERSION = manifest.version;
/**
 * The code the update manifests of this build's channel are compared with: base·10, stable +5
 * (the same rule as the Android versionCode, see scripts/lib/channels.mjs). Without it a desktop
 * build would compare the plain base number with the manifest and always see an "update".
 */
export const APP_VERSION_CODE = manifest.versionCode * 10 + (BUILD_CHANNEL === 'stable' ? 5 : 0);
