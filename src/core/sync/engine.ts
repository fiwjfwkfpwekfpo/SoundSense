import type { LibraryApi, SettingsApi } from '../api';
import type { Track, SettingValue } from '../types';
import { digest, fingerprint, isGone, newerHere, normalizeCode, pairingCode, prune, remoteWins, stamp } from './merge';
import type { Meta, Stamp } from './merge';
/*
 * Device-to-device sync (SPEC §9, "напрямую"). Devices of one group meet through a signalling
 * server and then talk directly (WebRTC data channel, see src/platform/sync-transport.ts).
 * A pairing code (8 characters, 5 minutes) hands the group key to a new device; every connection
 * then proves it knows the key (HMAC challenge) before anything else is accepted.
 * On connect the devices compare one digest per collection and exchange only what differs;
 * while connected every change is pushed at once. Each item is merged on its own (merge.ts).
 */
export type Collection = 'likes' | 'playlists' | 'history' | 'settings';
const COLLECTIONS: readonly Collection[] = ['likes', 'playlists', 'history', 'settings'];
const STORAGE_KEY = 'ss_sync_v1', LINK_TTL = 5 * 60_000, KEEP_TOMBSTONES = 120 * 86_400_000, BATCH = 80, REDIAL = 15_000, PING = 15_000, DEAD = 40_000, HANDSHAKE = 10_000, WATCH = 5_000, BACKOFF = 5_000, BACKOFF_MAX = 60_000;

export interface RemoteChanges {
  tracks?: readonly Track[];
  liked?: { add: readonly string[]; remove: readonly string[] };
  playlists?: { upsert: readonly { id: string; title: string; trackIds: readonly string[] }[]; remove: readonly string[] };
  history?: readonly string[];
  /** Tracks that exist only on this device (local files) and are never sent. */
  deviceOnly?(trackId: string): boolean;
}
export interface SyncConnection { readonly peer: string; send(message: unknown): void; onMessage(listener: (message: unknown) => void): void; onClose(listener: () => void): void; close(): void }
export interface SyncEndpoint {
  connect(target: string): Promise<SyncConnection>; onConnection(listener: (connection: SyncConnection) => void): void;
  /** The signalling identity is gone for good (server dropped it, peer destroyed): the engine opens a new one. */
  onClose?(listener: () => void): void;
  close(): void;
}
/** Opens a signalling identity (`ss-…`); resolves once the server accepted it. */
export type OpenEndpoint = (id: string) => Promise<SyncEndpoint>;

export interface SyncDevice { id: string; name: string; kind: 'desktop' | 'phone' | 'web'; online: boolean; lastSeen?: number; playing?: NowPlaying }
export interface NowPlaying { track: Track; position: number; playing: boolean; at: number }
export interface SyncState {
  linked: boolean; device: { id: string; name: string; kind: SyncDevice['kind'] }; devices: readonly SyncDevice[];
  linking?: { code: string; until: number } | { error: string };
  joining?: { busy: true } | { error: string };
  lastSync?: number; connecting: boolean;
}
export interface SyncApi {
  getSnapshot(): SyncState; subscribe(listener: (state: SyncState) => void): () => void;
  /** Shows a pairing code; another device enters it to join this device's group. */
  showCode(): Promise<void>; stopCode(): void;
  join(code: string): Promise<void>;
  unlink(deviceId: string): void; leave(): void; rename(name: string): void;
  /** Plays here what another device is playing, from the same position. */
  continueFrom(deviceId: string): void;
  /** The network or the app came back: redial now instead of waiting for the next retry. */
  nudge(): void;
  dispose(): void;
}
interface Member { name: string; kind: SyncDevice['kind']; t: number; del?: boolean }
interface Saved { device: { id: string; name: string; kind: SyncDevice['kind'] }; group?: { id: string; secret: string }; members: Record<string, Member>; meta: Partial<Record<Collection, Record<string, Stamp>>>; lastSync?: number }
interface Options {
  library: Pick<LibraryApi, 'getSnapshot' | 'subscribe' | 'getTrack'> & { applyRemote?: LibraryApi['applyRemote'] };
  settings: Pick<SettingsApi, 'getSnapshot' | 'subscribe' | 'setMany'>;
  /** Setting keys that follow the user across devices (schema `sync: true`). */
  syncedSettings(): readonly string[];
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  open: OpenEndpoint;
  device: { name: string; kind: SyncDevice['kind'] };
  nowPlaying?(): Omit<NowPlaying, 'at'> | null;
  subscribePlayer?(listener: () => void): () => void;
  play?(track: Track, position: number, playing: boolean): void;
  now?(): number;
  diagnostics?: import('../diagnostics').DiagnosticsApi;
}
const hex = (count: number) => [...crypto.getRandomValues(new Uint8Array(count))].map(value => value.toString(16).padStart(2, '0')).join('');
async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
/** A track is synced unless it exists only as a local file on this device. */
const syncable = (track: Track | undefined): track is Track => !!track && track.sources.some(source => source.kind !== 'local');
/** What another device needs to know about a track (no paths, download state or local files). */
const portable = (track: Track): Track => ({ ...track, sources: track.sources.filter(source => source.kind !== 'local'), liked: false, downloaded: false });
type Message = { t: string; [key: string]: unknown };

export function createSync(options: Options): SyncApi {
  const now = options.now ?? Date.now;
  let saved: Saved;
  try { saved = JSON.parse(options.storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { saved = undefined as unknown as Saved; }
  if (!saved?.device?.id) saved = { device: { id: hex(8), ...options.device }, members: {}, meta: {} };
  saved.device = { ...saved.device, kind: options.device.kind };
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => { try { options.storage?.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Kept in memory. */ } }, 500); };
  const listeners = new Set<(state: SyncState) => void>();
  const peers = new Map<string, { connection: SyncConnection; authed: boolean; nonce: string; remote?: string; outgoing: boolean; seen: number; since: number; pinged: number }>();
  /** Per device: how many dials failed in a row and when the next one is allowed. */
  const dialing = new Map<string, { fails: number; next: number; busy: boolean }>();
  const presence = new Map<string, NowPlaying>();
  let endpoint: SyncEndpoint | undefined, opening: Promise<void> | undefined, linkEndpoint: SyncEndpoint | undefined, linkTimer: ReturnType<typeof setTimeout> | undefined;
  let linking: SyncState['linking'], joining: SyncState['joining'], disposed = false, applying = false, redial: ReturnType<typeof setInterval> | undefined, watcher: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
  let state = build();
  function build(): SyncState {
    const devices = Object.entries(saved.members).filter(([id, member]) => id !== saved.device.id && !member.del).map(([id, member]) => {
      const peer = [...peers.values()].find(value => value.authed && value.remote === id);
      return { id, name: member.name, kind: member.kind, online: !!peer, lastSeen: member.t, ...(presence.get(id) ? { playing: presence.get(id)! } : {}) };
    });
    return { linked: !!saved.group, device: saved.device, devices, ...(linking ? { linking } : {}), ...(joining ? { joining } : {}), ...(saved.lastSync ? { lastSync: saved.lastSync } : {}), connecting: !!opening };
  }
  const publish = () => { state = build(); for (const listener of listeners) listener(state); };

  // ---------- local values ----------
  function values(collection: Collection): Map<string, unknown> {
    const library = options.library.getSnapshot();
    if (collection === 'likes') return new Map(library.tracks.filter(track => track.liked && syncable(track)).map(track => [track.id, 1]));
    if (collection === 'playlists') return new Map(library.playlists.filter(playlist => playlist.kind === 'playlist').map(playlist => [playlist.id, { title: playlist.title, trackIds: playlist.trackIds.filter(id => syncable(options.library.getTrack(id))) }]));
    if (collection === 'history') return new Map(library.history.filter(id => syncable(options.library.getTrack(id))).map(id => [id, 1]));
    const settings = options.settings.getSnapshot();
    return new Map(options.syncedSettings().filter(key => key in settings).map(key => [key, settings[key]]));
  }
  let lastTop = options.library.getSnapshot().history[0];
  /** Restamps changed items; returns what changed since the last look, per collection. */
  function restamp(): Partial<Record<Collection, string[]>> {
    const time = now(), changed: Partial<Record<Collection, string[]>> = {};
    for (const collection of COLLECTIONS) {
      const before = saved.meta[collection], current = values(collection);
      let next: Record<string, Stamp>;
      if (collection === 'history') {
        // History is ordered by play time. Entries that fall off the end are not "removed".
        const order = [...current.keys()];
        next = stamp(before && Object.fromEntries(Object.entries(before).filter(([key]) => current.has(key))), current, time, key => 1 + (order.length - order.indexOf(key)));
        const top = order[0]; if (before && top && top !== lastTop && !applying) next[top] = [time, fingerprint(1)];
        lastTop = top;
      } else next = prune(stamp(before, current, time), time, KEEP_TOMBSTONES);
      const keys = Object.keys(next).filter(key => !before || before[key]?.[0] !== next[key]![0] || before[key]?.[1] !== next[key]![1]);
      if (keys.length && before) changed[collection] = keys;
      saved.meta[collection] = next;
    }
    persist();
    return changed;
  }

  // ---------- messages ----------
  const authed = () => [...peers.values()].filter(peer => peer.authed);
  function entries(collection: Collection, keys: readonly string[]) {
    const meta = saved.meta[collection] ?? {}, current = values(collection), tracks = new Map<string, Track>();
    const out: Record<string, { m: Stamp; v?: unknown }> = {};
    for (const key of keys) {
      const m = meta[key]; if (!m) continue;
      out[key] = isGone(m) ? { m } : { m, v: current.get(key) };
      const ids = collection === 'playlists' ? (current.get(key) as { trackIds?: string[] } | undefined)?.trackIds ?? [] : collection === 'settings' ? [] : [key];
      for (const id of ids) { const track = options.library.getTrack(id); if (syncable(track)) tracks.set(id, portable(track)); }
    }
    return { entries: out, tracks: [...tracks.values()] };
  }
  /** Sends items in small batches: a data channel message must stay well below 256 KB. */
  function sendItems(connections: readonly SyncConnection[], collection: Collection, keys: readonly string[]) {
    for (let index = 0; index < keys.length; index += BATCH) {
      const batch = entries(collection, keys.slice(index, index + BATCH));
      if (!Object.keys(batch.entries).length) continue;
      for (const connection of connections) connection.send({ t: 'items', collection, ...batch });
    }
  }
  const hashes = () => Object.fromEntries(COLLECTIONS.map(collection => [collection, digest(saved.meta[collection] ?? {})]));
  function mergeMembers(remote: unknown): void {
    if (!remote || typeof remote !== 'object') return;
    let changed = false;
    for (const [id, member] of Object.entries(remote as Record<string, Member>)) {
      if (!member || typeof member.t !== 'number' || typeof member.name !== 'string') continue;
      const local = saved.members[id];
      if (!local || member.t > local.t) { saved.members[id] = { name: member.name.slice(0, 60), kind: member.kind, t: member.t, ...(member.del ? { del: true } : {}) }; changed = true; }
    }
    if (!changed) return;
    persist();
    if (saved.members[saved.device.id]?.del) { forget(); return; }
    for (const [key, peer] of peers) if (peer.remote && saved.members[peer.remote]?.del) { peer.connection.close(); peers.delete(key); }
    publish();
  }
  function apply(collection: Collection, received: Record<string, { m: Stamp; v?: unknown }>, tracks: readonly Track[]) {
    const meta = { ...(saved.meta[collection] ?? {}) }, valid = new Map(tracks.filter(track => track && typeof track.id === 'string' && Array.isArray(track.sources)).map(track => [track.id, track]));
    const known = (id: string) => !!options.library.getTrack(id) || valid.has(id);
    const changes: RemoteChanges = { tracks: [...valid.values()], deviceOnly: id => !syncable(options.library.getTrack(id)) };
    const add: string[] = [], remove: string[] = [], upsert: { id: string; title: string; trackIds: string[] }[] = [], removed: string[] = [], settings: Record<string, SettingValue> = {};
    for (const [key, { m, v }] of Object.entries(received)) {
      if (!Array.isArray(m) || typeof m[0] !== 'number' || !remoteWins(meta[key], m)) continue;
      if (collection === 'likes' || collection === 'history') { if (!isGone(m) && !known(key)) continue; if (collection === 'likes') (isGone(m) ? remove : add).push(key); }
      if (collection === 'playlists') {
        if (isGone(m)) removed.push(key);
        else { const value = v as { title?: unknown; trackIds?: unknown }; if (typeof value?.title !== 'string' || !Array.isArray(value.trackIds)) continue; upsert.push({ id: key, title: value.title.slice(0, 160), trackIds: value.trackIds.filter((id): id is string => typeof id === 'string' && known(id)) }); }
      }
      if (collection === 'settings') { if (isGone(m) || !options.syncedSettings().includes(key) || !['string', 'number', 'boolean'].includes(typeof v)) continue; settings[key] = v as SettingValue; }
      meta[key] = m;
    }
    saved.meta[collection] = meta;
    if (collection === 'likes' && (add.length || remove.length)) changes.liked = { add: add.sort((a, b) => (meta[b]?.[0] ?? 0) - (meta[a]?.[0] ?? 0)), remove };
    if (collection === 'playlists' && (upsert.length || removed.length)) changes.playlists = { upsert, remove: removed };
    if (collection === 'history') changes.history = Object.entries(meta).filter(([key, value]) => !isGone(value) && known(key)).sort((a, b) => b[1][0] - a[1][0]).map(([key]) => key).slice(0, 100);
    applying = true;
    try {
      if (collection === 'settings') { if (Object.keys(settings).length) options.settings.setMany(settings); }
      else if (changes.liked || changes.playlists || changes.history && fingerprint(changes.history) !== fingerprint(options.library.getSnapshot().history.filter(id => syncable(options.library.getTrack(id))))) options.library.applyRemote?.(changes);
      restamp(); // Adopted stamps already match: nothing is restamped as a local edit.
    } finally { applying = false; }
    saved.lastSync = now(); persist(); publish();
  }
  async function receive(key: string, raw: unknown) {
    const peer = peers.get(key); if (!peer || !raw || typeof raw !== 'object' || !saved.group) return;
    const message = raw as Message;
    peer.seen = now();
    if (message.t === 'hello') {
      if (message.group !== saved.group.id || typeof message.id !== 'string' || typeof message.nonce !== 'string' || saved.members[message.id]?.del) { peer.connection.close(); return; }
      peer.remote = message.id;
      peer.connection.send({ t: 'proof', mac: await hmac(saved.group.secret, `${message.nonce}|${saved.device.id}`) });
      return;
    }
    if (message.t === 'proof') {
      if (!peer.remote || message.mac !== await hmac(saved.group.secret, `${peer.nonce}|${peer.remote}`)) { options.diagnostics?.record('sync', 'proof.rejected', {}, 'warn'); peer.connection.close(); return; }
      // Both devices may dial at once. Both keep the connection opened by the smaller device id.
      const smaller = saved.device.id < peer.remote ? saved.device.id : peer.remote;
      const keep = (value: { outgoing: boolean }) => (value.outgoing ? saved.device.id : peer.remote) === smaller;
      for (const [other, value] of peers) if (other !== key && value.remote === peer.remote && value.authed) {
        if (keep(value) && !keep(peer)) { peer.connection.close(); peers.delete(key); return; }
        value.connection.close(); peers.delete(other);
      }
      peer.authed = true; dialing.delete(peer.remote); publish();
      peer.connection.send({ t: 'digest', members: saved.members, hashes: hashes() });
      const playing = options.nowPlaying?.(); if (playing) peer.connection.send({ t: 'now', ...playing, track: portable(playing.track), at: now() });
      return;
    }
    if (!peer.authed) return;
    if (message.t === 'ping') { peer.connection.send({ t: 'pong' }); return; }
    if (message.t === 'pong') return;
    if (message.t === 'digest') {
      mergeMembers(message.members);
      const theirs = (message.hashes ?? {}) as Record<string, string>;
      for (const collection of COLLECTIONS) if (theirs[collection] !== digest(saved.meta[collection] ?? {})) peer.connection.send({ t: 'meta', collection, meta: saved.meta[collection] ?? {} });
      if (COLLECTIONS.every(collection => theirs[collection] === digest(saved.meta[collection] ?? {}))) { saved.lastSync = now(); persist(); publish(); }
    } else if (message.t === 'meta' && COLLECTIONS.includes(message.collection as Collection)) {
      const collection = message.collection as Collection;
      sendItems([peer.connection], collection, newerHere(saved.meta[collection] ?? {}, (message.meta ?? {}) as Meta));
    } else if (message.t === 'items' && COLLECTIONS.includes(message.collection as Collection) && message.entries && typeof message.entries === 'object') {
      apply(message.collection as Collection, message.entries as Record<string, { m: Stamp; v?: unknown }>, Array.isArray(message.tracks) ? message.tracks as Track[] : []);
    } else if (message.t === 'members') mergeMembers(message.members);
    else if (message.t === 'now' && peer.remote) {
      const track = message.track as Track | undefined;
      if (track && typeof track.id === 'string' && Array.isArray(track.sources)) presence.set(peer.remote, { track, position: Number(message.position) || 0, playing: !!message.playing, at: Number(message.at) || now() });
      else presence.delete(peer.remote);
      publish();
    }
  }
  function attach(connection: SyncConnection, outgoing = false) {
    if (!saved.group) { connection.close(); return; }
    const key = `${connection.peer}#${hex(4)}`, nonce = hex(16);
    const time = now();
    peers.set(key, { connection, authed: false, nonce, outgoing, seen: time, since: time, pinged: time });
    // Messages are handled one after another: checking a proof is async, and the digest that
    // follows it must not be looked at before the connection counts as trusted.
    let queue = Promise.resolve();
    connection.onMessage(message => { queue = queue.then(() => receive(key, message)).catch(error => options.diagnostics?.record('sync', 'message.failed', { error: String(error) }, 'warn')); });
    connection.onClose(() => { const peer = peers.get(key); peers.delete(key); if (peer?.remote) presence.delete(peer.remote); publish(); });
    connection.send({ t: 'hello', id: saved.device.id, group: saved.group.id, nonce });
  }
  const peerId = (device: string) => `ss-${saved.group!.id}-${device}`;
  /** Dials every known device that is not connected; failures back off per device (5 s … 60 s). */
  function dial(force = false) {
    if (!endpoint || !saved.group) return;
    const current = endpoint;
    for (const [id, member] of Object.entries(saved.members)) {
      if (id === saved.device.id || member.del || [...peers.values()].some(peer => peer.remote === id)) continue;
      const info = dialing.get(id) ?? { fails: 0, next: 0, busy: false }; dialing.set(id, info);
      if (info.busy || (!force && now() < info.next)) continue;
      info.busy = true;
      void current.connect(peerId(id)).then(connection => { info.fails = 0; info.next = 0; if (endpoint === current) attach(connection, true); else connection.close(); })
        .catch(() => { info.fails++; info.next = now() + Math.min(BACKOFF_MAX, BACKOFF * 2 ** info.fails); /* Offline: retried later. */ })
        .finally(() => { info.busy = false; });
    }
  }
  /** Drops connections that went silent (sleep, lost network) or never finished the handshake, and pings the rest. */
  function watch() {
    const time = now(); let dropped = false;
    for (const [key, peer] of peers) {
      if (time - peer.seen > DEAD || (!peer.authed && time - peer.since > HANDSHAKE)) {
        peers.delete(key); if (peer.remote) presence.delete(peer.remote); dropped = true;
        options.diagnostics?.record('sync', peer.authed ? 'peer.silent' : 'handshake.timeout', {}, 'warn');
        try { peer.connection.close(); } catch { /* Already gone. */ }
      } else if (peer.authed && time - peer.pinged >= PING) { peer.pinged = time; peer.connection.send({ t: 'ping' }); }
    }
    if (dropped) { publish(); dial(); }
  }
  /** Opens a new signalling identity later: 5 s, 10 s, 20 s … 60 s. */
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = undefined; opening = undefined; start(); }, Math.min(BACKOFF_MAX, BACKOFF * 2 ** attempts++));
  }
  function start() {
    if (endpoint || opening || !saved.group || disposed) return;
    publish();
    opening = options.open(peerId(saved.device.id)).then(value => {
      if (disposed || !saved.group) { value.close(); return; }
      endpoint = value; attempts = 0;
      value.onClose?.(() => { if (endpoint !== value) return; options.diagnostics?.record('sync', 'endpoint.closed', {}, 'warn'); stop(); publish(); retry(); });
      endpoint.onConnection(connection => attach(connection)); dial();
      redial = setInterval(() => dial(), REDIAL); watcher = setInterval(watch, WATCH);
    }).catch(error => { options.diagnostics?.record('sync', 'open.failed', { error: String(error) }, 'warn'); retry(); })
      .finally(() => { if (endpoint) opening = undefined; publish(); });
  }
  function stop() { clearInterval(redial); clearInterval(watcher); clearTimeout(retryTimer); retryTimer = undefined; dialing.clear(); for (const peer of peers.values()) peer.connection.close(); peers.clear(); presence.clear(); endpoint?.close(); endpoint = undefined; opening = undefined; }
  function forget() { stop(); saved = { device: saved.device, members: {}, meta: {} }; persist(); publish(); }
  function touchSelf() { saved.members[saved.device.id] = { name: saved.device.name, kind: saved.device.kind, t: now() }; }

  // ---------- local changes ----------
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (applying || !saved.group) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { const keys = restamp(); const connections = authed().map(peer => peer.connection); if (!connections.length) return; for (const [collection, list] of Object.entries(keys)) sendItems(connections, collection as Collection, list!); }, 400);
  };
  const subscriptions = [options.library.subscribe(changed), options.settings.subscribe(changed)];
  let nowTimer: ReturnType<typeof setTimeout> | undefined, lastNow = '';
  if (options.subscribePlayer) subscriptions.push(options.subscribePlayer(() => {
    clearTimeout(nowTimer);
    nowTimer = setTimeout(() => {
      const playing = options.nowPlaying?.(), key = playing ? `${playing.track.id}|${playing.playing}` : '';
      if (key === lastNow) return; lastNow = key;
      for (const peer of authed()) peer.connection.send(playing ? { t: 'now', ...playing, track: portable(playing.track), at: now() } : { t: 'now' });
    }, 800);
  }));
  function nudge() {
    if (disposed || !saved.group) return;
    if (endpoint) { dialing.clear(); dial(true); return; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; opening = undefined; attempts = 0; start(); }
  }
  const wake = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') nudge(); };
  if (typeof globalThis.addEventListener === 'function') { globalThis.addEventListener('online', wake); globalThis.addEventListener('focus', wake); }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
  if (saved.group) { restamp(); start(); }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async showCode() {
      this.stopCode();
      if (!saved.group) { saved.group = { id: hex(6), secret: hex(32) }; saved.meta = {}; touchSelf(); restamp(); persist(); start(); }
      const code = pairingCode();
      try {
        linkEndpoint = await options.open(`ss-link-${code.toLowerCase()}`);
        linking = { code, until: now() + LINK_TTL }; publish();
        linkTimer = setTimeout(() => this.stopCode(), LINK_TTL);
        linkEndpoint.onConnection(connection => connection.onMessage(raw => {
          const message = raw as Message;
          if (message?.t !== 'join' || typeof (message.device as { id?: unknown })?.id !== 'string' || !saved.group) return;
          const device = message.device as { id: string; name: string; kind: SyncDevice['kind'] };
          saved.members[device.id] = { name: String(device.name).slice(0, 60), kind: device.kind, t: now() }; touchSelf(); persist();
          connection.send({ t: 'welcome', group: saved.group, members: saved.members });
          setTimeout(() => connection.close(), 2000);
          for (const peer of authed()) peer.connection.send({ t: 'members', members: saved.members });
          options.diagnostics?.record('sync', 'linked', { kind: device.kind });
          this.stopCode(); publish();
        }));
      } catch (error) { linking = { error: 'sync.error.server' }; options.diagnostics?.record('sync', 'link.failed', { error: String(error) }, 'warn'); publish(); }
    },
    stopCode() { clearTimeout(linkTimer); linkEndpoint?.close(); linkEndpoint = undefined; if (linking && 'code' in linking) linking = undefined; publish(); },
    async join(input) {
      const code = normalizeCode(input);
      if (!code) { joining = { error: 'sync.error.code' }; publish(); return; }
      joining = { busy: true }; publish();
      let temporary: SyncEndpoint | undefined;
      try {
        temporary = await options.open(`ss-join-${hex(8)}`);
        const connection = await temporary.connect(`ss-link-${code.toLowerCase()}`);
        const welcome = await new Promise<Message>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 15_000);
          connection.onMessage(raw => { const message = raw as Message; if (message?.t === 'welcome') { clearTimeout(timer); resolve(message); } });
          connection.onClose(() => { clearTimeout(timer); reject(new Error('closed')); });
          connection.send({ t: 'join', device: saved.device });
        });
        const group = welcome.group as { id?: unknown; secret?: unknown };
        if (typeof group?.id !== 'string' || typeof group.secret !== 'string') throw new Error('bad welcome');
        stop(); saved.group = { id: group.id, secret: group.secret }; saved.members = {}; saved.meta = {};
        mergeMembers(welcome.members); touchSelf(); restamp();
        // The joining device takes the group's settings; its likes and playlists are added to the group's.
        for (const [key, value] of Object.entries(saved.meta.settings ?? {})) saved.meta.settings![key] = [0, value[1]];
        persist();
        joining = undefined; start();
      } catch (error) {
        joining = { error: String(error).includes('timeout') || String(error).includes('closed') || String(error).includes('peer-unavailable') ? 'sync.error.notFound' : 'sync.error.server' };
        options.diagnostics?.record('sync', 'join.failed', { error: String(error) }, 'warn');
      } finally { temporary?.close(); publish(); }
    },
    unlink(deviceId) {
      const member = saved.members[deviceId]; if (!member || deviceId === saved.device.id) return;
      saved.members[deviceId] = { ...member, del: true, t: now() }; persist();
      for (const peer of authed()) peer.connection.send({ t: 'members', members: saved.members });
      // The removed device must still receive the news before the connection goes.
      setTimeout(() => { for (const [key, peer] of peers) if (peer.remote === deviceId) { peer.connection.close(); peers.delete(key); } publish(); }, 1500);
      publish();
    },
    leave() {
      if (!saved.group) return;
      saved.members[saved.device.id] = { name: saved.device.name, kind: saved.device.kind, t: now(), del: true };
      for (const peer of authed()) peer.connection.send({ t: 'members', members: saved.members });
      setTimeout(forget, 300);
    },
    rename(name) {
      const value = name.trim().slice(0, 60); if (!value) return;
      saved.device = { ...saved.device, name: value };
      if (saved.group) { touchSelf(); for (const peer of authed()) peer.connection.send({ t: 'members', members: saved.members }); }
      persist(); publish();
    },
    continueFrom(deviceId) {
      const playing = presence.get(deviceId); if (!playing) return;
      const position = playing.position + (playing.playing ? (now() - playing.at) / 1000 : 0);
      options.play?.(playing.track, Math.max(0, Math.min(position, playing.track.duration - 1)), true);
    },
    nudge,
    dispose() { disposed = true; if (typeof globalThis.removeEventListener === 'function') { globalThis.removeEventListener('online', wake); globalThis.removeEventListener('focus', wake); } if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake); clearTimeout(changeTimer); clearTimeout(nowTimer); this.stopCode(); stop(); subscriptions.forEach(dispose => dispose()); if (persistTimer) { clearTimeout(persistTimer); try { options.storage?.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Closing. */ } } listeners.clear(); },
  };
}
