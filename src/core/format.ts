export function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const rest = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
export function trackCount(count: number, language = 'ru'): string {
  const n = Math.max(0, Math.trunc(count));
  if (language === 'en') return `${n.toLocaleString('en-US')} ${n === 1 ? 'track' : 'tracks'}`;
  const tail = n % 100;
  const form = tail >= 11 && tail <= 14 ? 'треков' : n % 10 === 1 ? 'трек' : n % 10 >= 2 && n % 10 <= 4 ? 'трека' : 'треков';
  return `${n.toLocaleString('ru-RU')} ${form}`;
}
