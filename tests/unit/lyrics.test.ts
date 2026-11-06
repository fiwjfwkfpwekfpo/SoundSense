import { describe, expect, it } from 'vitest';
import { extractGenius, parseSynced, sameSong, toLyrics } from '../../src/core/lyrics';
import { createExtensions } from '../../src/core/runtime';

describe('lyrics', () => {
  it('parses LRC with several stamps and Musixmatch JSON', () => {
    expect(parseSynced('[00:01.50]a\n[00:03.00][00:10.00]b')).toEqual([{ time: 1.5, text: 'a' }, { time: 3, text: 'b' }, { time: 10, text: 'b' }]);
    expect(parseSynced('[{"text":"x","time":{"total":2.5}}]')).toEqual([{ time: 2.5, text: 'x' }]);
  });
  it('falls back to plain text when there is no timing', () => {
    const lyrics = toLyrics('t', { plain: 'one\ntwo\n\nthree' }, 'p')!;
    expect(lyrics.synced).toBe(false); expect(lyrics.lines.map(line => line.text)).toEqual(['one', 'two', '', 'three']);
  });
  it('matches titles across services', () => {
    expect(sameSong('ЛУЖА КРОВИ (prod. blesskii)', 'ТРОЕТОЧИЕ', 'ЛУЖА КРОВИ (PUDDLE OF BLOOD)', 'ТРОЕТОЧИЕ (TROETOCHIE)')).toBe(true);
    expect(sameSong('Ёлка', 'Artist feat. B', 'Елка', 'Artist')).toBe(true);
    expect(sameSong('Other', 'Artist', 'Song', 'Artist')).toBe(false);
  });
  it('extracts Genius lyrics containers', () => {
    expect(extractGenius('<div data-lyrics-container="true">[Verse]<br/>Line &amp; one<br><div>Two</div></div>')).toBe('Line & one\nTwo');
  });
  it('prefers a synced provider over an earlier plain one', async () => {
    const extensions = createExtensions();
    extensions.lyrics.register({ id: 'a', titleKey: 'a', find: async () => ({ trackId: 't', language: 'en', lines: [{ time: 0, text: 'p' }], creditKey: 'a', synced: false }) });
    extensions.lyrics.register({ id: 'b', titleKey: 'b', find: async () => { throw new Error('down'); } });
    extensions.lyrics.register({ id: 'c', titleKey: 'c', find: async () => ({ trackId: 't', language: 'en', lines: [{ time: 1, text: 's' }], creditKey: 'c', synced: true }) });
    expect((await extensions.lyrics.find('t'))?.creditKey).toBe('c');
  });
});
