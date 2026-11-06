import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureViewport } from '../../src/platform/system-ui';
import { STORAGE_KEYS, STORAGE_PREFIX } from '../../src/core/storage';
afterEach(() => vi.unstubAllGlobals());
describe('runtime frame gate', () => {
  it.each([[true, true, 'native', 'false'], [true, false, 'native', 'false'], [false, false, 'web', 'false'], [false, true, 'web', 'true']])('native %s, development %s', (native, dev, runtime, preview) => {
    const dataset: Record<string, string> = {}; vi.stubGlobal('document', { documentElement: { dataset } });
    configureViewport(native as boolean, dev as boolean); expect(dataset).toEqual({ runtime, preview });
  });
  it('uses one neutral storage prefix', () => { expect(STORAGE_PREFIX).toBe('ss_'); expect(Object.values(STORAGE_KEYS).every(key => key.startsWith(STORAGE_PREFIX))).toBe(true); });
});
