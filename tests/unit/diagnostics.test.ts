import { describe, expect, it, vi } from 'vitest';
import { createDiagnostics, redactDiagnostic } from '../../src/debug/diagnostics';
describe('local playback diagnostics', () => {
  it('exports the JS journal even if the native audio service stops responding', async () => {
    vi.useFakeTimers();
    const diagnostics = createDiagnostics({ version: '0.5.1', platform: 'android', native: () => new Promise(() => {}) });
    diagnostics.record('player', 'prepare.failed', { code: 'YA_EMPTY_VARIANTS' }, 'error');
    try {
      const exported = diagnostics.export(); await vi.advanceTimersByTimeAsync(3000);
      const result = JSON.parse(await exported);
      expect(result.entries[0].data.code).toBe('YA_EMPTY_VARIANTS');
      expect(result.native.message).toBe('Native diagnostics timed out');
    } finally { diagnostics.clear(); vi.useRealTimers(); }
  });
  it('exports the failure and native state while removing credentials and document paths', async () => {
    const diagnostics = createDiagnostics({ version: '0.4.0', platform: 'android', native: async () => ({ position: 42, uri: 'https://audio.test/a.m3u8?token=secret' }) });
    diagnostics.record('player', 'failed', { trackId: 'sc-1', status: 403, token: 'private', uri: 'https://audio.test/a?Signature=secret', file: 'content://provider/document/private-song.mp3', message: 'Bearer hidden' }, 'error');
    const exported = await diagnostics.export(); expect(exported).toContain('failed'); expect(exported).toContain('403'); expect(exported).toContain('42'); expect(exported).not.toMatch(/private-song|hidden|secret|private/); diagnostics.clear();
  });
  it('bounds stored entries and keeps the most recent failure after restart', async () => {
    vi.useFakeTimers(); const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const diagnostics = createDiagnostics({ version: '0.4.0', platform: 'test', storage }); for (let i = 0; i < 500; i++) diagnostics.record('test', 'event', { index: i }); diagnostics.record('test', 'last', {}, 'error');
    const restored = createDiagnostics({ version: '0.4.0', platform: 'test', storage }); expect(restored.getSnapshot()).toHaveLength(350); expect(restored.getSnapshot().at(-1)?.event).toBe('last'); restored.clear(); expect(JSON.parse(values.get('ss_diagnostics_v1')!)).toEqual([]); vi.useRealTimers();
  });
  it('redacts authorization text even when it is embedded in an error message', () => { expect(redactDiagnostic('authorization=abc OAuth secret https://host/path?Policy=x')).toBe('authorization=[redacted] [credentials] https://host/path'); });
});
