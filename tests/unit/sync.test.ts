import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrary } from '../../src/core/library';
import { createSettings } from '../../src/core/settings';
import { createSync } from '../../src/core/sync/engine';
import type { OpenEndpoint, SyncConnection, SyncEndpoint } from '../../src/core/sync/engine';
import { digest, fingerprint, newerHere, normalizeCode, pairingCode, remoteWins, stamp } from '../../src/core/sync/merge';
import type { Track } from '../../src/core/types';

const track = (id: string, kind: 'sc' | 'local' = 'sc'): Track => ({ id, title: `Title ${id}`, artist: { id: `a-${id}`, name: `Artist ${id}`, artwork: { seed: 1, variant: 'terrain' } }, duration: 200, sources: [{ kind, externalId: id }], explicit: false, liked: false, downloaded: false, addedAt: 1, artwork: { seed: 1, variant: 'terrain' } } as Track);

/** A signalling server and WebRTC in memory: messages are JSON-copied and delivered asynchronously. */
function network() {
  const endpoints = new Map<string, { accept(connection: SyncConnection): void }>();
  const pair = (a: string, b: string): [SyncConnection, SyncConnection] => {
    type Side = SyncConnection & { link(value: Side): void; deliver(message: unknown): void; shut(): void };
    const make = (peer: string): Side => { const listeners: ((message: unknown) => void)[] = [], closers: (() => void)[] = []; let other: Side; let open = true;
      const self: Side = { peer, link(value: Side) { other = value; }, deliver(message: unknown) { if (open) for (const listener of listeners) listener(message); },
        send(message: unknown) { const copy = JSON.parse(JSON.stringify(message)); setTimeout(() => other.deliver(copy), 1); },
        onMessage(listener: (message: unknown) => void) { listeners.push(listener); }, onClose(listener: () => void) { closers.push(listener); },
        shut() { if (!open) return; open = false; for (const closer of closers) closer(); }, close() { self.shut(); other.shut(); } };
      return self; };
    const left = make(b), right = make(a); left.link(right); right.link(left); return [left, right];
  };
  const open: OpenEndpoint = async id => {
    if (endpoints.has(id)) throw new Error('unavailable-id');
    let accept: (connection: SyncConnection) => void = () => {};
    endpoints.set(id, { accept: connection => accept(connection) });
    const endpoint: SyncEndpoint = {
      async connect(target) { const remote = endpoints.get(target); if (!remote) throw new Error('peer-unavailable'); const [mine, theirs] = pair(id, target); setTimeout(() => remote.accept(theirs), 1); return mine; },
      onConnection(listener) { accept = listener; },
      close() { endpoints.delete(id); },
    };
    return endpoint;
  };
  return { open, endpoints };
}
function device(name: string, net: ReturnType<typeof network>, tracks: Track[] = []) {
  const library = createLibrary(), settings = createSettings({ language: 'ru', fontSize: 100, crossfade: 3, onboardingDone: false });
  if (tracks.length) library.addTracks(tracks);
  const played: { id: string; position: number }[] = [];
  let now: { track: Track; position: number; playing: boolean } | null = null;
  const sync = createSync({ library, settings, syncedSettings: () => ['language', 'fontSize', 'crossfade'], open: net.open, device: { name, kind: 'desktop' },
    nowPlaying: () => now, play: (value, position) => played.push({ id: value.id, position }) });
  return { library, settings, sync, played, setNow(value: typeof now) { now = value; } };
}
// HMAC checks run on the real crypto thread pool, outside fake time: give them real turns too.
const realTick = () => new Promise(resolve => setImmediate(resolve));
const settle = async (ms = 3000) => { for (let spent = 0; spent < ms; spent += 50) { await vi.advanceTimersByTimeAsync(50); for (let turn = 0; turn < 25; turn++) await realTick(); } };

describe('sync merge rules', () => {
  it('stamps new and changed items, keeps unchanged ones, leaves tombstones', () => {
    const first = stamp(undefined, new Map([['a', 1], ['b', 2]]), 100);
    expect(first.a![0]).toBe(1); // existing data never beats a real edit elsewhere
    const second = stamp(first, new Map([['a', 1], ['c', 3]]), 200);
    expect(second.a).toBe(first.a); expect(second.c).toEqual([200, fingerprint(3)]); expect(second.b).toEqual([200, '', 1]);
  });
  it('newer wins, ties are decided the same way on both sides', () => {
    expect(remoteWins([1, 'a'], [2, 'a'])).toBe(true);
    expect(remoteWins([2, 'a'], [1, 'b'])).toBe(false);
    expect(remoteWins([2, 'a'], [2, 'b'])).toBe(!remoteWins([2, 'b'], [2, 'a']));
    expect(newerHere({ x: [5, 'a'], y: [1, 'a'] }, { x: [4, 'a'], y: [3, 'b'] })).toEqual(['x']);
    expect(digest({ a: [1, 'x'] })).toBe(digest({ a: [1, 'x'] }));
  });
  it('pairing codes avoid look-alike characters and accept a dash', () => {
    const code = pairingCode();
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(normalizeCode(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`)).toBe(code);
    expect(normalizeCode('ABCD-EF0')).toBeNull();
  });
});

describe('device sync', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('links with a code, merges both libraries and pushes later edits both ways', async () => {
    const net = network();
    const pc = device('PC', net, [track('1'), track('2'), track('9', 'local')]), phone = device('Phone', net, [track('3')]);
    pc.library.setLiked('1', true); pc.library.setLiked('9', true); phone.library.setLiked('3', true);
    const list = pc.library.createPlaylist('Road'); pc.library.addToPlaylist(list, '2'); pc.library.addToPlaylist(list, '9');
    pc.settings.set('crossfade', 6); phone.settings.set('crossfade', 1);
    await pc.sync.showCode(); await settle(100);
    const linking = pc.sync.getSnapshot().linking;
    if (!linking || !('code' in linking)) throw new Error('no code');
    const joined_phone = phone.sync.join(linking.code); await settle(); await joined_phone;

    expect(pc.sync.getSnapshot().devices.map(value => [value.name, value.online])).toEqual([['Phone', true]]);
    // Union of likes; the local-only file is never sent.
    expect(phone.library.getTrack('1')?.liked).toBe(true);
    expect(phone.library.getTrack('9')).toBeUndefined();
    expect(pc.library.getTrack('3')?.liked).toBe(true);
    expect(phone.library.getSnapshot().playlists.find(value => value.id === list)?.trackIds).toEqual(['2']);
    // The joining device takes the group's settings.
    expect(phone.settings.getSnapshot().crossfade).toBe(6);

    phone.library.setLiked('1', false); phone.library.addToPlaylist(list, '3'); await settle();
    expect(pc.library.getTrack('1')?.liked).toBe(false);
    // The PC keeps its local file in the playlist, after the synced tracks.
    expect(pc.library.getSnapshot().playlists.find(value => value.id === list)?.trackIds).toEqual(['2', '3', '9']);
    pc.library.deletePlaylist(list); pc.settings.set('fontSize', 120); await settle();
    expect(phone.library.getSnapshot().playlists.some(value => value.id === list)).toBe(false);
    expect(phone.settings.getSnapshot().fontSize).toBe(120);
  });

  it('catches up after being apart and continues playback from the other device', async () => {
    const net = network();
    const pc = device('PC', net, [track('1'), track('2')]), phone = device('Phone', net);
    await pc.sync.showCode(); await settle(100);
    const linking = pc.sync.getSnapshot().linking as { code: string };
    const joined_phone = phone.sync.join(linking.code); await settle(); await joined_phone;
    phone.sync.dispose(); await settle(); // phone goes away
    pc.library.setLiked('2', true); pc.library.recordPlay('1'); await settle();
    pc.setNow({ track: pc.library.getTrack('2')!, position: 30, playing: true });
    const again = device('Tablet', net);
    await pc.sync.showCode(); await settle(100);
    const joined_again = again.sync.join((pc.sync.getSnapshot().linking as { code: string }).code); await settle(); await joined_again;
    expect(again.library.getTrack('2')?.liked).toBe(true);
    expect(again.library.getSnapshot().history[0]).toBe('1');
    const playing = again.sync.getSnapshot().devices.find(value => value.name === 'PC')?.playing;
    expect(playing?.track.id).toBe('2');
    again.sync.continueFrom(again.sync.getSnapshot().devices.find(value => value.name === 'PC')!.id);
    expect(again.played[0]?.id).toBe('2'); expect(again.played[0]!.position).toBeGreaterThanOrEqual(30);
  });

  it('rejects a connection that does not know the group key, and an unlinked device leaves', async () => {
    const net = network();
    const pc = device('PC', net, [track('1')]), phone = device('Phone', net);
    await pc.sync.showCode(); await settle(100);
    const joined_phone = phone.sync.join((pc.sync.getSnapshot().linking as { code: string }).code); await settle(); await joined_phone;
    const pcId = pc.sync.getSnapshot().device.id, groupPeer = [...net.endpoints.keys()].find(id => id.endsWith(pcId))!;
    const intruder = await net.open('intruder');
    const connection = await intruder.connect(groupPeer);
    let closed = false; connection.onClose(() => { closed = true; });
    connection.send({ t: 'hello', id: 'evil', group: groupPeer.split('-')[1], nonce: 'n' });
    connection.send({ t: 'proof', mac: 'wrong' });
    connection.send({ t: 'items', collection: 'likes', entries: { 1: { m: [Date.now() + 1e9, '', 1] } }, tracks: [] });
    await settle();
    expect(pc.library.getTrack('1')).toBeDefined();
    expect(closed).toBe(true);
    pc.sync.unlink(phone.sync.getSnapshot().device.id); await settle();
    expect(phone.sync.getSnapshot().linked).toBe(false);
    expect(pc.sync.getSnapshot().devices).toEqual([]);
  });
});
