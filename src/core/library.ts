import type { LibraryApi, SearchApi } from './api';
import type { LibrarySnapshot, Track, TrackSort, Waveform } from './types';

export const LIBRARY_STORAGE_KEY = 'ss_library_v2', LIBRARY_META_KEY = 'ss_library_meta_v1';
const idle = (callback: () => void): void => { const request = (globalThis as { requestIdleCallback?: (fn: () => void, options: { timeout: number }) => number }).requestIdleCallback; if (request) request(callback, { timeout: 2000 }); else callback(); };
const fingerprintSeed = (id: string) => { let hash = 0; for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0; return Math.abs(hash) % 1000; };
export function createLibrary(storage?: Pick<Storage, 'getItem' | 'setItem'>): LibraryApi & SearchApi & { flush(): void; dispose(): void } {
  let snapshot: LibrarySnapshot = { tracks: [], playlists: [{ id: 'liked', title: '', titleKey: 'nav.liked', trackIds: [], artwork: { seed: 0, variant: 'ribbon' }, kind: 'liked' }], recommendations: [], history: [] };
  let recent: string[] = [], plays: Record<string, number> = {};
  try {
    const saved = JSON.parse(storage?.getItem(LIBRARY_STORAGE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.tracks) && Array.isArray(saved.playlists)) {
      const tracks: Track[] = saved.tracks.filter((track: Track) => track && typeof track.id === 'string' && typeof track.title === 'string' && typeof track.artist?.name === 'string' && Number.isFinite(track.duration) && track.duration >= 0 && Array.isArray(track.sources) && track.sources.length && (track.duration > 0 || !track.sources.some(source => source.kind === 'local')) && track.artwork);
      const ids = new Set(tracks.map(track => track.id));
      const playlists = saved.playlists.filter((playlist: { id?: string; trackIds?: unknown }) => playlist && typeof playlist.id === 'string' && Array.isArray(playlist.trackIds));
      snapshot = { tracks, playlists: [snapshot.playlists[0]!, ...playlists.filter((playlist: { id: string }) => playlist.id !== 'liked')].map(playlist => ({ ...playlist, trackIds: playlist.id === 'liked' ? tracks.filter(track => track.liked).map(track => track.id) : playlist.trackIds.filter((id: string) => ids.has(id)) })), recommendations: [], history: Array.isArray(saved.history) ? saved.history.filter((id: string) => ids.has(id)) : [] };
      recent = Array.isArray(saved.recent) ? saved.recent.filter((q: unknown) => typeof q === 'string').slice(0, 6) : [];
      // History and recent searches change on every track; they live in a small key.
      const meta = JSON.parse(storage?.getItem(LIBRARY_META_KEY) ?? 'null');
      if (meta && Array.isArray(meta.history)) snapshot = { ...snapshot, history: meta.history.filter((id: unknown) => typeof id === 'string' && ids.has(id)) };
      if (meta && Array.isArray(meta.recent)) recent = meta.recent.filter((q: unknown) => typeof q === 'string').slice(0, 6);
      if (meta && meta.plays && typeof meta.plays === 'object') for (const [id, count] of Object.entries(meta.plays)) if (ids.has(id) && Number.isInteger(count) && (count as number) > 0) plays[id] = count as number;
      if (meta && Array.isArray(meta.recommendations)) snapshot = { ...snapshot, recommendations: meta.recommendations.filter((id: unknown) => typeof id === 'string' && ids.has(id)).slice(0, 100) };
    }
  } catch { /* A damaged snapshot must not inject demo data or prevent startup. */ }
  let byId = new Map(snapshot.tracks.map(track => [track.id, track]));
  let sequence = Date.now(), saveTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(value: LibrarySnapshot) => void>();
  const waves = new Map<string, Waveform>();
  let dirtyMain = false, dirtyMeta = false;
  function flush() {
    clearTimeout(saveTimer); saveTimer = undefined;
    const main = dirtyMain;
    if (dirtyMain) { storage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ ...snapshot, history: [], recent: [], recommendations: [] })); dirtyMain = false; }
    if (dirtyMeta || main) { storage?.setItem(LIBRARY_META_KEY, JSON.stringify({ history: snapshot.history, recent, plays, recommendations: snapshot.recommendations })); dirtyMeta = false; }
  }
  function save(main = true) {
    if (main) dirtyMain = true; else dirtyMeta = true;
    if (!storage || saveTimer) return;
    // The full library is large: coalesce bursts and serialize when the UI is idle.
    saveTimer = setTimeout(() => idle(() => { saveTimer = undefined; try { flush(); } catch { /* Retry at the next mutation or explicit flush. */ } }), main ? 1200 : 2500);
  }
  function emit(reindex = true, main = true) { if (reindex) byId = new Map(snapshot.tracks.map(track => [track.id, track])); save(main); for (const listener of listeners) listener(snapshot); }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getTrack: id => byId.get(id),
    getPlaylistTracks(id, query = '', sort: TrackSort = 'added') {
      const needle = query.trim().toLocaleLowerCase();
      return (snapshot.playlists.find(playlist => playlist.id === id)?.trackIds ?? []).flatMap(id => { const track = byId.get(id); return track && (!needle || `${track.title} ${track.artist.name}`.toLocaleLowerCase().includes(needle)) ? [track] : []; })
        .sort((a, b) => sort === 'added' ? b.addedAt - a.addedAt : sort === 'duration' ? a.duration - b.duration : sort === 'title' ? a.title.localeCompare(b.title) : a.artist.name.localeCompare(b.artist.name));
    },
    setLiked(id, liked) {
      if (!byId.has(id)) return;
      snapshot = { ...snapshot, tracks: snapshot.tracks.map(track => track.id === id ? { ...track, liked } : track), playlists: snapshot.playlists.map(playlist => playlist.id === 'liked' ? { ...playlist, trackIds: liked ? [...new Set([id, ...playlist.trackIds])] : playlist.trackIds.filter(item => item !== id) } : playlist) }; emit();
    },
    addToPlaylist(playlistId, trackId) {
      if (!byId.has(trackId)) return;
      if (playlistId === 'liked') { this.setLiked(trackId, true); return; }
      snapshot = { ...snapshot, playlists: snapshot.playlists.map(playlist => playlist.id === playlistId ? { ...playlist, trackIds: [...new Set([...playlist.trackIds, trackId])] } : playlist) }; emit(false);
    },
    addToPlaylistBatch(playlistId, trackIds) {
      const ids = trackIds.filter(id => byId.has(id));
      if (playlistId === 'liked') { const selected = new Set(ids); snapshot = { ...snapshot, tracks: snapshot.tracks.map(track => selected.has(track.id) ? { ...track, liked: true } : track) }; }
      snapshot = { ...snapshot, playlists: snapshot.playlists.map(playlist => playlist.id === playlistId ? { ...playlist, trackIds: [...new Set([...playlist.trackIds, ...ids])] } : playlist) }; emit(playlistId === 'liked');
    },
    createPlaylist(title) {
      const id = `playlist-${++sequence}`;
      snapshot = { ...snapshot, playlists: [...snapshot.playlists, { id, title: title.trim().slice(0, 160), trackIds: [], artwork: { seed: sequence % 1000, variant: 'ribbon' }, kind: 'playlist' }] }; emit(false); return id;
    },
    removeFromPlaylist(playlistId, trackId) {
      if (playlistId === 'liked') { this.setLiked(trackId, false); return; }
      snapshot = { ...snapshot, playlists: snapshot.playlists.map(playlist => playlist.id === playlistId ? { ...playlist, trackIds: playlist.trackIds.filter(id => id !== trackId) } : playlist) }; emit(false);
    },
    deletePlaylist(id) { if (id === 'liked') return; snapshot = { ...snapshot, playlists: snapshot.playlists.filter(playlist => playlist.id !== id) }; emit(false); },
    addTracks(tracks) {
      const merged = new Map(byId);
      for (const track of tracks) { const old = merged.get(track.id); merged.set(track.id, old ? { ...track, duration: track.duration || old.duration, sources: [...new Map([...old.sources, ...track.sources].map(source => [`${source.kind}:${source.externalId}`, source])).values()], liked: old.liked, downloaded: old.downloaded, addedAt: old.addedAt } : track); }
      snapshot = { ...snapshot, tracks: [...merged.values()] }; emit();
    },
    recordPlay(id) {
      if (!byId.has(id) || snapshot.history[0] === id) return;
      plays[id] = (plays[id] ?? 0) + 1;
      const keys = Object.keys(plays); if (keys.length > 2000) for (const key of keys.slice(0, keys.length - 2000)) delete plays[key];
      snapshot = { ...snapshot, history: [id, ...snapshot.history.filter(item => item !== id)].slice(0, 100) }; emit(false, false);
    },
    getPlayCounts: () => plays,
    setRecommendations(ids) { snapshot = { ...snapshot, recommendations: [...new Set(ids.filter(id => byId.has(id)))].slice(0, 100) }; emit(false, false); },
    setDownloaded(id, downloaded) { snapshot = { ...snapshot, tracks: snapshot.tracks.map(track => track.id === id ? { ...track, downloaded } : track) }; emit(); },
    setDownloadedBatch(updates) {
      const states = new Map(updates.map(update => [update.id, update.downloaded]));
      if (!snapshot.tracks.some(track => states.has(track.id) && states.get(track.id) !== track.downloaded)) return;
      snapshot = { ...snapshot, tracks: snapshot.tracks.map(track => states.has(track.id) && states.get(track.id) !== track.downloaded ? { ...track, downloaded: states.get(track.id)! } : track) }; emit();
    },
    applyRemote(changes) {
      let tracks = snapshot.tracks, playlists = snapshot.playlists, history = snapshot.history;
      if (changes.tracks?.length) {
        // New tracks arrive as not downloaded; known tracks keep their local state and sources.
        const merged = new Map(tracks.map(track => [track.id, track]));
        for (const track of changes.tracks) { const old = merged.get(track.id); merged.set(track.id, old ? { ...old, title: track.title, artist: track.artist, duration: old.duration || track.duration, artwork: track.artwork, sources: [...new Map([...old.sources, ...track.sources].map(source => [`${source.kind}:${source.externalId}`, source])).values()] } : { ...track, liked: false, downloaded: false }); }
        tracks = [...merged.values()];
      }
      const known = new Set(tracks.map(track => track.id));
      if (changes.liked) {
        const add = changes.liked.add.filter(id => known.has(id)), remove = new Set(changes.liked.remove), adding = new Set(add);
        tracks = tracks.map(track => adding.has(track.id) && !track.liked ? { ...track, liked: true } : remove.has(track.id) && track.liked ? { ...track, liked: false } : track);
        playlists = playlists.map(playlist => playlist.id === 'liked' ? { ...playlist, trackIds: [...new Set([...add, ...playlist.trackIds])].filter(id => !remove.has(id)) } : playlist);
      }
      if (changes.playlists) {
        const removed = new Set(changes.playlists.remove), upserts = new Map(changes.playlists.upsert.map(item => [item.id, item]));
        playlists = playlists.filter(playlist => playlist.id === 'liked' || !removed.has(playlist.id)).map(playlist => {
          const next = upserts.get(playlist.id); if (!next) return playlist; upserts.delete(playlist.id);
          // Tracks that exist only on this device (local files) are not synced: keep them.
          const own = playlist.trackIds.filter(id => !next.trackIds.includes(id) && changes.deviceOnly?.(id));
          return { ...playlist, title: next.title, trackIds: [...next.trackIds.filter(id => known.has(id)), ...own] };
        });
        for (const next of upserts.values()) playlists = [...playlists, { id: next.id, title: next.title, trackIds: next.trackIds.filter(id => known.has(id)), artwork: { seed: fingerprintSeed(next.id), variant: 'ribbon' }, kind: 'playlist' }];
      }
      if (changes.history) history = changes.history.filter(id => known.has(id)).slice(0, 100);
      snapshot = { ...snapshot, tracks, playlists, history }; emit(true, true); save(false);
    },
    async resolvePlayback(id) { const source = byId.get(id)?.sources.find(source => source.kind === 'local'); return { source: source ?? null, ...(source ? { uri: source.externalId } : {}) }; },
    async getWaveform(id) { return waves.get(id) ?? null; },
    async search(query, filters) {
      const needle = query.trim().toLocaleLowerCase();
      const tracks = snapshot.tracks.filter(track => (!needle || `${track.title} ${track.artist.name}`.toLocaleLowerCase().includes(needle)) && (filters.source === 'all' || track.sources.some(source => source.kind === filters.source)));
      return { tracks, artists: [...new Map(tracks.map(track => [track.artist.id, track.artist])).values()], playlists: snapshot.playlists.filter(playlist => `${playlist.title}`.toLocaleLowerCase().includes(needle)) };
    },
    getRecent: () => recent,
    remember(query) { const value = query.trim().slice(0, 100); if (value) { recent = [value, ...recent.filter(q => q !== value)].slice(0, 6); save(false); } },
    clearRecent() { recent = []; save(false); },
    flush,
    dispose() { try { flush(); } catch { /* Storage can become unavailable while closing. */ } listeners.clear(); },
  };
}
