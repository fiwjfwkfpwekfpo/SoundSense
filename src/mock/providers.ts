import type { ImportApi, LibraryApi, LyricsApi, SearchApi } from '../core/api';
import type { EnvironmentApi } from '../core/environment';
import type { Extensions } from '../core/runtime';
import { parseMusicLink } from '../core/links';
/** Built-ins use exactly the public registry contract; their implementations are mocks. */
export function registerBuiltInProviders(registries: Extensions, library: LibraryApi & SearchApi, lyrics: LyricsApi, imports: ImportApi, environment: EnvironmentApi): () => void {
  const dispose: (() => void)[] = [];
  const rawSearch = library.search.bind(library), runImport = imports.start.bind(imports);
  for (const kind of ['sc', 'yt', 'ya', 'local'] as const) dispose.push(registries.sources.register({
    id: kind, titleKey: `source.${kind}`,
    search(query, filters, signal) { return rawSearch(query, { ...filters, source: kind }, signal); },
    async getTrack(id) { const track = library.getTrack(id); return track?.sources.some(source => source.kind === kind) ? track : undefined; },
    async resolveStream(track) {
      const state = environment.getSnapshot();
      if (!state.online && !track.downloaded) return null;
      const original = track.sources[0];
      if (state.scenario === 'unavailable' && !track.downloaded && kind !== 'local') {
        if (original?.kind === 'sc' && kind === 'yt') return { uri: `mock:yt:alternate-${track.id}`, source: { kind, externalId: `alternate-${track.id}` } };
        return null;
      }
      const source = track.sources.find(source => source.kind === kind);
      return source ? { uri: `mock:${kind}:${source.externalId}`, source } : null;
    },
    parseLink(text) { const link = parseMusicLink(text); return link?.source === kind ? link : null; },
  }));
  dispose.push(registries.lyrics.register({ id: 'lrclib', titleKey: 'provider.lrclib', find: (id, signal) => lyrics.getLyrics(id, signal) }));
  dispose.push(registries.lyrics.register({ id: 'ya', titleKey: 'source.ya', find: (id, signal) => lyrics.getLyrics(id, signal) }));
  for (const source of ['sc', 'yt', 'ytm', 'ya', 'spotify', 'local'] as const) dispose.push(registries.imports.register({ id: source, titleKey: `source.${source}`, accepts: request => request.source === source, run: runImport }));
  return () => dispose.reverse().forEach(fn => fn());
}
