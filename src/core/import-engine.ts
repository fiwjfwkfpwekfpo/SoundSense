import type { ImportApi, LibraryApi } from './api';
import type { EnvironmentApi } from './environment';
import { classifyImportError, ImportFailure } from './imports';
import type { ImportChoice, ImportCollection, ImportIssue, ImportJob, ImportRequest, ImportSource, ImportTrack } from './imports';
import type { MusicLink } from './links';
import { matchTrack, recordingIdentity } from './matching';
import type { Track } from './types';
import { localId } from './local';

export interface ImportServices {
  resolveLink(link: MusicLink, signal?: AbortSignal): Promise<MusicLink>;
  getTrack(link: MusicLink, signal?: AbortSignal): Promise<Track>;
  getCollection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection>;
  find(original: ImportTrack, signal?: AbortSignal): Promise<readonly Track[]>;
  inspect?(source: ImportSource, link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]>;
  authorize?(source: ImportSource): Promise<void>;
}
export function createImports(library: LibraryApi, environment: EnvironmentApi, services: ImportServices, storage?: Pick<Storage, 'getItem' | 'setItem'>): ImportApi {
  let job: ImportJob | null = null, controller: AbortController | undefined, disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, retries = 0;
  let destinations: Record<string, string> = {};
  try { const saved = JSON.parse(storage?.getItem('ss_import_destinations_v2') ?? '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) destinations = saved; } catch { /* Session-only destination hints. */ }
  const listeners = new Set<(value: ImportJob | null) => void>();
  function emit() { for (const listener of listeners) listener(job); }
  const metadata = (track: Track): ImportTrack => ({ id: track.id, title: track.title, artist: track.artist.name, duration: track.duration });
  async function run(request: ImportRequest) {
    clearTimeout(retryTimer);
    controller?.abort(); const current = controller = new AbortController(), signal = current.signal;
    job = { id: `import-${Date.now()}`, request, phase: request.source === 'local' ? 'scanning' : 'fetching', completed: 0, total: 0 }; emit();
    try {
      let collections = request.collections;
      if (!collections && request.selections?.length) {
        const loaded = new Array<ImportCollection>(request.selections.length); let selectedIndex = 0, complete = 0;
        job = { ...job!, total: request.selections.length }; emit();
        await Promise.all(Array.from({ length: Math.min(3, request.selections.length) }, async () => {
          while (selectedIndex < request.selections!.length) { const index = selectedIndex++, selected = request.selections![index]!; signal.throwIfAborted(); loaded[index] = { ...await services.getCollection(selected.link, signal), id: selected.id, title: selected.title, liked: selected.liked }; if (controller === current && !signal.aborted) { job = { ...job!, completed: ++complete }; emit(); } }
        }));
        collections = loaded;
      }
      collections ??= request.link ? [await services.getCollection(await services.resolveLink(request.link, signal), signal)] : [];
      signal.throwIfAborted();
      const originals = [...new Map(collections.flatMap(collection => collection.tracks).map(track => [track.id, track])).values()];
      if (!originals.length) throw new ImportFailure('empty');
      const matched = new Map<string, Track>(), review: Track[] = [], missing: ImportIssue[] = [], uncertain: ImportIssue[] = [], unavailable: ImportIssue[] = [];
      const identities = new Map<string, Track[]>();
      const keyFor = (track: Track) => { const identity = recordingIdentity({ title: track.title, artist: track.artist.name }); return identity.title && identity.artist ? `${identity.title}\0${identity.artist}` : ''; };
      for (const track of library.getSnapshot().tracks) if (!track.sources.some(source => source.kind === 'local')) { const key = keyFor(track); if (key) identities.set(key, [...identities.get(key) ?? [], track]); }
      const accept = (original: ImportTrack, track: Track) => {
        const key = keyFor(track), candidates = key && !track.sources.some(source => source.kind === 'local') ? identities.get(key) ?? [] : [];
        const same = candidates.find(candidate => candidate.id === track.id || candidate.duration > 0 && track.duration > 0 && Math.abs(candidate.duration - track.duration) <= 1);
        if (same) {
          const sources = [...new Map([...same.sources, ...track.sources].map(source => [`${source.kind}:${source.externalId}`, source])).values()];
          track = { ...same, sources };
        }
        matched.set(original.id, track);
        if (key && !track.sources.some(source => source.kind === 'local')) identities.set(key, [...candidates.filter(candidate => candidate.id !== track.id), track]);
      };
      job = { ...job!, total: originals.length, phase: request.source === 'local' ? 'scanning' : 'matching' }; emit();
      for (let index = 0; index < originals.length; index++) {
        signal.throwIfAborted(); const original = originals[index]!;
        if (original.unavailable) unavailable.push({ original, reason: original.unavailable });
        else if (original.track) accept(original, original.track);
        else {
          const candidates = await services.find(original, signal);
          signal.throwIfAborted();
          const match = matchTrack(original, candidates.map(metadata));
          if (!match.candidate || match.kind === 'missing') missing.push({ original });
          else {
            // Alternatives remain available to the manual review screen, never silently accepted.
            if (match.kind === 'uncertain') { review.push(...candidates); uncertain.push({ original, candidateId: match.candidate.id, confidence: match.confidence, alternatives: candidates.filter(track => track.id !== match.candidate!.id).map(track => track.id) }); }
            else accept(original, candidates.find(track => track.id === match.candidate!.id)!);
          }
        }
        if (index % 40 === 39 || index === originals.length - 1) { job = { ...job!, completed: index + 1 }; emit(); }
        if (index % 40 === 39) await new Promise(resolve => setTimeout(resolve, 0));
      }
      signal.throwIfAborted(); if (disposed || controller !== current) return;
      const destinationFor = (choice: ImportCollection, separate: boolean) => {
        if (separate && choice.liked) return 'liked';
        if (!separate && request.destination !== 'new') return request.destination;
        const fingerprint = separate ? `${request.source}:${choice.id}` : request.link?.url ?? localId(`${request.source}:${originals.map(track => track.id).sort().join('|')}`);
        const previous = destinations[fingerprint];
        const id = previous && library.getSnapshot().playlists.some(playlist => playlist.id === previous) ? previous : library.createPlaylist(separate ? choice.title : request.title);
        destinations[fingerprint] = id; return id;
      };
      const grouped = request.destination === 'separate' ? collections : [{ id: 'merged', title: request.title, tracks: originals }];
      const memberships = new Map<string, Set<string>>(), newIds = new Set<string>();
      const targets = grouped.map(choice => {
        const playlistId = destinationFor(choice, request.destination === 'separate'), previous = new Set(library.getPlaylistTracks(playlistId).map(track => track.id));
        for (const original of choice.tracks) { const ids = memberships.get(original.id) ?? new Set(); ids.add(playlistId); memberships.set(original.id, ids); }
        const ids = [...new Set(choice.tracks.flatMap(original => matched.get(original.id)?.id ?? []))];
        for (const id of ids) if (!previous.has(id)) newIds.add(id);
        return { id: choice.id, title: choice.title, playlistId, ids, imported: ids.length, added: ids.filter(id => !previous.has(id)).length, existing: ids.filter(id => previous.has(id)).length };
      });
      const playlistId = targets[0]?.playlistId ?? 'liked', ids = [...new Set([...matched.values()].map(track => track.id))], existing = ids.filter(id => !newIds.has(id)).length;
      try { storage?.setItem('ss_import_destinations_v2', JSON.stringify(destinations)); } catch { /* A failed hint write cannot discard an import. */ }
      const addedAt = Date.now();
      // One import is one insertion batch. Equal timestamps preserve the source
      // order under the default stable "added" sort, including short local files.
      library.addTracks([...matched.values(), ...review].map(track => ({ ...track, addedAt })));
      for (const target of targets) { if (library.addToPlaylistBatch) library.addToPlaylistBatch(target.playlistId, target.ids); else for (const id of target.ids) library.addToPlaylist(target.playlistId, id); }
      const scoped = (issues: readonly ImportIssue[]) => issues.map(issue => ({ ...issue, destinations: [...memberships.get(issue.original.id) ?? [playlistId]] }));
      job = { ...job!, phase: 'done', result: { total: originals.length, imported: ids.length, added: ids.length - existing, existing, playlistId, missing: scoped(missing), uncertain: scoped(uncertain), unavailable: scoped(unavailable), duplicates: matched.size - ids.length, collections: targets.map(({ ids: _ids, ...target }) => target) } }; emit();
    } catch (error) {
      if (signal.aborted || disposed || controller !== current) return;
      const failure = classifyImportError(error);
      const seconds = failure.kind === 'rate_limit' ? Math.min(300, failure.retryAfter * 2 ** Math.min(retries++, 6)) : undefined;
      current.abort(); job = { ...job!, phase: 'error', error: failure, retryIn: seconds }; emit();
      if (seconds) {
        const countdown = () => { retryTimer = setTimeout(() => { if (disposed || controller !== current || job?.phase !== 'error') return; const remaining = Math.max(0, (job.retryIn ?? 1) - 1); job = { ...job, retryIn: remaining }; emit(); if (remaining) countdown(); else void run(request); }, 1000); };
        countdown();
      }
    }
  }
  const unsubscribe = environment.subscribe(state => { if (state.online && job?.phase === 'error' && job.error?.kind === 'offline') api.retry(); });
  const api: ImportApi = {
    getSnapshot: () => job, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start(request) { retries = 0; void run(request); }, retry() { retries = 0; if (job) void run(job.request); },
    cancel() { clearTimeout(retryTimer); controller?.abort(); if (job) { job = { ...job, phase: 'cancelled' }; emit(); } },
    resolve(index, candidateId, kind = 'uncertain') {
      const result = job?.result, issue = result?.[kind][index];
      if (!result || !issue || issue.resolved || candidateId && !library.getTrack(candidateId)) return;
      const existing = candidateId && library.getPlaylistTracks(result.playlistId).some(track => track.id === candidateId);
      if (candidateId) for (const playlistId of issue.destinations ?? [result.playlistId]) library.addToPlaylist(playlistId, candidateId);
      job = { ...job!, result: { ...result, imported: result.imported + Number(!!candidateId), added: result.added + Number(!!candidateId && !existing), existing: result.existing + Number(!!existing), [kind]: result[kind].map((entry, i) => i === index ? { ...entry, resolved: candidateId ? 'accepted' : 'skipped', candidateId: candidateId ?? undefined } : entry) } }; emit();
    },
    async authorize(source) { if (!services.authorize) throw new ImportFailure('auth'); await services.authorize(source); },
    async loginYandex() { if (!services.authorize || !services.inspect) throw new ImportFailure('auth'); await services.authorize('ya'); const choices = await services.inspect('ya'); return Promise.all(choices.map(choice => services.getCollection(choice.link))); },
    ...(services.inspect ? { inspect: services.inspect } : {}),
    resolveLink: (link) => services.resolveLink(link),
    async openTrack(link) { const track = await services.getTrack(await services.resolveLink(link)); library.addTracks([track]); return track.id; },
    dispose() { disposed = true; clearTimeout(retryTimer); controller?.abort(); unsubscribe(); listeners.clear(); },
  };
  return api;
}
