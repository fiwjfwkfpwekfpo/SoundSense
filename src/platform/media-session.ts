import { Capacitor } from '@capacitor/core';
import type { AppApi } from '../core/api';
import { NativeAudio } from './audio-engine';
type MediaSessionPorts = {
  player: Pick<AppApi['player'], 'getSnapshot' | 'subscribe'> & Partial<Pick<AppApi['player'], 'toggle' | 'next' | 'previous' | 'seek' | 'livePosition'>>;
  library: Pick<AppApi['library'], 'getTrack' | 'subscribe' | 'getSnapshot'>;
  settings: Pick<AppApi['settings'], 'getSnapshot' | 'subscribe'>;
};
/** System media UI consumes core snapshots; it owns no parallel queue or library. */
export function bindMediaSession(api: MediaSessionPorts, text: (key: string) => string): () => void {
  if (!Capacitor.isNativePlatform()) return bindBrowserMediaSession(api);
  let previous = '', last: { trackId: unknown; index: number; queue: unknown; repeat: unknown; resolving: unknown; library: unknown; settings: unknown } | undefined;
  const update = () => {
    const state = api.player.getSnapshot(), library = api.library.getSnapshot(), settings = api.settings.getSnapshot();
    // The player publishes every 80 ms; metadata only depends on these fields.
    if (last && previous && last.trackId === state.trackId && last.index === state.currentIndex && last.queue === state.queue && last.repeat === state.repeat && last.resolving === state.resolving && last.library === library && last.settings === settings) return;
    last = { trackId: state.trackId, index: state.currentIndex, queue: state.queue, repeat: state.repeat, resolving: state.resolving, library, settings };
    const track = state.trackId && api.library.getTrack(state.trackId);
    // A restored track can have identical metadata but a newly created native slot.
    // Send it again after preparation rather than treating it as already applied.
    if (!track || state.resolving) { previous = ''; return; }
    const metadata = { trackId: track.id, title: track.title, artist: track.artist.name, duration: track.duration, artwork: track.artwork.url ?? '', liked: track.liked,
      previous: state.currentIndex > 0, next: state.currentIndex + 1 < state.queue.length || state.repeat === 'all' && state.queue.length > 1,
      labels: { play: text('player.play'), pause: text('player.pause'), next: text('player.next'), previous: text('player.previous'), like: text('track.like'), unlike: text('track.unlike') } };
    const key = JSON.stringify(metadata); if (key === previous) return; previous = key;
    void NativeAudio.command({ action: 'metadata', metadata }).catch(() => {});
  };
  const subscriptions = [api.player.subscribe(update), api.library.subscribe(update), api.settings.subscribe(update)]; update();
  return () => subscriptions.forEach(dispose => dispose());
}

/*
 * Desktop (and browser preview): the standard Media Session API. Chromium publishes it to the
 * system — MPRIS on Linux (playerctl, Quickshell, media keys), SMTC on Windows.
 */
function bindBrowserMediaSession(api: MediaSessionPorts): () => void {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!session) return () => {};
  const { player } = api;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => { if (!player.getSnapshot().playing) player.toggle?.(); }],
    ['pause', () => { if (player.getSnapshot().playing) player.toggle?.(); }],
    ['stop', () => { if (player.getSnapshot().playing) player.toggle?.(); }],
    ['nexttrack', () => player.next?.()],
    ['previoustrack', () => player.previous?.()],
    ['seekto', details => { if (Number.isFinite(details.seekTime)) player.seek?.(details.seekTime!); }],
    ['seekforward', details => player.seek?.(player.getSnapshot().position + (details.seekOffset ?? 10))],
    ['seekbackward', details => player.seek?.(Math.max(0, player.getSnapshot().position - (details.seekOffset ?? 10)))],
  ];
  for (const [action, handler] of actions) try { session.setActionHandler(action, handler); } catch { /* Not supported here. */ }
  let metadataKey = '', playing: boolean | undefined, expected = { at: 0, position: 0, rate: 1 };
  const update = () => {
    const state = player.getSnapshot(), track = state.trackId ? api.library.getTrack(state.trackId) : undefined;
    const key = track ? `${track.id}|${track.title}|${track.artist.name}|${track.artwork.url ?? ''}` : '';
    if (key !== metadataKey) {
      metadataKey = key;
      session.metadata = track ? new MediaMetadata({ title: track.title, artist: track.artist.name, ...(track.artwork.url && /^https:/.test(track.artwork.url) ? { artwork: [{ src: track.artwork.url, sizes: '500x500' }] } : {}) }) : null;
    }
    if (state.playing !== playing) { playing = state.playing; session.playbackState = !track ? 'none' : state.playing ? 'playing' : 'paused'; }
    // The snapshot is published many times a second; the system only needs to hear about jumps.
    const live = player.livePosition?.() ?? { position: state.position, rate: 1, playing: state.playing };
    const predicted = expected.position + (playing ? (performance.now() - expected.at) / 1000 * expected.rate : 0);
    if (track?.duration && (Math.abs(predicted - live.position) > 1.5 || key !== '' && expected.at === 0)) {
      expected = { at: performance.now(), position: live.position, rate: live.rate || 1 };
      try { session.setPositionState({ duration: track.duration, position: Math.max(0, Math.min(track.duration, live.position)), playbackRate: live.rate || 1 }); } catch { /* Invalid while loading. */ }
    }
  };
  const subscriptions = [player.subscribe(update), api.library.subscribe(update)]; update();
  return () => { subscriptions.forEach(dispose => dispose()); for (const [action] of actions) try { session.setActionHandler(action, null); } catch { /* Not supported. */ } session.metadata = null; };
}
