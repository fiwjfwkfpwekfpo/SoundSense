import type { CapacitorConfig } from '@capacitor/cli';
import channels from './config/channels.json';
const name = process.env.SS_CHANNEL ?? 'stable';
if (name !== 'stable' && name !== 'beta') throw new Error(`Unknown release channel: ${name}`);
const channel = channels[name];
const config: CapacitorConfig = {
  appId: channel.appId, appName: channel.appName, webDir: `dist/${name}`,
  // Capacitor logs every bridge call with its full payload on the Android UI thread;
  // multi-megabyte state writes made that log call freeze input for seconds (ANR).
  loggingBehavior: 'none',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: channel.debugTools },
};
export default config;
