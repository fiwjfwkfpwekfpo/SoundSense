import type { LyricsApi } from '../core/api';
import type { Lyrics } from '../core/types';
const lyrics: Lyrics = { trackId: 'track-1', language: 'ru', creditKey: 'lyrics.original', lines: [
  { time: 0, text: 'Город оставил свет в окне' }, { time: 12, text: 'Тихие улицы помнят нас' },
  { time: 24, text: 'Всё, что ты не сказал мне' }, { time: 36, text: 'Станет мелодией в этот раз' },
  { time: 48, text: 'Между домами плывут поезда' }, { time: 60, text: 'Ночь размывает все адреса' },
  { time: 72, text: 'Мы остаёмся в полутонах' }, { time: 84, text: 'Слышишь, как дышит тишина?' },
  { time: 96, text: 'Пусть этот город уснёт без нас' }, { time: 108, text: 'Пусть всё останется между строк' },
  { time: 120, text: 'Я сохраню этот тихий час' }, { time: 132, text: 'В музыке наших пустых дорог' },
] };
export const mockLyrics: LyricsApi = { getLyrics: async id => id === lyrics.trackId ? lyrics : null };
