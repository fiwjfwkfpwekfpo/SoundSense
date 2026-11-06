import type { LibraryApi, SearchApi } from '../core/api';
import type { LibrarySnapshot, SearchFilters, TrackSort, Waveform } from '../core/types';
import { createData, generateWaveform } from './data';
import { STORAGE_KEYS } from '../core/storage';
import type { EnvironmentApi } from '../core/environment';
import type { Track } from '../core/types';
export function createLibrary(storage?: Pick<Storage, 'getItem' | 'setItem'>, environment?: EnvironmentApi): LibraryApi & SearchApi {
  let snapshot = createData();
  const fixtureTracks = new Map(snapshot.tracks.map(track => [track.id, track]));
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEYS.library) ?? 'null');
    if (saved && Array.isArray(saved.tracks) && Array.isArray(saved.playlists)) {
      const savedTracks = new Map<string, Track>(saved.tracks.filter((track: Track) => track && typeof track.id === 'string' && typeof track.title === 'string' && Array.isArray(track.sources)).map((track: Track) => [track.id, track]));
      snapshot = { ...snapshot, tracks: [...snapshot.tracks.map(track => savedTracks.get(track.id) ?? track), ...[...savedTracks.values()].filter(track => !snapshot.tracks.some(t => t.id === track.id))], playlists: saved.playlists.filter((p: {id: string; trackIds: unknown}) => p && typeof p.id === 'string' && Array.isArray(p.trackIds)), history: Array.isArray(saved.history) ? saved.history : snapshot.history };
    }
  } catch { /* Corrupt persisted mock data cannot prevent startup. */ }
  let sequence = Date.now();
  const view = (): LibrarySnapshot => environment?.getSnapshot().scenario === 'empty' ? { tracks: [], playlists: [{ ...snapshot.playlists[0]!, trackIds: [] }], recommendations: [], history: [] } : snapshot;
  let byId = new Map(snapshot.tracks.map(track => [track.id, track]));
  const listeners = new Set<(data: LibrarySnapshot) => void>();
  const waves = new Map<string, Waveform>();
  let recent = ['Полутона', 'тихий берег', 'Night Drive'];
  let saveTimer: ReturnType<typeof setTimeout>;
  function save() { clearTimeout(saveTimer); try { storage?.setItem(STORAGE_KEYS.library, JSON.stringify({ tracks: snapshot.tracks.filter(track => fixtureTracks.get(track.id) !== track), playlists: snapshot.playlists, history: snapshot.history })); } catch { /* Keep session state. */ } }
  function emit() { clearTimeout(saveTimer); if (storage) saveTimer = setTimeout(save, 400); byId = new Map(snapshot.tracks.map(t => [t.id, t]));
    for (const listener of listeners) listener(view()); }
  environment?.subscribe(() => { for (const listener of listeners) listener(view()); });
  return {
    getSnapshot: view,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getTrack: id => byId.get(id),
    getPlaylistTracks(id, query = '', sort: TrackSort = 'added') {
      const playlist = view().playlists.find(p => p.id === id);
      const ids = playlist?.trackIds ?? [];
      const needle = query.trim().toLocaleLowerCase();
      const tracks = ids.flatMap(id => { const track = byId.get(id); return track ? [track] : []; })
        .filter(t => !needle || `${t.title} ${t.artist.name}`.toLocaleLowerCase().includes(needle));
      return tracks.sort((a, b) => sort === 'added' ? b.addedAt - a.addedAt : sort === 'duration' ? a.duration - b.duration :
        sort === 'title' ? a.title.localeCompare(b.title) : a.artist.name.localeCompare(b.artist.name));
    },
    setLiked(id, liked) {
      if (!byId.has(id)) return;
      snapshot = { ...snapshot, tracks: snapshot.tracks.map(t => t.id === id ? { ...t, liked } : t),
        playlists: snapshot.playlists.map(p => p.kind !== 'liked' ? p : { ...p, trackIds: liked ? [...new Set([id, ...p.trackIds])] : p.trackIds.filter(t => t !== id) }) };
      emit();
    },
    addToPlaylist(playlistId, trackId) {
      if (!byId.has(trackId)) return;
      if (playlistId === 'liked') { this.setLiked(trackId, true); return; }
      snapshot = { ...snapshot, playlists: snapshot.playlists.map(p => p.id !== playlistId ? p : { ...p, trackIds: [...new Set([...p.trackIds, trackId])] }) };
      emit();
    },
    createPlaylist(title) {
      const id = `playlist-${++sequence}`;
      snapshot = { ...snapshot, playlists: [...snapshot.playlists, { id, title: title.trim().slice(0, 160), trackIds: [], artwork: { seed: sequence % 100, variant: 'ribbon' }, kind: 'playlist' }] }; emit(); return id;
    },
    removeFromPlaylist(playlistId, trackId) {
      if (playlistId === 'liked') return this.setLiked(trackId, false);
      snapshot = { ...snapshot, playlists: snapshot.playlists.map(p => p.id === playlistId ? { ...p, trackIds: p.trackIds.filter(id => id !== trackId) } : p) }; emit();
    },
    deletePlaylist(playlistId) { snapshot = { ...snapshot, playlists: snapshot.playlists.filter(p => p.id !== playlistId || p.kind === 'liked') }; emit(); },
    addTracks(tracks) { const updates = new Map(tracks.map(track => [track.id, track])); snapshot = { ...snapshot, tracks: [...snapshot.tracks.map(track => updates.get(track.id) ?? track), ...tracks.filter(track => !byId.has(track.id))] }; emit(); },
    recordPlay(id) { snapshot = { ...snapshot, history: [id, ...snapshot.history.filter(trackId => trackId !== id)].slice(0, 100) }; emit(); },
    setDownloaded(id, downloaded) {
      snapshot = { ...snapshot, tracks: snapshot.tracks.map(t => t.id === id ? { ...t, downloaded } : t) }; emit();
    },
    async resolvePlayback(id) {
      const track = byId.get(id); if (!track) return { source: null };
      if (!environment?.getSnapshot().online && environment && !track.downloaded) return { source: null };
      if (environment?.getSnapshot().scenario === 'unavailable' && !track.downloaded) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const source = track.sources[0];
        // Explicit mock outcomes: SC matches an alternate full stream; YT misses.
        if (source?.kind === 'sc') return { source: { kind: 'yt', externalId: `alternate-${id}` }, switchedFrom: 'sc' };
        if (source?.kind !== 'local') return { source: null };
      }
      return { source: track.sources[0] ?? null };
    },
    async getWaveform(id) {
      const track = byId.get(id); if (!track) return null;
      if (!waves.has(id)) {
        if (waves.size >= 64) waves.delete(waves.keys().next().value!);
        waves.set(id, { samples: generateWaveform(track.artwork.seed) });
      }
      return waves.get(id)!;
    },
    async search(query, filters: SearchFilters) {
      if (environment?.getSnapshot().scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 1600));
      if (environment?.getSnapshot().error) throw new Error('Search unavailable');
      const needle = query.trim().toLocaleLowerCase();
      // Generated stress-test records stay in the library; discovery uses the 42 curated mocks.
      const candidates = view().tracks.filter(t => t.id.startsWith('track-') && (filters.source === 'all' || t.sources.some(s => s.kind === filters.source)));
      const tracks = candidates.filter(t => !needle || `${t.title} ${t.artist.name}`.toLocaleLowerCase().includes(needle));
      const artists = [...new Map(candidates.map(t => [t.artist.id, t.artist])).values()].filter(a => !needle || a.name.toLocaleLowerCase().includes(needle));
      const playlists = snapshot.playlists.filter(p => !needle || `${p.title} ${p.id} ${p.titleKey === 'nav.liked' ? 'Мне нравится Liked' : p.id === 'focus' ? 'Фон Focus' : p.id === 'night' ? 'Ночной Night' : p.id === 'road' ? 'В пути On the road' : 'Тише Slow down'}`.toLocaleLowerCase().includes(needle))
        .filter(p => filters.source === 'all' || p.trackIds.some(id => byId.get(id)?.sources.some(s => s.kind === filters.source)));
      return { tracks, artists, playlists };
    },
    getRecent: () => recent,
    remember(query) { const value = query.trim().slice(0, 100); if (value) recent = [value, ...recent.filter(q => q !== value)].slice(0, 6); },
    clearRecent() { recent = []; },
  };
}
