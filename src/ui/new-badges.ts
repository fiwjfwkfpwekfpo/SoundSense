/**
 * "New" badges, counted on this device: the first time Settings shows an item, the moment
 * is stored, and the item is marked new for three days from then. On the very first run
 * (or the first run of this logic) everything already present counts as old, so a fresh
 * install is not covered in badges. An item that appears later (an update, or switching
 * to the beta channel) is new to this device, whatever version introduced it.
 */
const KEY = 'ss_features_seen_v1', DAYS = 3;
let seen: Record<string, number> | null = null;
try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (saved && typeof saved === 'object') seen = saved; } catch { /* Fresh. */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch { /* Session only. */ } };
/** Records the items shown now; call before rendering them. */
export function noteFeatures(keys: readonly string[]): void {
  if (!seen) { seen = Object.fromEntries(keys.map(key => [key, 0])); save(); return; }
  let changed = false;
  for (const key of keys) if (!(key in seen)) { seen[key] = Date.now(); changed = true; }
  if (changed) save();
}
export function isNew(key: string): boolean {
  const at = seen?.[key];
  return !!at && Date.now() - at < DAYS * 24 * 60 * 60_000;
}
