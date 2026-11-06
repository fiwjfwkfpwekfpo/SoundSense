import type { ImportApi, LibraryApi } from '../core/api';
import type { EnvironmentApi } from '../core/environment';
import type { ImportCollection, ImportJob, ImportIssue, ImportResult, ImportTrack } from '../core/imports';
import { ImportFailure, importErrorKinds } from '../core/imports';
import { matchTrack } from '../core/matching';
import { STORAGE_KEYS } from '../core/storage';
export function createImports(library: LibraryApi, environment: EnvironmentApi, storage?: Pick<Storage, 'getItem' | 'setItem'>): ImportApi {
  let job: ImportJob | null = null, timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
  let destinations: Record<string, string> = {};
  try { const saved = JSON.parse(storage?.getItem(STORAGE_KEYS.imports) ?? '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) destinations = saved as Record<string, string>; } catch { /* Session fallback. */ }
  const listeners = new Set<(job: ImportJob | null) => void>();
  const emit = () => listeners.forEach(fn => fn(job));
  const curated = () => library.getSnapshot().tracks.filter(track => track.id.startsWith('track-')).slice(0, 30);
  const metadata = (): ImportTrack[] => curated().map(track => ({ id: track.id, title: track.title, artist: track.artist.name, duration: track.duration }));
  function demoTracks(): ImportTrack[] {
    const data = metadata().slice(0, 10);
    return [...data.slice(0, 6), ...data.slice(6, 8).map(track => ({ ...track, id: `uncertain-${track.id}`, duration: track.duration! + 9 })),
      { id: 'missing-1', title: 'Unreleased midnight', artist: 'Unknown artist' }, { id: 'missing-2', title: 'Архивная запись', artist: 'Неизвестный исполнитель' },
      { id: 'deleted', title: 'Lost tape', artist: 'Archive', unavailable: 'deleted' }, { id: 'preview', title: 'Private demo', artist: 'Archive', unavailable: 'preview' }];
  }
  function finish(tracks: readonly ImportTrack[]) {
    if (!job) return;
    const request = job.request;
    const fingerprint = request.link?.url ?? request.collections?.map(collection => collection.id).sort().join('|') ?? request.source;
    let playlistId = request.destination;
    if (playlistId === 'new') {
      const saved = destinations[fingerprint];
      playlistId = saved && library.getSnapshot().playlists.some(playlist => playlist.id === saved) ? saved : library.createPlaylist(request.title);
      destinations[fingerprint] = playlistId;
      try { storage?.setItem(STORAGE_KEYS.imports, JSON.stringify(destinations)); } catch { /* Memory remains usable. */ }
    }
    const missing: ImportIssue[] = [], uncertain: ImportIssue[] = [], unavailable: ImportIssue[] = [];
    const ids = new Set(library.getPlaylistTracks(playlistId).map(track => track.id));
    let added = 0, existing = 0;
    for (const original of tracks) {
      if (original.unavailable) { unavailable.push({ original, reason: original.unavailable }); continue; }
      if (request.source === 'local') {
        const id = `local-${original.id}`;
        library.addTracks([{ id, title: original.title, artist: { id: `artist-${original.artist}`, name: original.artist, artwork: { seed: 3, variant: 'haze' } }, artwork: { seed: 3, variant: 'haze' }, duration: original.duration ?? 180, sources: [{ kind: 'local', externalId: original.id }], liked: false, downloaded: true, explicit: false, addedAt: Date.now() }]);
        if (ids.has(id)) existing++; else { library.addToPlaylist(playlistId, id); ids.add(id); added++; } continue;
      }
      const match = matchTrack(original, metadata());
      if (match.kind === 'missing' || !match.candidate) missing.push({ original });
      else if (match.kind === 'uncertain') uncertain.push({ original, candidateId: match.candidate.id, confidence: match.confidence, alternatives: metadata().filter(track => track.id !== match.candidate?.id).slice(0, 3).map(track => track.id) });
      else if (ids.has(match.candidate.id)) existing++;
      else { library.addToPlaylist(playlistId, match.candidate.id); ids.add(match.candidate.id); added++; }
    }
    const result: ImportResult = { total: tracks.length, imported: added + existing, added, existing, playlistId, missing, uncertain, unavailable };
    job = { ...job, phase: 'done', completed: tracks.length, total: tracks.length, result }; emit();
  }
  function schedule(tracks: readonly ImportTrack[], phase: 'fetching' | 'matching' | 'scanning') {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!job || job.phase === 'cancelled') return;
      if (!environment.getSnapshot().online && job.request.source !== 'local' && job.request.source !== 'spotify') { fail(new ImportFailure('offline')); return; }
      const next = Math.min(tracks.length, job.completed + Math.max(1, Math.ceil(tracks.length / 5)));
      job = { ...job, completed: next }; emit();
      if (next < tracks.length) schedule(tracks, phase);
      else if (phase === 'fetching' && ['ya', 'spotify'].includes(job.request.source)) { job = { ...job, phase: 'matching', completed: 0 }; emit(); schedule(tracks, 'matching'); }
      else finish(tracks);
    }, 240);
  }
  function fail(error: ImportFailure) {
    if (!job) return;
    clearTimeout(timer); job = { ...job, phase: 'error', error, retryIn: error.kind === 'rate_limit' ? error.retryAfter : undefined }; emit();
    if (error.kind === 'rate_limit') {
      const countdown = () => { timer = setTimeout(() => {
        if (!job || job.phase !== 'error' || job.error?.kind !== 'rate_limit') return;
        job = { ...job, retryIn: Math.max(0, (job.retryIn ?? 1) - 1) }; emit();
        if (!job.retryIn) api.retry(); else countdown();
      }, 1000); }; countdown();
    }
  }
  function run() {
    if (!job) return;
    const scenario = environment.getSnapshot().scenario;
    const error = scenario.startsWith('import-') ? scenario.slice(7) : '';
    if (attempts === 0 && importErrorKinds.includes(error as never)) { fail(new ImportFailure(error as typeof importErrorKinds[number])); return; }
    if (!environment.getSnapshot().online && !['local', 'spotify'].includes(job.request.source)) { fail(new ImportFailure('offline')); return; }
    const tracks = job.request.collections?.flatMap(collection => [...collection.tracks]) ?? demoTracks();
    if (!tracks.length) { fail(new ImportFailure('empty')); return; }
    const phase = job.request.source === 'local' ? 'scanning' : 'fetching';
    job = { ...job, phase, completed: 0, total: tracks.length, error: undefined, retryIn: undefined }; emit(); schedule(tracks, phase);
  }
  const unsubscribe = environment.subscribe(state => { if (state.online && job?.phase === 'error' && job.error?.kind === 'offline') api.retry(); });
  const api: ImportApi = {
    getSnapshot: () => job,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start(request) { clearTimeout(timer); attempts = 0; job = { id: `import-${Date.now()}`, request, phase: 'fetching', completed: 0, total: 0 }; emit(); timer = setTimeout(run, 100); },
    retry() { if (job) { attempts++; run(); } },
    cancel() { clearTimeout(timer); if (job) { job = { ...job, phase: 'cancelled' }; emit(); } },
    resolve(index, candidateId, kind = 'uncertain') {
      if (!job?.result) return;
      const result = job.result, issue = result[kind][index];
      if (!issue || issue.resolved || candidateId && !library.getTrack(candidateId)) return;
      const exists = candidateId ? library.getPlaylistTracks(result.playlistId).some(track => track.id === candidateId) : false;
      if (candidateId) library.addToPlaylist(result.playlistId, candidateId);
      job = { ...job, result: { ...result, imported: result.imported + (candidateId ? 1 : 0), added: result.added + (candidateId && !exists ? 1 : 0), existing: result.existing + (candidateId && exists ? 1 : 0),
        [kind]: result[kind].map((item, i) => i === index ? { ...item, candidateId: candidateId ?? undefined, resolved: candidateId ? 'accepted' : 'skipped' } : item) } }; emit();
    },
    async authorize() { await new Promise(resolve => setTimeout(resolve, 450)); },
    async loginYandex() {
      await new Promise(resolve => setTimeout(resolve, 500));
      return [{ id: 'ya-likes', title: 'Мне нравится', liked: true, tracks: demoTracks() }, { id: 'ya-night', title: 'Ночной плейлист', tracks: demoTracks().slice(0, 6) }];
    },
    async resolveLink(link) { return link.kind === 'short' ? { ...link, kind: 'track', id: `resolved-${link.id}` } : link; },
    async openTrack(link) {
      const id = `link-${link.source}-${link.id.replace(/[^\w-]/g, '-')}`;
      if (!library.getTrack(id)) {
        const model = curated()[0]!;
        library.addTracks([{ ...model, id, title: link.id.split('/').at(-1)!.replaceAll('-', ' '), artist: { ...model.artist, name: link.user ?? model.artist.name }, sources: [{ kind: link.source, externalId: link.id }], liked: false, downloaded: false }]);
      }
      return id;
    },
    dispose() { clearTimeout(timer); listeners.clear(); unsubscribe(); },
  };
  return api;
}
