import { unzipSync, strFromU8 } from 'fflate';
import { PLUGIN_API_VERSION, PLUGIN_PERMISSIONS, PluginError } from './types';
import type { PluginManifest, PluginPackage, PluginPermission, PluginSettingDefinition } from './types';

const ID = /^[a-z][a-z\d]*(?:[.-][a-z\d]+){1,6}$/, VERSION = /^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i, KEY = /^[a-zA-Z][\w.-]{0,40}$/;
const HOST = /^(?:\*\.)?(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}$/;
export const PACKAGE_LIMIT = 2 * 1024 * 1024, CODE_LIMIT = 1024 * 1024;

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function fail(message: string): never { throw new PluginError('manifest', message); }

export function isNetworkPermission(value: string): value is `network:${string}` { return value.startsWith('network:') && HOST.test(value.slice(8)); }
/** Whether a granted network permission covers this URL (HTTPS only). */
export function networkAllowed(granted: readonly PluginPermission[], url: string): boolean {
  let parsed: URL; try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return granted.some(permission => {
    if (!permission.startsWith('network:')) return false;
    const rule = permission.slice(8);
    return rule.startsWith('*.') ? host === rule.slice(2) || host.endsWith(rule.slice(1)) : host === rule;
  });
}
const TABS = ['appearance', 'playback', 'sound', 'sources', 'sync', 'storage', 'app'];
function validSetting(value: unknown): PluginSettingDefinition {
  const item = value as Record<string, unknown>;
  if (item && typeof item === 'object' && item.tab !== undefined && !TABS.includes(String(item.tab))) fail(`Invalid settings tab ${String(item.tab)}`);
  const tab = item && typeof item === 'object' && item.tab !== undefined ? { tab: item.tab as PluginSettingDefinition['tab'] } : {};
  return { ...readSetting(item), ...tab } as PluginSettingDefinition;
}
function readSetting(item: Record<string, unknown>): PluginSettingDefinition {
  if (!item || typeof item !== 'object' || !KEY.test(String(item.key)) || !text(item.label, 80)) fail('Invalid setting');
  if (item.type === 'toggle' && typeof item.default === 'boolean') return { key: String(item.key), type: 'toggle', label: String(item.label), default: item.default };
  if (item.type === 'text' && typeof item.default === 'string' && item.default.length <= 500) return { key: String(item.key), type: 'text', label: String(item.label), default: item.default, secret: item.secret === true };
  if (item.type === 'select' && typeof item.default === 'string' && Array.isArray(item.options) && item.options.length > 0 && item.options.length <= 20) {
    const options = item.options.map(option => { const entry = option as Record<string, unknown>; if (!text(entry?.value, 60) || !text(entry?.label, 80)) fail('Invalid select option'); return { value: String(entry.value), label: String(entry.label) }; });
    if (!options.some(option => option.value === item.default)) fail('Select default is not an option');
    return { key: String(item.key), type: 'select', label: String(item.label), default: item.default, options };
  }
  fail(`Invalid setting ${String(item.key)}`);
}
export function validateManifest(value: unknown): PluginManifest {
  const raw = value as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Manifest must be an object');
  if (!ID.test(String(raw.id)) || String(raw.id).length > 80) fail('Invalid id (example: dev.author.name)');
  if (!text(raw.name, 60)) fail('Invalid name');
  if (!VERSION.test(String(raw.version))) fail('Invalid version (example: 1.0.0)');
  const api = String(raw.apiVersion ?? '');
  if (api.split('.')[0] !== PLUGIN_API_VERSION.split('.')[0]) fail(`Unsupported apiVersion ${api || '—'} (this app supports ${PLUGIN_API_VERSION})`);
  if (Number(api.split('.')[1] ?? 0) > Number(PLUGIN_API_VERSION.split('.')[1])) fail(`Plugin needs API ${api}, this app supports ${PLUGIN_API_VERSION}`);
  const entry = raw.entry === undefined ? 'main.js' : raw.entry;
  if (typeof entry !== 'string' || !/^[\w-]+(?:\/[\w-]+)*\.js$/.test(entry)) fail('Invalid entry');
  if (!Array.isArray(raw.permissions) || raw.permissions.length > 30) fail('permissions must be a list');
  const permissions = [...new Set(raw.permissions.map(String))];
  for (const permission of permissions) if (!(PLUGIN_PERMISSIONS as readonly string[]).includes(permission) && !isNetworkPermission(permission)) fail(`Unknown permission ${permission}`);
  const settings = raw.settings === undefined ? undefined : Array.isArray(raw.settings) && raw.settings.length <= 30 ? raw.settings.map(validSetting) : fail('settings must be a list');
  if (settings && new Set(settings.map(item => item.key)).size !== settings.length) fail('Duplicate setting key');
  return {
    id: String(raw.id), name: String(raw.name).trim(), version: String(raw.version), apiVersion: api, entry,
    ...(text(raw.author, 80) ? { author: String(raw.author).trim() } : {}), ...(text(raw.description, 400) ? { description: String(raw.description).trim() } : {}),
    permissions: permissions as PluginPermission[], ...(settings ? { settings } : {}),
  };
}
/** Reads a .ssplugin archive: manifest.json, the entry module, optional icon.svg and i18n/<lang>.json. */
export function readPackage(bytes: Uint8Array): PluginPackage {
  if (bytes.length > PACKAGE_LIMIT) throw new PluginError('package', 'Package is larger than 2 MB');
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: file => file.originalSize <= CODE_LIMIT && !file.name.includes('..') }); } catch { throw new PluginError('package', 'Not a .ssplugin (zip) file'); }
  // Archives made from a folder may put everything under one top-level directory.
  const names = Object.keys(files), prefix = names.includes('manifest.json') ? '' : names.find(name => name.endsWith('/manifest.json') && name.split('/').length === 2)?.replace('manifest.json', '') ?? '';
  const read = (name: string) => files[prefix + name];
  const manifestFile = read('manifest.json'); if (!manifestFile) throw new PluginError('package', 'manifest.json is missing');
  let json: unknown; try { json = JSON.parse(strFromU8(manifestFile)); } catch { throw new PluginError('manifest', 'manifest.json is not valid JSON'); }
  const manifest = validateManifest(json);
  const code = read(manifest.entry); if (!code) throw new PluginError('package', `${manifest.entry} is missing`);
  const i18n: Record<string, Record<string, string>> = {};
  for (const language of ['ru', 'en']) {
    const file = read(`i18n/${language}.json`); if (!file) continue;
    try { const values = JSON.parse(strFromU8(file)); if (values && typeof values === 'object') i18n[language] = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string').slice(0, 500)) as Record<string, string>; } catch { /* Translations are optional. */ }
  }
  const icon = read('icon.svg'), iconText = icon && icon.length <= 64 * 1024 ? strFromU8(icon) : undefined;
  return { manifest, code: strFromU8(code), ...(iconText && /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/.test(iconText) && !/<script|on\w+=|href\s*=\s*["']\s*(?:javascript|http)/i.test(iconText) ? { icon: iconText } : {}), ...(Object.keys(i18n).length ? { i18n } : {}) };
}

const SCREEN_NODES = 400, SCREEN_DEPTH = 5;
/** Checks and copies a plugin screen: known node types only, bounded size, plain strings. */
export function validateScreen(value: unknown): import('./types').PluginScreen {
  const screen = value as { title?: unknown; content?: unknown };
  if (!screen || typeof screen !== 'object' || !text(screen.title, 60) || !Array.isArray(screen.content)) throw new PluginError('api', 'Screen needs a title and content');
  let count = 0;
  const string = (input: unknown, max: number, name: string) => { if (typeof input !== 'string' || input.length > max) throw new PluginError('api', `Invalid ${name}`); return input; };
  const optional = (input: unknown, max: number, name: string) => input === undefined ? undefined : string(input, max, name);
  const action = (input: unknown) => { const id = string(input, 60, 'action'); if (!id) throw new PluginError('api', 'Empty action'); return id; };
  const nodes = (list: unknown, depth: number): import('./types').PluginNode[] => {
    if (!Array.isArray(list)) throw new PluginError('api', 'children must be a list');
    if (depth > SCREEN_DEPTH) throw new PluginError('limit', 'Screen is nested too deeply');
    return list.map(raw => {
      if (++count > SCREEN_NODES) throw new PluginError('limit', `Screen has more than ${SCREEN_NODES} elements`);
      const node = raw as Record<string, unknown>;
      switch (node?.type) {
        case 'section': return { type: 'section', ...(node.title === undefined ? {} : { title: string(node.title, 80, 'title') }), children: nodes(node.children, depth + 1) };
        case 'text': return { type: 'text', text: string(node.text, 2000, 'text'), ...(node.muted ? { muted: true } : {}) };
        case 'row': { const subtitle = optional(node.subtitle, 200, 'subtitle'); return { type: 'row', title: string(node.title, 120, 'title'), ...(subtitle === undefined ? {} : { subtitle }), ...(node.action === undefined ? {} : { action: action(node.action) }) }; }
        case 'button': return { type: 'button', title: string(node.title, 60, 'title'), action: action(node.action), variant: node.variant === 'secondary' ? 'secondary' : 'primary' };
        case 'toggle': return { type: 'toggle', label: string(node.label, 120, 'label'), value: node.value === true, action: action(node.action) };
        case 'input': { const placeholder = optional(node.placeholder, 80, 'placeholder'); return { type: 'input', label: string(node.label, 120, 'label'), value: string(node.value ?? '', 500, 'value'), action: action(node.action), ...(placeholder === undefined ? {} : { placeholder }) }; }
        case 'empty': return { type: 'empty', text: string(node.text, 200, 'text') };
        default: throw new PluginError('api', `Unknown element ${String(node?.type)}`);
      }
    });
  };
  return { title: String(screen.title).trim(), content: nodes(screen.content, 1) };
}
