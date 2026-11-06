import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { networkAllowed, readPackage, validateManifest, validateScreen } from '../../src/core/plugins/manifest';
import { createPluginHost } from '../../src/core/plugins/host';
import type { PluginWorker } from '../../src/core/plugins/host';
import type { HostMessage, WorkerMessage } from '../../src/core/plugins/types';
import { createExtensions } from '../../src/core/runtime';
import { createLibrary } from '../../src/core/library';
import { localTrack } from '../../src/core/local';
import { HttpFailure } from '../../src/core/http';
import type { PlayerApi } from '../../src/core/api';

const manifest = (extra: Record<string, unknown> = {}) => ({ id: 'dev.test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1.0', entry: 'main.js', permissions: ['player.read', 'provider.lyrics', 'network:api.example.com'], ...extra });
const pack = (value: Record<string, unknown> = manifest(), prefix = '') => zipSync({ [`${prefix}manifest.json`]: strToU8(JSON.stringify(value)), [`${prefix}main.js`]: strToU8('export function activate() {}') });
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; };

describe('plugin manifest and package', () => {
  it('accepts a valid manifest and rejects unknown permissions, bad ids and newer API versions', () => {
    expect(validateManifest(manifest())).toMatchObject({ id: 'dev.test.plugin', permissions: ['player.read', 'provider.lyrics', 'network:api.example.com'] });
    expect(() => validateManifest(manifest({ permissions: ['files.read'] }))).toThrow(/Unknown permission/);
    expect(() => validateManifest(manifest({ id: 'Bad Id' }))).toThrow(/Invalid id/);
    expect(() => validateManifest(manifest({ apiVersion: '1.9' }))).toThrow(/needs API/);
    expect(() => validateManifest(manifest({ apiVersion: '2.0' }))).toThrow(/Unsupported/);
    expect(() => validateManifest(manifest({ permissions: ['network:http://x'] }))).toThrow();
  });
  it('reads archives with or without a top-level folder', () => {
    expect(readPackage(pack()).manifest.id).toBe('dev.test.plugin');
    expect(readPackage(pack(manifest(), 'plugin/')).code).toContain('activate');
    expect(() => readPackage(strToU8('not a zip'))).toThrow(/zip/);
  });
  it('accepts known screen elements only, within size limits', () => {
    expect(validateScreen({ title: 'T', content: [{ type: 'section', title: 'S', children: [{ type: 'row', title: 'r', action: 'go' }, { type: 'toggle', label: 'l', value: true, action: 't' }] }, { type: 'button', title: 'b', action: 'x' }] }).content).toHaveLength(2);
    expect(() => validateScreen({ title: 'T', content: [{ type: 'html', html: '<b>' }] })).toThrow(/Unknown element/);
    expect(() => validateScreen({ title: 'T', content: Array.from({ length: 500 }, () => ({ type: 'text', text: 'x' })) })).toThrow(/elements/);
    let deep: unknown = { type: 'text', text: 'x' }; for (let i = 0; i < 8; i++) deep = { type: 'section', children: [deep] };
    expect(() => validateScreen({ title: 'T', content: [deep] })).toThrow(/deeply/);
  });
  it('allows only HTTPS to granted hosts', () => {
    const granted = ['network:api.example.com', 'network:*.cdn.org'] as const;
    expect(networkAllowed(granted, 'https://api.example.com/v1')).toBe(true);
    expect(networkAllowed(granted, 'http://api.example.com/v1')).toBe(false);
    expect(networkAllowed(granted, 'https://evil.com/?api.example.com')).toBe(false);
    expect(networkAllowed(granted, 'https://a.cdn.org/x')).toBe(true);
    expect(networkAllowed(granted, 'https://cdn.org/x')).toBe(true);
    expect(networkAllowed(granted, 'https://notcdn.org/x')).toBe(false);
  });
});

function setup() {
  const storage = memory(), extensions = createExtensions(), library = createLibrary();
  const track = localTrack({ uri: 'content://x/one', name: 'one.mp3', duration: 100, title: 'Song', artist: 'Artist' }, 'Unknown')!;
  library.addTracks([track]);
  const player = { getSnapshot: () => ({ queue: [], currentIndex: 0, trackId: track.id, position: 3, playing: true, shuffle: false, repeat: 'off' }), toggle: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn() } as unknown as PlayerApi;
  const workers: { sent: HostMessage[]; reply(message: WorkerMessage): void; error(text: string): void; terminated: boolean }[] = [];
  const http = { text: vi.fn(async (url: string) => { if (url.includes('missing')) throw new HttpFailure(404, 'nope'); return 'body'; }) };
  const notify = vi.fn();
  const host = createPluginHost({ storage, extensions, library, player, http, notify, locale: () => 'ru', limits: { pingMs: 1000, hangMs: 3000, startMs: 2000, callMs: 500 }, spawn(): PluginWorker {
    let onMessage: (message: WorkerMessage) => void = () => {}, onError: (text: string) => void = () => {};
    const worker = { sent: [] as HostMessage[], reply: (message: WorkerMessage) => onMessage(message), error: (text: string) => onError(text), terminated: false };
    workers.push(worker);
    return { post: message => worker.sent.push(message), onMessage: listener => { onMessage = listener; }, onError: listener => { onError = listener; }, terminate: () => { worker.terminated = true; } };
  } });
  const request = async (worker: typeof workers[number], method: string, ...args: unknown[]) => {
    const id = Math.floor(Math.random() * 1e9); worker.reply({ type: 'request', id, method, args });
    await vi.waitFor(() => expect(worker.sent.some(message => message.type === 'reply' && message.id === id)).toBe(true));
    return worker.sent.find(message => message.type === 'reply' && message.id === id) as Extract<HostMessage, { type: 'reply' }>;
  };
  return { storage, extensions, library, track, host, workers, request, http, notify, player };
}

describe('plugin host', () => {
  afterEach(() => vi.useRealTimers());
  it('installs turned off, starts on enable and checks every request against granted permissions', async () => {
    const { host, workers, request, storage, track } = setup();
    const installed = await host.install(pack());
    expect(installed).toMatchObject({ enabled: false, status: 'disabled' }); expect(workers).toHaveLength(0);
    host.setEnabled('dev.test.plugin', true);
    const worker = workers[0]!; expect(worker.sent[0]).toMatchObject({ type: 'load', manifest: { id: 'dev.test.plugin' } });
    worker.reply({ type: 'ready' }); expect(host.getSnapshot()[0]!.status).toBe('running');
    expect((await request(worker, 'player.state')).value).toMatchObject({ track: { id: track.id, title: 'Song' }, playing: true });
    expect(await request(worker, 'player.next')).toMatchObject({ ok: false, error: expect.stringMatching(/player.control/) });
    expect(await request(worker, 'library.likes')).toMatchObject({ ok: false });
    expect(await request(worker, 'files.read')).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown method/) });
    await request(worker, 'storage.set', 'a', { n: 1 }); expect((await request(worker, 'storage.get', 'a')).value).toEqual({ n: 1 });
    expect(storage.data.has('ss_plugin_data_dev.test.plugin')).toBe(true);
    expect(await request(worker, 'storage.set', 'big', 'x'.repeat(600 * 1024))).toMatchObject({ ok: false, error: expect.stringMatching(/full/) });
  });
  it('lets the network reach only granted hosts and reports HTTP errors as responses', async () => {
    const { host, workers, request, http } = setup();
    await host.install(pack()); host.setEnabled('dev.test.plugin', true); const worker = workers[0]!; worker.reply({ type: 'ready' });
    expect((await request(worker, 'net.fetch', 'https://api.example.com/x')).value).toEqual({ status: 200, ok: true, body: 'body' });
    expect((await request(worker, 'net.fetch', 'https://api.example.com/missing')).value).toMatchObject({ status: 404, ok: false });
    expect(await request(worker, 'net.fetch', 'https://other.com/x')).toMatchObject({ ok: false, error: expect.stringMatching(/other.com/) });
    expect(http.text).toHaveBeenCalledTimes(2);
  });
  it('serves lyrics through the registry and survives a slow plugin', async () => {
    const { host, workers, request, extensions, track } = setup();
    await host.install(pack()); host.setEnabled('dev.test.plugin', true); const worker = workers[0]!; worker.reply({ type: 'ready' });
    await request(worker, 'provider.lyrics.register', { id: 'demo', name: 'Demo' });
    const pending = extensions.lyrics.find(track.id);
    await vi.waitFor(() => expect(worker.sent.some(message => message.type === 'call')).toBe(true));
    const call = worker.sent.find(message => message.type === 'call') as Extract<HostMessage, { type: 'call' }>;
    expect(call.args).toEqual(['demo', expect.objectContaining({ id: track.id, artist: 'Artist' })]);
    worker.reply({ type: 'reply', id: call.id, ok: true, value: { lines: [{ time: 1, text: 'Строка' }] } });
    expect(await pending).toMatchObject({ synced: true, lines: [{ time: 1, text: 'Строка' }], creditKey: 'Demo' });
    // No answer: the lookup fails after the call timeout instead of hanging.
    const slow = extensions.lyrics.find(`${track.id}`); await expect(slow).rejects.toThrow(/longer than/);
  });
  it('stops a plugin that fails, hangs or floods, and the app keeps its state', async () => {
    vi.useFakeTimers();
    const { host, workers } = setup();
    await host.install(pack()); host.setEnabled('dev.test.plugin', true);
    workers[0]!.reply({ type: 'failed', error: 'boom' });
    expect(host.getSnapshot()[0]).toMatchObject({ status: 'crashed', error: 'boom', enabled: true }); expect(workers[0]!.terminated).toBe(true);
    host.setEnabled('dev.test.plugin', true); const worker = workers[1]!; worker.reply({ type: 'ready' });
    vi.advanceTimersByTime(5000);
    expect(host.getSnapshot()[0]).toMatchObject({ status: 'crashed', error: 'Not responding' });
    host.setEnabled('dev.test.plugin', true); const flood = workers[2]!; flood.reply({ type: 'ready' });
    for (let i = 0; i < 12; i++) flood.reply({ type: 'error', error: `e${i}` });
    expect(host.getSnapshot()[0]).toMatchObject({ status: 'crashed', error: expect.stringMatching(/Too many errors/) });
  });
  it('adds player buttons and a screen, routes taps back to the plugin and drops them when it stops', async () => {
    const { host, workers, request, extensions, track } = setup();
    await host.install(pack(manifest({ permissions: ['ui.playerButton', 'ui.screen', 'player.read'] }))); host.setEnabled('dev.test.plugin', true); const worker = workers[0]!; worker.reply({ type: 'ready' });
    expect(await request(worker, 'ui.trackMenu.add', { id: 'x', title: 'X' })).toMatchObject({ ok: false });
    await request(worker, 'ui.playerButton.add', { id: 'count', title: 'Count', icon: 'clock' });
    expect(extensions.ui.list('playerButtons').find(item => item.id.startsWith('plugin.'))).toMatchObject({ command: 'plugin:dev.test.plugin:button:count', icon: 'clock', location: 'side' });
    extensions.events.emit('ui:command', { command: 'plugin:dev.test.plugin:button:count', slot: 'playerButtons' });
    expect(worker.sent.at(-1)).toMatchObject({ type: 'call', method: 'menu.select', args: ['button:count', expect.objectContaining({ id: track.id })] });
    await request(worker, 'ui.screen.set', { title: 'Screen', content: [{ type: 'button', title: 'Go', action: 'go' }] });
    expect(host.getScreen('dev.test.plugin')?.title).toBe('Screen');
    const acting = host.act('dev.test.plugin', 'go', true);
    const call = worker.sent.at(-1) as Extract<HostMessage, { type: 'call' }>; expect(call).toMatchObject({ method: 'ui.action', args: ['go', true] });
    worker.reply({ type: 'reply', id: call.id, ok: true, value: true }); await acting;
    expect(await request(worker, 'ui.screen.set', { title: 'Bad', content: [{ type: 'script' }] })).toMatchObject({ ok: false });
    host.setEnabled('dev.test.plugin', false);
    expect(host.getScreen('dev.test.plugin')).toBeUndefined(); expect(extensions.ui.list('playerButtons').some(item => item.id.startsWith('plugin.'))).toBe(false);
  });
  it('revoking a permission restarts the plugin, an update asking for more turns it off, removal deletes its data', async () => {
    const { host, workers, storage } = setup();
    await host.install(pack()); host.setEnabled('dev.test.plugin', true); workers[0]!.reply({ type: 'ready' });
    host.setPermission('dev.test.plugin', 'player.read', false);
    expect(host.getSnapshot()[0]!.granted).not.toContain('player.read'); expect(workers).toHaveLength(2);
    await host.install(pack(manifest({ version: '1.1.0', permissions: ['provider.lyrics', 'network:api.example.com', 'notify'] })));
    expect(host.getSnapshot()[0]).toMatchObject({ enabled: false, granted: ['provider.lyrics', 'network:api.example.com', 'notify'] });
    host.remove('dev.test.plugin');
    expect(host.getSnapshot()).toHaveLength(0); expect([...storage.data.keys()].filter(key => key.includes('dev.test.plugin'))).toEqual([]);
  });
});
