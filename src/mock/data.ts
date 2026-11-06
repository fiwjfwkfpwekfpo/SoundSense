import type { Artist, Artwork, LibrarySnapshot, Track } from '../core/types';
export function random(seed: number): () => number {
  let state = seed || 1;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
const variants: Artwork['variant'][] = ['ribbon', 'orbit', 'haze', 'terrain'];
const titles = [
  'Полутона', 'Как ты там?', 'Останься до утра', 'Невесомость', 'Один', 'Сон',
  'After Hours', 'Тепло', 'Silver Lining', 'Медленно', 'Твои города', 'Quiet Room',
  'Мимо окон', 'Weightless', 'Дальше от дома', 'Blue Hour', 'Последний трамвай', 'Echoes',
  'Не отпускай', 'Soft Focus', 'Параллели', 'Night Drive', 'Внутри', 'Low Tide',
  'Небо ближе', 'Glasshouse', 'На повторе', 'Slow Motion', 'Гравитация', 'Still Here',
  'Там, где свет', 'Distant Signals', 'Ничего лишнего', 'Paper Moon', 'Всё пройдёт', 'Late Summer',
  'Не спеши', 'White Noise', 'Между строк', 'Somewhere Else', 'Без слов', 'First Light',
];
const names = ['тихий берег', 'параллель', 'neversleep', 'северный свет', 'corvax', 'море внутри', 'soft landing', 'полюс', 'lunar field', 'наедине', 'сентябрь', 'echo park', 'пустые улицы', 'daydreamer'];
export function createData(): LibrarySnapshot {
  const artists: Artist[] = names.map((name, i) => ({ id: `artist-${i}`, name, artwork: { seed: i * 19 + 11, variant: variants[i % 4]! } }));
  const tracks: Track[] = titles.map((title, i) => ({
    id: `track-${i + 1}`, title, artist: artists[i % artists.length]!,
    duration: i === 0 ? 143 : 90 + (i * 37 + 32) % 181,
    sources: [{ kind: (['sc', 'yt', 'ya', 'local'] as const)[i % 4]!, externalId: `mock-${i}` }],
    albumId: i >= 24 && i <= 27 ? 'album-night-ep' : `album-${i}`,
    explicit: i % 5 === 0 || i % 9 === 0, liked: i < 24, downloaded: i % 7 === 0,
    addedAt: 1804000000000 - i * 86400000, artwork: { seed: i * 47 + 21, variant: variants[i % 4]! },
  }));
  const extraTitles = ['Обратный путь', 'Ночная смена', 'За горизонт', 'Неон', 'Линии', 'Завтра', 'Тишина', 'Другой берег', 'Встречный свет', 'Новый день', 'Midnight', 'Open Water'];
  for (let i = 0; i < 2024; i++) {
    const next = random(i + 444);
    tracks.push({
      id: `collection-${i + 1}`, title: `${extraTitles[i % extraTitles.length]} ${String(Math.floor(i / extraTitles.length) + 1).padStart(2, '0')}`,
      artist: artists[i % artists.length]!, duration: 90 + Math.floor(next() * 181),
      sources: [{ kind: (['sc', 'yt', 'ya', 'local'] as const)[i % 4]!, externalId: `collection-${i}` }],
      explicit: i % 7 === 0, liked: true, downloaded: false, addedAt: 1800000000000 - i * 3600000,
      artwork: { seed: i * 31 + 200, variant: variants[i % 4]! },
    });
  }
  return {
    tracks,
    playlists: [
      { id: 'liked', title: '', titleKey: 'nav.liked', trackIds: tracks.filter(t => t.liked).map(t => t.id), artwork: { seed: 12, variant: 'ribbon' }, kind: 'liked' },
      { id: 'focus', title: '', titleKey: 'playlist.focus', descriptionKey: 'playlist.focusDescription', trackIds: tracks.slice(0, 37).map(t => t.id), artwork: { seed: 31, variant: 'haze' }, kind: 'playlist' },
      { id: 'night', title: '', titleKey: 'playlist.night', descriptionKey: 'playlist.nightDescription', trackIds: tracks.slice(5, 33).map(t => t.id), artwork: { seed: 42, variant: 'orbit' }, kind: 'playlist' },
      { id: 'road', title: '', titleKey: 'playlist.road', descriptionKey: 'playlist.roadDescription', trackIds: tracks.slice(10, 28).map(t => t.id), artwork: { seed: 65, variant: 'terrain' }, kind: 'playlist' },
      { id: 'slow', title: '', titleKey: 'playlist.slow', descriptionKey: 'playlist.slowDescription', trackIds: tracks.slice(12, 24).map(t => t.id), artwork: { seed: 92, variant: 'ribbon' }, kind: 'playlist' },
    ],
    recommendations: ['track-2', 'track-9', 'track-14', 'track-27', 'track-36', 'track-40'],
    history: ['track-1', 'track-6', 'track-11', 'track-17', 'track-22', 'track-32'],
  };
}
export function generateWaveform(seed: number): number[] {
  const next = random(seed);
  return Array.from({ length: 1000 }, (_, i) => {
    const x = i / 999;
    const fade = Math.min(1, x * 14, (1 - x) * 10);
    const chorus = x > 0.25 && x < 0.5 || x > 0.66 && x < 0.86 ? 0.95 : 0.62;
    return Math.max(0.025, fade * chorus * (0.45 + next() * 0.55) * (0.8 + Math.sin(x * 72) * 0.2));
  });
}
