import { describe, expect, it } from 'vitest';
import { formatTime, trackCount } from '../../src/core/format';
describe('track counts', () => {
  it.each([[0, '0 треков'], [1, '1 трек'], [2, '2 трека'], [4, '4 трека'], [5, '5 треков'], [11, '11 треков'], [12, '12 треков'], [14, '14 треков'], [21, '21 трек'], [22, '22 трека'], [25, '25 треков'], [101, '101 трек'], [111, '111 треков']])('%i', (n, expected) => expect(trackCount(Number(n))).toBe(expected));
  it('handles the large library', () => expect(trackCount(2048).replaceAll('\u00a0', ' ')).toBe('2 048 треков'));
  it('uses English singular and plural', () => { expect(trackCount(1, 'en')).toBe('1 track'); expect(trackCount(42, 'en')).toBe('42 tracks'); });
});
describe('time formatting', () => {
  it.each([[0, '0:00'], [67, '1:07'], [143, '2:23'], [3601, '1:00:01'], [59.99, '0:59'], [-4, '0:00'], [NaN, '0:00'], [Infinity, '0:00']])('%s', (n, result) => expect(formatTime(Number(n))).toBe(result));
});
