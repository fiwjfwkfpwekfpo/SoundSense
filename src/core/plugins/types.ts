/**
 * Plugin API v1: the contract between SoundSense and plugins.
 *
 * A plugin is a JavaScript module packed into a .ssplugin (zip) file with a manifest. It runs
 * in its own Worker, sees nothing of the app (no DOM, app storage, tokens or files) and talks
 * to the app only through messages, each checked against the permissions the user granted.
 * Nothing here is platform specific: the same package works on Android and the desktop.
 */
export const PLUGIN_API_VERSION = '1.1';

export const PLUGIN_PERMISSIONS = ['player.read', 'player.control', 'library.read', 'library.write', 'notify', 'ui.trackMenu', 'ui.playerButton', 'ui.screen', 'provider.lyrics'] as const;
/** Icons a plugin may use for its buttons (the app's own set). */
export const PLUGIN_ICONS = ['heart', 'bell', 'music', 'lyrics', 'queue', 'plus', 'download', 'artist', 'share', 'check', 'clock', 'sliders', 'search', 'library', 'volume', 'sun', 'moon', 'arrow-up-right'] as const;
export type FixedPermission = typeof PLUGIN_PERMISSIONS[number];
/** `network:<host>` (exact host) or `network:*.<domain>` (the domain and its subdomains). */
export type NetworkPermission = `network:${string}`;
export type PluginPermission = FixedPermission | NetworkPermission;

/** Settings tab a plugin setting is shown in (besides the plugin's own card). */
export type PluginSettingTab = 'appearance' | 'playback' | 'sound' | 'sources' | 'sync' | 'storage' | 'app';
export type PluginSettingDefinition = ({ tab?: PluginSettingTab }) & (
  | { key: string; type: 'toggle'; label: string; default: boolean }
  | { key: string; type: 'text'; label: string; default: string; secret?: boolean }
  | { key: string; type: 'select'; label: string; default: string; options: readonly { value: string; label: string }[] });

export interface PluginManifest {
  id: string; name: string; version: string; apiVersion: string;
  author?: string; description?: string; entry: string;
  permissions: readonly PluginPermission[];
  settings?: readonly PluginSettingDefinition[];
}
export interface PluginPackage { manifest: PluginManifest; code: string; icon?: string; i18n?: Readonly<Record<string, Readonly<Record<string, string>>>> }

export type PluginStatus = 'disabled' | 'starting' | 'running' | 'crashed';
export interface PluginRecord {
  manifest: PluginManifest;
  enabled: boolean;
  /** Permissions the user has allowed (a subset of the manifest's). */
  granted: readonly PluginPermission[];
  installedAt: number;
}
export interface PluginState extends PluginRecord { status: PluginStatus; error?: string }

/** Track data a plugin may see: no stream links, tokens or local file paths. */
export interface PluginTrack { id: string; title: string; artist: string; album?: string; duration: number; liked: boolean; source: string }

export type PluginEventName = 'track:change' | 'player:play' | 'player:pause' | 'player:seek' | 'library:like' | 'library:unlike';

/** Messages from the app to the plugin worker. */
export type HostMessage =
  | { type: 'load'; manifest: PluginManifest; code: string; locale: string; settings: Record<string, string | boolean> }
  | { type: 'event'; name: PluginEventName; data: unknown }
  | { type: 'settings'; settings: Record<string, string | boolean> }
  | { type: 'call'; id: number; method: 'lyrics.find' | 'menu.select' | 'ui.action'; args: readonly unknown[] }
  | { type: 'reply'; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: 'ping'; n: number }
  | { type: 'stop' };
/** Messages from the plugin worker to the app. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'request'; id: number; method: string; args: readonly unknown[] }
  | { type: 'reply'; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: 'pong'; n: number }
  | { type: 'error'; error: string }
  | { type: 'stopped' };

/**
 * A plugin screen is data, drawn by the app with its own components, style and colours.
 * Interactive nodes carry an `action` id; the app sends it back to the plugin with the value.
 */
export type PluginNode =
  | { type: 'section'; title?: string; children: readonly PluginNode[] }
  | { type: 'text'; text: string; muted?: boolean }
  | { type: 'row'; title: string; subtitle?: string; action?: string }
  | { type: 'button'; title: string; action: string; variant?: 'primary' | 'secondary' }
  | { type: 'toggle'; label: string; value: boolean; action: string }
  | { type: 'input'; label: string; value: string; action: string; placeholder?: string }
  | { type: 'empty'; text: string };
export interface PluginScreen { title: string; content: readonly PluginNode[] }

export class PluginError extends Error {
  constructor(readonly code: 'manifest' | 'package' | 'api' | 'duplicate' | 'permission' | 'timeout' | 'limit' | 'network' | 'crashed' | 'catalog', message: string) { super(message); this.name = 'PluginError'; }
}
