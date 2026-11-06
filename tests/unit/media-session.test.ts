import { describe, expect, it, vi } from 'vitest';
const command = vi.hoisted(() => vi.fn(async (_options: { action: string; metadata?: Record<string, unknown> }) => {}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('../../src/platform/audio-engine', () => ({ NativeAudio: { command } }));
import { bindMediaSession } from '../../src/platform/media-session';
import { createLibrary } from '../../src/core/library';
import { createSettings } from '../../src/core/settings';
import type { PlayerApi } from '../../src/core/api';
import type { PlayerState } from '../../src/core/types';
import { translate } from '../../src/ui/i18n';
describe('native system media metadata', () => {
  it('resends restored track artwork and localized actions after a new native slot is prepared', () => {
    const library = createLibrary(), settings = createSettings({ language: 'ru' });
    library.addTracks([{ id: 'sc-1', title: 'Song', artist: { id: 'artist', name: 'Artist', artwork: { seed: 1, variant: 'orbit' } }, duration: 180, artwork: { seed: 1, variant: 'orbit', url: 'https://art.test/cover.jpg' }, sources: [{ kind: 'sc', externalId: '1' }], liked: false, downloaded: false, explicit: false, addedAt: 1 }]);
    let state: PlayerState = { trackId: 'sc-1', position: 0, playing: false, queue: [{ id: 'q1', trackId: 'sc-1' }], currentIndex: 0, shuffle: false, repeat: 'off' };
    const listeners = new Set<(state: PlayerState) => void>();
    const player: Pick<PlayerApi, 'getSnapshot' | 'subscribe'> = { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const publish = (changes: Partial<PlayerState>) => { state = { ...state, ...changes }; for (const listener of listeners) listener(state); };
    const dispose = bindMediaSession({ library, settings, player }, key => translate(String(settings.getSnapshot().language), key));
    expect(command).toHaveBeenCalledTimes(1);
    publish({ playing: true, resolving: true }); expect(command).toHaveBeenCalledTimes(1);
    publish({ resolving: false }); expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1]?.[0]).toMatchObject({ action: 'metadata', metadata: { artwork: 'https://art.test/cover.jpg', liked: false, labels: { like: translate('ru', 'track.like') } } });
    publish({ position: 1 }); expect(command).toHaveBeenCalledTimes(2);
    library.setLiked('sc-1', true); expect(command.mock.calls.at(-1)?.[0]).toMatchObject({ metadata: { liked: true } });
    settings.set('language', 'en'); expect(command.mock.calls.at(-1)?.[0]).toMatchObject({ metadata: { labels: { like: 'Like song' } } });
    dispose(); library.dispose();
  });
});
