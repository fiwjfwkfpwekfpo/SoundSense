import { ImportFailure } from './imports';
import type { ImportCollection, ImportTrack } from './imports';
import { asImportTrack, catalogueTrack } from './music-service';
import { localId } from './local';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const lower = (value: Row): Row => Object.fromEntries(Object.entries(value).map(([key, value]) => [key.toLowerCase().replace(/[_\s-]+/g, ''), value]));
function duration(raw: unknown): number {
  if (typeof raw === 'number') return raw > 1000 ? raw / 1000 : raw;
  const value = text(raw); if (!value) return 0;
  return value.includes(':') ? value.split(':').reduce((sum, part) => sum * 60 + (Number(part) || 0), 0) : Number(value) > 1000 ? Number(value) / 1000 : Number(value) || 0;
}
/** RFC-style quoted fields, including newlines and doubled quotes. No formulas
 * or other content in an export file are evaluated. */
export function parseCsv(input: string): string[][] {
  const first = input.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(field.trim().replace(/^\uFEFF/, '')); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && input[i + 1] === '\n') i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new ImportFailure('invalid_archive');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}
export function parseAppleExport(input: string, format: 'json' | 'csv', filename = 'Apple Music'): ImportCollection[] {
  if (input.length > 12 * 1024 * 1024) throw new ImportFailure('invalid_archive');
  const collections = new Map<string, ImportTrack[]>(); let visited = 0;
  const accept = (row: Row, playlist: string): boolean => {
    const node = lower(row), title = text(node.title ?? node.name ?? node.trackname ?? node.song ?? node.songname ?? node.trackdescription), artist = text(node.artistname ?? node.artist ?? node.artists ?? node.creator ?? node.uploader);
    if (!title || !artist) return false;
    const id = text(node.songid ?? node.trackid ?? node.id) || localId(`${artist}:${title}:${duration(node.durationinmillis ?? node.duration ?? node.durationms ?? node.trackduration ?? node.time ?? node.length)}`);
    const track = catalogueTrack('apple', { id, title, artist, duration: duration(node.durationinmillis ?? node.duration ?? node.durationms ?? node.trackduration ?? node.time ?? node.length) });
    const key = playlist || text(node.playlistname ?? node.playlist ?? node.containerdescription ?? node.containername);
    const items = collections.get(key) ?? []; items.push(asImportTrack(track)); collections.set(key, items); return true;
  };
  try {
    if (format === 'csv') {
      const [headers, ...rows] = parseCsv(input); if (!headers) throw new Error('Missing headers');
      for (const row of rows) accept(Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ''])), '');
    } else {
      const stack: { value: unknown; playlist: string }[] = [{ value: JSON.parse(input), playlist: '' }];
      while (stack.length) {
        if (++visited > 150000) throw new Error('Too many entries');
        const { value, playlist } = stack.pop()!;
        if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], playlist }); continue; }
        const node = object(value), keys = lower(node), name = text(keys.playlistname ?? keys.playlist) || playlist;
        if (accept(node, name)) continue;
        const children = keys.tracks ?? keys.items;
        if (Array.isArray(children) && text(keys.name ?? keys.title)) { stack.push({ value: children, playlist: text(keys.name ?? keys.title) }); continue; }
        for (const child of Object.values(node).reverse()) if (child && typeof child === 'object') stack.push({ value: child, playlist: name });
      }
    }
  } catch (error) { throw error instanceof ImportFailure ? error : new ImportFailure('invalid_archive'); }
  if (!collections.size) throw new ImportFailure('invalid_archive');
  return [...collections].map(([name, tracks]) => ({ id: `apple-export-${localId(name || filename)}`, title: name || filename.replace(/\.[^.]+$/, ''), liked: !name, tracks }));
}
