import { expect, it, vi } from 'vitest';
import { createExtensions } from '../../src/core/runtime';
import { createLibrary } from '../../src/core/library';
import { registerProviders } from '../../src/core/providers';
import { catalogueTrack } from '../../src/core/music-service';
import { sameRecording, samePlaybackRecording } from '../../src/core/matching';
import { HttpFailure } from '../../src/core/http';
import { PlaybackFailure } from '../../src/core/audio-engine';
import type { CoreEvents } from '../../src/core/events';
import type { SourceProvider } from '../../src/core/registries';

const original = catalogueTrack('ya', { id: '132851896', title: 'Твои подруги', artist: 'FELIX, whyspurky', duration: 129.6 });
const provider = (id: string, resolveStream: SourceProvider['resolveStream']): SourceProvider => ({ id, titleKey: id, resolveStream, search: async () => ({ tracks: [], artists: [], playlists: [] }), getTrack: async () => undefined, parseLink: () => null });

it('keeps the original service error and its HTTP status instead of blaming a protected alternative', async () => {
  const runtime = createExtensions(), events: CoreEvents['source:resolve'][] = [];
  runtime.events.on('source:resolve', value => events.push(value));
  runtime.sources.register(provider('sc', async () => { throw new PlaybackFailure('protected', 'Alternative has DRM'); }));
  runtime.sources.register(provider('ya', async () => { throw new HttpFailure(404, '{}'); }));
  runtime.sources.register(provider('yt', async () => null));
  const result = await runtime.sources.resolve(original);
  expect(result).toMatchObject({ source: null, reason: 'unavailable', provider: 'ya', status: 404, message: 'HTTP 404' });
  expect(events.map(e => e.outcome)).toEqual(['failed', 'failed', 'unmatched']);
  expect(events[0]).toMatchObject({ provider: 'ya', status: 404, message: 'HTTP 404' });
  expect(new Set(events.map(e => e.attemptId)).size).toBe(1);
});
it('does not contact metadata-only services or the local source while resolving an online track', async () => {
  const runtime = createExtensions(), resolve = vi.fn(async () => null);
  runtime.sources.register({ ...provider('apple', resolve), supportsPlayback: false });
  runtime.sources.register({ ...provider('local', resolve), fallback: false });
  await runtime.sources.resolve(original); expect(resolve).not.toHaveBeenCalled();
});
it('matches the same full recording across artist order and container padding, without weakening import deduplication', () => {
  const candidate = { title: 'Твои подруги', artist: 'whyspurky & FELIX', duration: 131 };
  const metadata = { ...original, artist: original.artist.name };
  expect(samePlaybackRecording(metadata, candidate)).toBe(true); expect(sameRecording(metadata, candidate)).toBe(false);
  for (const other of [{ ...candidate, title: 'Твои подруги (Remix)' }, { ...candidate, title: 'Твои подруги (Live)' }, { ...candidate, artist: 'FELIX' }, { ...candidate, duration: 140 }]) expect(samePlaybackRecording(metadata, other)).toBe(false);
  expect(samePlaybackRecording({ title: 'BALDININI', artist: 'Pepel Nahudi, nkeeei', duration: 114.68 }, { title: 'BALDININI (feat. nkeeei)', artist: 'Pepel Nahudi', duration: 112.485 })).toBe(true);
  expect(samePlaybackRecording({ title: 'BALDININI', artist: 'Pepel Nahudi, nkeeei', duration: 114.68 }, { title: 'BALDININI (Remix) (feat. nkeeei)', artist: 'Pepel Nahudi', duration: 112.485 })).toBe(false);
});
it('actually resolves that full fallback through the built-in source registry', async () => {
  const runtime = createExtensions(), library = createLibrary(); library.addTracks([original]);
  const candidate = catalogueTrack('ytm', { id: 'abcdefghijk', title: 'Твои подруги', artist: 'whyspurky & FELIX', duration: 131 });
  const stream = vi.fn(async track => ({ uri: 'https://audio.test/full.m4a', source: track.sources.find((s: { kind: string }) => s.kind === 'ytm')! }));
  const dispose = registerProviders(runtime, library, { start() {} }, [{ id: 'ytm', inspect: async () => [], collection: async () => ({ id: 'test', title: '', tracks: [] }), getTrack: async () => candidate, search: async () => ({ tracks: [candidate], artists: [], playlists: [] }), stream }], { text: async () => '{}' });
  try { expect((await runtime.sources.resolve(original)).uri).toBe('https://audio.test/full.m4a'); expect(stream).toHaveBeenCalledOnce(); }
  finally { dispose(); library.dispose(); }
});
