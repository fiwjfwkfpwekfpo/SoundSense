import type { LibraryApi, SearchApi, ImportApi } from './api';
import type { Extensions } from './runtime';
import type { HttpClient } from './http';
import { getJson } from './http';
import { parseMusicLink } from './links';
import { recordingIdentity, samePlaybackRecording } from './matching';
import type { MusicService } from './music-service';

export function registerProviders(extensions: Extensions, library: LibraryApi & SearchApi, imports: Pick<ImportApi, 'start'>, services: readonly MusicService[], http: HttpClient): () => void {
  const dispose: (() => void)[] = [];
  dispose.push(extensions.sources.register({ id: 'local', titleKey: 'source.local', fallback: false, search: (query, filters, signal) => library.search(query, { ...filters, source: 'local' }, signal), getTrack: async id => library.getTrack(id), parseLink: () => null,
    async resolveStream(track) { const source = track.sources.find(source => source.kind === 'local'); return source ? { uri: source.externalId, source } : null; } }));
  const run = imports.start.bind(imports);
  dispose.push(extensions.imports.register({ id: 'local', titleKey: 'source.local', accepts: request => request.source === 'local', run }));
  for (const service of services) {
    dispose.push(extensions.imports.register({ id: service.id, titleKey: `source.${service.id}`, accepts: request => request.source === service.id, run, inspect: service.inspect, load: service.collection }));
    if (!service.search) continue;
    dispose.push(extensions.sources.register({ id: service.id, titleKey: `source.${service.id}`, supportsPlayback: !!service.stream, ...(['yt', 'ytm'].includes(service.id) ? { streamFamily: 'youtube' } : {}),
      async search(query, _filters, signal) { const found = await service.search!(query, signal); signal?.throwIfAborted(); library.addTracks(found.tracks); return found; },
      getTrack: service.getTrack,
      async resolveStream(original, signal) {
        if (!service.stream) return null;
        let track = original;
        const ownsSource = track.sources.some(source => source.kind === service.id || ['yt', 'ytm'].includes(service.id) && ['yt', 'ytm'].includes(source.kind));
        if (ownsSource && !track.duration) {
          const own = track.sources.find(source => source.kind === service.id || ['yt', 'ytm'].includes(service.id) && ['yt', 'ytm'].includes(source.kind))!;
          const detailed = await service.getTrack(own.externalId, signal);
          track = { ...track, duration: detailed.duration, artist: track.artist.name ? track.artist : detailed.artist };
        }
        if (!ownsSource) {
          if (track.sources.some(source => source.kind === 'local')) return null;
          const candidates = (await service.search!(`${track.artist.name} ${track.title}`, signal)).tracks;
          signal?.throwIfAborted();
          const metadata = { title: track.title, artist: track.artist.name, duration: track.duration }, identity = recordingIdentity(metadata);
          const matches = candidates.filter(candidate => {
            const other = { title: candidate.title, artist: candidate.artist.name, duration: candidate.duration };
            if (metadata.duration > 0) return samePlaybackRecording(metadata, other);
            const candidateIdentity = recordingIdentity(other);
            return !!identity.title && !!identity.artist && identity.title === candidateIdentity.title && identity.artist === candidateIdentity.artist && candidate.duration > 0;
          });
          const candidate = matches.find(value => !value.playbackHint) ?? matches[0];
          if (!candidate || !metadata.duration && matches.filter(value => !value.playbackHint).length > 1) return null;
          track = { ...original, duration: original.duration || candidate.duration, sources: [...original.sources, ...candidate.sources] };
        }
        const stream = await service.stream(track, signal);
        if (stream && (track.duration !== original.duration || !original.sources.some(source => source.kind === stream.source.kind && source.externalId === stream.source.externalId))) library.addTracks([{ ...track, sources: [...new Map([...track.sources, stream.source].map(source => [`${source.kind}:${source.externalId}`, source])).values()] }]);
        return stream;
      },
      parseLink(input) { const link = parseMusicLink(input); return link?.source === service.id ? link : null; },
    }));
  }
  return () => dispose.reverse().forEach(dispose => dispose());
}
