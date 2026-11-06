import type { SettingsApi } from '../core/api';
import type { SettingsValues } from '../core/types';
import { STORAGE_KEYS } from '../core/storage';
export const SETTINGS_STORAGE_KEY = STORAGE_KEYS.settings;
export function createSettings(defaults: SettingsValues, storage?: Pick<Storage, 'getItem' | 'setItem'>): SettingsApi {
  let values = { ...defaults }; let persistent = !!storage;
  const listeners = new Set<(data: SettingsValues) => void>();
  try {
    const raw: unknown = JSON.parse(storage?.getItem(SETTINGS_STORAGE_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, fallback] of Object.entries(defaults)) {
        const value: unknown = (raw as Record<string, unknown>)[key];
        if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) values[key] = value as SettingsValues[string];
      }
    }
  } catch { persistent = false; /* Corrupt or inaccessible localStorage falls back to defaults. */ }
  function publish() {
    try { storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(values)); } catch { persistent = false; }
    for (const listener of listeners) listener(values);
  }
  return {
    getSnapshot: () => values,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(key, value) { values = { ...values, [key]: value }; publish(); },
    setMany(next) { values = { ...values, ...next }; publish(); },
    reset(keys) {
      if (keys) { values = { ...values }; for (const key of keys) if (key in defaults) values[key] = defaults[key]!; }
      else values = { ...defaults };
      publish();
    },
    isPersistent: () => persistent,
  };
}
