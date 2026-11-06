import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { createExtensions, bindCoreEvents } from '../../src/core/runtime';
import { registerBuiltInProviders } from '../../src/mock/providers';
import { registerBuiltInUi } from '../../src/ui/extensions';
import { createLibrary } from '../../src/mock/library';
import { createPlayer } from '../../src/mock/player';
import { createImports } from '../../src/mock/imports';
import { createSettings } from '../../src/mock/settings';
import { createEnvironment } from '../../src/mock/environment';
import { mockLyrics } from '../../src/mock/lyrics';
import { defaultSettings } from '../../src/ui/settings/schema';
describe('section 0 extension seams', () => {
  it('publishes a fast search result while a slower provider is still pending', async () => {
    const runtime = createExtensions(), library = createLibrary();
    let finish!: (value: { tracks: readonly never[]; artists: readonly never[]; playlists: readonly never[] }) => void;
    const empty = { artists: [], playlists: [] };
    runtime.sources.register({ id: 'fast', titleKey: 'fast', search: async () => ({ ...empty, tracks: [library.getTrack('track-1')!] }), getTrack: async () => undefined, resolveStream: async () => null, parseLink: () => null });
    runtime.sources.register({ id: 'slow', titleKey: 'slow', search: () => new Promise(resolve => finish = resolve), getTrack: async () => undefined, resolveStream: async () => null, parseLink: () => null });
    const counts: number[] = [], pending = runtime.sources.search('Song', { source: 'all', type: 'tracks' }, undefined, value => counts.push(value.tracks.length));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(counts).toContain(1); finish({ tracks: [], artists: [], playlists: [] }); expect((await pending).tracks).toHaveLength(1);
  });
  it('isolates failing event handlers and supports exact unsubscription', () => { const bus = new EventBus(), calls: number[] = []; bus.on('player:seek', () => { throw new Error('listener'); }); const unsubscribe = bus.on('player:seek', data => calls.push(data.position)); bus.emit('player:seek', { position: 5 }); unsubscribe(); bus.emit('player:seek', { position: 8 }); expect(calls).toEqual([5]); expect(bus.errors).toHaveLength(2); });
  it('registers built-ins and third-party providers through the same source/lyrics/import contracts', async () => {
    const runtime = createExtensions(), environment = createEnvironment(), library = createLibrary(), imports = createImports(library, environment);
    const dispose = registerBuiltInProviders(runtime, library, mockLyrics, imports, environment);
    expect(runtime.sources.list().map(source => source.id)).toEqual(['sc','yt','ya','local']); expect(runtime.lyrics.list().map(source => source.id)).toEqual(['lrclib','ya']); expect(runtime.imports.list().map(source => source.id)).toContain('spotify');
    const unregister = runtime.sources.register({ id: 'test.provider', titleKey: 'test', search: async () => ({ tracks: [library.getTrack('track-1')!], artists: [], playlists: [] }), getTrack: async () => undefined, resolveStream: async () => null, parseLink: () => null });
    expect((await runtime.sources.search('', { source: 'test.provider', type: 'tracks' })).tracks).toHaveLength(1); unregister(); expect(runtime.sources.get('test.provider')).toBeUndefined();
    expect(() => runtime.sources.register(runtime.sources.get('sc')!)).toThrow('Duplicate'); dispose(); expect(runtime.sources.list()).toHaveLength(0); imports.dispose(); environment.dispose();
  });
  it('renders built-in menus, controls, screens and settings from named slots', () => { const runtime = createExtensions(), dispose = registerBuiltInUi(runtime); expect(runtime.ui.list('trackMenu')).toHaveLength(7); expect(runtime.ui.list('playerButtons').filter(item => item.location === 'transport')).toHaveLength(5); expect(runtime.ui.list('screens').some(screen => screen.route === 'import')).toBe(true); expect(runtime.settings.list().some(setting => setting.key === 'crossfade')).toBe(true); const unregister = runtime.ui.register('trackMenu', { id: 'test.action', command: 'test', icon: 'music', titleKey: 'test' }); expect(runtime.ui.list('trackMenu').at(-1)?.id).toBe('test.action'); unregister(); dispose(); expect(runtime.ui.list('screens')).toHaveLength(0); });
  it('all public mutation ports and nested library writes publish typed events', () => {
    const runtime = createExtensions(), environment = createEnvironment(), library = createLibrary(), settings = createSettings(defaultSettings), player = createPlayer(library), imports = createImports(library, environment);
    const received: string[] = []; runtime.events.on('command:before', value => received.push(`${value.domain}.${value.action}`)); runtime.events.on('library:unlike', value => received.push(`unlike:${value.id}`)); runtime.events.on('playlist:change', value => received.push(`playlist:${value.playlistId}`)); runtime.events.on('player:seek', value => received.push(`seek:${value.position}`));
    const api = { library, search: library, settings, player, imports, environment, lyrics: mockLyrics, files: { saveJson: async () => 'saved' as const, readClipboard: async () => '', pickFolder: async () => null, pickAudio: async () => null, readAudioMetadata: async () => [] }, haptics: { pulse() {}, start() {}, wave() {}, end() {} } };
    const unbind = bindCoreEvents(api, runtime); library.setLiked('track-1', false); const id = library.createPlaylist('Test'); library.addToPlaylist(id, 'track-2'); player.seek(20);
    runtime.settings.register({ id: 'extension.flag', key: 'extension.flag', section: 'extension', type: 'toggle', default: true, sync: true, label: 'extension.flag' }); expect(settings.getSnapshot()['extension.flag']).toBe(true);
    expect(received).toContain('library.setLiked'); expect(received).toContain('unlike:track-1'); expect(received).toContain(`playlist:${id}`); expect(received).toContain('player.seek'); expect(received).toContain('seek:20'); unbind(); player.dispose(); imports.dispose(); environment.dispose();
  });
});
