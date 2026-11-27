import { describe, expect, it } from 'vitest';
import { fitsDuration, parseSynced, toLyrics } from '../../src/core/lyrics';
import { parseLyricsOrder } from '../../src/core/registries';
import { createExtensions } from '../../src/core/runtime';
import type { Lyrics } from '../../src/core/types';

const timed = (creditKey: string, words = false): Lyrics => ({ trackId: 't', language: 'en', creditKey, synced: true, lines: [{ time: 1, text: 'a b', ...(words ? { words: [{ time: 1, text: 'a ' }, { time: 1.5, text: 'b' }] } : {}) }], ...(words ? { words: true } : {}) });
const plain = (creditKey: string): Lyrics => ({ trackId: 't', language: 'en', creditKey, synced: false, lines: [{ time: 0, text: 'a b' }] });
const later = <T,>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

describe('lyrics choice', () => {
  it('reads enhanced LRC word stamps', () => {
    const [line] = parseSynced('[00:10.00]<00:10.00>Hello <00:10.50>world<00:11.20>');
    expect(line).toMatchObject({ time: 10, text: 'Hello world', words: [{ time: 10, text: 'Hello ' }, { time: 10.5, end: 11.2, text: 'world' }] });
    expect(toLyrics('t', { synced: '[00:10.00]<00:10.00>Hello <00:10.50>world' }, 'x')?.words).toBe(true);
    expect(toLyrics('t', { synced: '[00:10.00]Hello world' }, 'x')?.words).toBeUndefined();
  });
  it('drops timed text that cannot belong to the recording', () => {
    expect(fitsDuration([{ time: 300, text: 'late' }], 200)).toBe(false);
    expect(fitsDuration([{ time: 5, text: 'a' }, { time: 260, text: 'b' }], 200)).toBe(false);
    expect(fitsDuration([{ time: 5, text: 'a' }, { time: 190, text: 'b' }], 200)).toBe(true);
    // A text that does not fit falls back to its plain version.
    expect(toLyrics('t', { synced: '[05:00.00]late', plain: 'late' }, 'x', 200)?.synced).toBe(false);
  });
  it('parses the saved order', () => {
    const { order, disabled } = parseLyricsOrder('deezer,-genius, lrclib,deezer');
    expect(order).toEqual(['deezer', 'genius', 'lrclib']); expect([...disabled]).toEqual(['genius']);
  });
  it('prefers precision over order, order between equals, and skips turned-off providers', async () => {
    const extensions = createExtensions();
    let order = 'a,b,c';
    extensions.lyrics.setOrder(() => order);
    extensions.lyrics.register({ id: 'a', titleKey: 'a', find: async () => plain('a') });
    extensions.lyrics.register({ id: 'b', titleKey: 'b', find: async () => timed('b') });
    extensions.lyrics.register({ id: 'c', titleKey: 'c', find: async () => timed('c') });
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('b');
    order = 'c,b,a'; extensions.lyrics.orderChanged();
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('c');
    order = '-c,b,a'; extensions.lyrics.orderChanged();
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('b');
    expect(extensions.lyrics.ordered().map(item => [item.provider.id, item.enabled])).toEqual([['c', false], ['b', true], ['a', true]]);
  });
  it('answers with line timings first and upgrades to word timings', async () => {
    const extensions = createExtensions();
    extensions.lyrics.setOrder(() => 'lines,words');
    extensions.lyrics.register({ id: 'lines', titleKey: 'lines', find: () => later(5, timed('lines')) });
    extensions.lyrics.register({ id: 'words', titleKey: 'words', find: () => later(60, timed('words', true)) });
    const updates: string[] = [];
    extensions.lyrics.onUpdate((_id, value) => updates.push(value.creditKey));
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('lines');
    await later(100, null);
    expect(updates).toEqual(['words']);
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('words');
  });
  it('waits for a higher-priority provider only for a short grace', async () => {
    const extensions = createExtensions();
    extensions.lyrics.setOrder(() => 'slow,fast');
    extensions.lyrics.register({ id: 'slow', titleKey: 'slow', find: () => later(60, timed('slow')) });
    extensions.lyrics.register({ id: 'fast', titleKey: 'fast', find: () => later(5, timed('fast')) });
    // The slower provider is above and answers within the grace: it wins the tie.
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('slow');
  });
});
