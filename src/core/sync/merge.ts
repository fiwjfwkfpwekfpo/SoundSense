/*
 * What wins when two devices meet. Every synced thing (a like, a playlist, a history entry,
 * a setting) carries the time it last changed on any device; the newer version wins item by
 * item. A removal leaves a dated tombstone so it spreads too. Same model as Muriel's sync
 * (github.com/cloverscripts/riff-muriel, MIT), written anew for SoundSense. Pure: no network.
 */
/** [changedAt, fingerprint] or [changedAt, '', 1] for a removal. */
export type Stamp = readonly [number, string] | readonly [number, string, 1];
export type Meta = Readonly<Record<string, Stamp>>;
export const isGone = (stamp: Stamp | undefined): boolean => !!stamp && stamp[2] === 1;

/** FNV-1a over JSON: a cheap, deterministic "did this change" fingerprint. */
export function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Notes what changed since the last look. On the first look (`previous` undefined) everything is
 * dated `base` (long ago): data that existed before linking never overrides a real edit elsewhere.
 * `base` may be a function, so existing items can keep a relative order (history).
 */
export function stamp(previous: Meta | undefined, values: ReadonlyMap<string, unknown>, now: number, base: number | ((key: string) => number) = 1): Record<string, Stamp> {
  const meta: Record<string, Stamp> = {}, first = !previous, old = previous ?? {};
  for (const [key, value] of values) {
    const print = fingerprint(value), known = old[key];
    meta[key] = known && !isGone(known) && known[1] === print ? known : [first ? typeof base === 'function' ? base(key) : base : now, print];
  }
  for (const [key, known] of Object.entries(old)) if (!values.has(key)) meta[key] = isGone(known) ? known : [now, '', 1];
  return meta;
}

/** Newer wins; on a tie the larger fingerprint, so both devices pick the same side. */
export function remoteWins(local: Stamp | undefined, remote: Stamp | undefined): boolean {
  if (!remote) return false;
  if (!local) return true;
  if (remote[0] !== local[0]) return remote[0] > local[0];
  return (remote[1] || '') > (local[1] || '');
}

/** Keys where this device holds the newer version (what to send after seeing the other side's meta). */
export function newerHere(local: Meta, remote: Meta): string[] {
  return Object.keys(local).filter(key => remoteWins(remote[key], local[key]));
}

/** Tombstones only have to outlive the time a device can stay away. */
export function prune(meta: Meta, now: number, maxAge: number): Record<string, Stamp> {
  const out: Record<string, Stamp> = {};
  for (const [key, value] of Object.entries(meta)) if (!isGone(value) || now - value[0] < maxAge) out[key] = value;
  return out;
}

/** A short summary of a whole collection: equal digests mean nothing to exchange. */
export function digest(meta: Meta): string {
  return fingerprint(Object.keys(meta).sort().map(key => `${key}=${meta[key]![0]}:${meta[key]![1]}:${meta[key]![2] ?? 0}`).join('|'));
}

/** Crockford-style pairing code: 8 characters without look-alikes (0/O, 1/I/L), shown as XXXX-XXXX. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function pairingCode(random: (count: number) => Uint8Array = count => crypto.getRandomValues(new Uint8Array(count))): string {
  return [...random(8)].map(value => ALPHABET[value % ALPHABET.length]).join('');
}
export function normalizeCode(input: string): string | null {
  const value = input.toUpperCase().replace(/[\s-]/g, '');
  return /^[2-9A-HJKMNP-Z]{8}$/.test(value) ? value : null;
}
export const showCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;
