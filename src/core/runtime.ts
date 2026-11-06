import type { AppApi } from './api';
import { EventBus } from './events';
import { ImportRegistry, LyricsRegistry, SettingsRegistry, SourceRegistry, UiSlotRegistry } from './registries';
export function createExtensions() {
  const events = new EventBus();
  return { events, sources: new SourceRegistry(events), lyrics: new LyricsRegistry(events), imports: new ImportRegistry(events), settings: new SettingsRegistry(events), ui: new UiSlotRegistry(events) };
}
export type Extensions = ReturnType<typeof createExtensions>;
/** Instrument the shared ports themselves so nested mock calls also use the bus. */
export function bindCoreEvents(api: Omit<AppApi, 'extensions'>, extensions: Extensions): () => void {
  const { events } = extensions;
  const original: (() => void)[] = [];
  const wrap = (domain: string, target: object, keys: readonly string[]) => {
    const object = target as Record<string, (...args: unknown[]) => unknown>;
    for (const key of keys) { const fn = object[key]; if (!fn) continue; object[key] = (...args) => events.mutate(domain, key, args, () => fn.apply(target, args)); original.push(() => object[key] = fn); }
  };
  wrap('library', api.library, ['setLiked', 'addToPlaylist', 'addToPlaylistBatch', 'createPlaylist', 'removeFromPlaylist', 'deletePlaylist', 'addTracks', 'recordPlay', 'setDownloaded', 'setDownloadedBatch']);
  wrap('player', api.player, ['play', 'resume', 'toggle', 'next', 'previous', 'skipTo', 'seek', 'setShuffle', 'cycleRepeat', 'enqueue', 'move', 'remove', 'clearUpcoming', 'setSleepTimer']);
  wrap('settings', api.settings, ['set', 'setMany', 'reset']); wrap('imports', api.imports, ['start', 'retry', 'cancel', 'resolve']);
  let player = api.player.getSnapshot(), library = api.library.getSnapshot(), settings = api.settings.getSnapshot(), phase = api.imports.getSnapshot()?.phase;
  const subscriptions = [
    events.on('source:resolve', result => api.diagnostics?.record('sources', `resolve.${result.outcome}`, { ...result }, result.outcome === 'failed' ? 'warn' : 'info')),
    events.on('registry:change', change => {
      if (change.registry !== 'settings') return;
      const current = api.settings.getSnapshot();
      const defaults = Object.fromEntries(extensions.settings.list().filter(definition => !(definition.key in current)).map(definition => [definition.key, definition.default]));
      if (Object.keys(defaults).length) api.settings.setMany(defaults);
    }),
    api.player.subscribe(next => {
      events.emit('player:state', next);
      if (next.trackId !== player.trackId) events.emit('track:change', { previous: player.trackId, trackId: next.trackId });
      if (next.playing !== player.playing) events.emit(next.playing ? 'player:play' : 'player:pause', next);
      if (next.queue !== player.queue) events.emit('queue:change', next.queue);
      if (!!next.crossfade !== !!player.crossfade) events.emit('player:crossfade', next.crossfade);
      player = next;
    }),
    events.on('command:after', command => { if (command.domain === 'player' && command.action === 'seek') events.emit('player:seek', { position: api.player.getSnapshot().position }); }),
    api.library.subscribe(next => {
      if (next.history !== library.history) events.emit('history:change', next.history);
      const previous = new Map(library.tracks.map(track => [track.id, track]));
      const changed = next.tracks.filter(track => previous.get(track.id) !== track);
      for (const track of changed) if (track.liked !== (previous.get(track.id)?.liked ?? false)) events.emit(track.liked ? 'library:like' : 'library:unlike', track);
      if (changed.length) events.emit('library:change', { trackIds: changed.map(track => track.id) });
      const playlists = new Map(library.playlists.map(playlist => [playlist.id, playlist]));
      for (const playlist of next.playlists) if (playlists.get(playlist.id) !== playlist) events.emit('playlist:change', { playlistId: playlist.id, playlist });
      for (const id of playlists.keys()) if (!next.playlists.some(playlist => playlist.id === id)) events.emit('playlist:change', { playlistId: id, playlist: null });
      library = next;
    }),
    api.settings.subscribe(next => { for (const [key, value] of Object.entries(next)) if (settings[key] !== value) events.emit('settings:change', { key, value }); settings = next; }),
    api.imports.subscribe(job => { if (job) { events.emit('import:progress', job); if (job.phase === 'done' && phase !== 'done') events.emit('import:done', job); } phase = job?.phase; }),
  ];
  return () => { subscriptions.forEach(fn => fn()); original.reverse().forEach(fn => fn()); events.clear(); };
}
