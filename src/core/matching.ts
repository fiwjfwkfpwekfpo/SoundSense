import type { ImportTrack } from './imports';
const transliteration: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
export function normalizeMetadata(value: string, preserveVersion = false): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\b(?:feat(?:uring)?|ft)\.?\s*/g, ' ')
    .replace(/\((?:official|audio|video|lyrics|remaster(?:ed)?)[^)]*\)|\[(?:official|audio|video|lyrics)[^\]]*\]/g, noise => preserveVersion && /remaster/.test(noise) ? noise : ' ')
    .replace(/[а-яё]/g, letter => transliteration[letter] ?? letter).replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Full recording identity, including version. An explicit Artist — Title can
 * identify an upload whose uploader name differs from the credited artist. */
export function recordingIdentity(value: { title: string; artist: string }) {
    const split = /^(.{1,120}?)\s+[—–-]\s+(.{1,300})$/.exec(value.title);
    return { title: normalizeMetadata(split?.[2] ?? value.title, true), artist: normalizeMetadata(split?.[1] ?? value.artist, true) };
}
export function sameRecording(a: { title: string; artist: string; duration?: number }, b: { title: string; artist: string; duration?: number }): boolean {
  const aa = recordingIdentity(a), bb = recordingIdentity(b);
  return !!aa.title && !!aa.artist && aa.title === bb.title && aa.artist === bb.artist && !!a.duration && !!b.duration && Math.abs(a.duration - b.duration) <= 1;
}
/** Cross-service audio containers can differ by padding and whole-second
 * metadata. Keep exact title/version and the complete credited artist list;
 * tolerate at most three seconds without relaxing library deduplication. */
export function samePlaybackRecording(a: { title: string; artist: string; duration?: number }, b: { title: string; artist: string; duration?: number }): boolean {
  const identity = (value: { title: string; artist: string }) => {
    const split = /^(.{1,120}?)\s+[—–-]\s+(.{1,300})$/.exec(value.title), title = split?.[2] ?? value.title;
    const feature = /\s*[([](?:feat(?:uring)?|ft)\.?\s+([^\])]+)[\])]\s*$/i.exec(title);
    const credited = `${split?.[1] ?? value.artist}${feature ? `, ${feature[1]}` : ''}`;
    const artists = [...new Set(credited.split(/\s*(?:[,;&+]|\bfeat(?:uring)?\.?|\bft\.?)\s*/i).map(part => normalizeMetadata(part, true)).filter(Boolean))].sort().join('|');
    return { title: normalizeMetadata(feature ? title.slice(0, feature.index) : title, true), artists };
  };
  const aa = identity(a), bb = identity(b);
  return !!aa.title && !!aa.artists && aa.title === bb.title && aa.artists === bb.artists &&
    !!a.duration && !!b.duration && Math.abs(a.duration - b.duration) <= Math.min(3, Math.max(1, a.duration * .02));
}
function similarity(a: string, b: string): number {
  if (a === b && a) return 1;
  const aa = new Set(a.split(' ').filter(Boolean)), bb = new Set(b.split(' ').filter(Boolean));
  const intersection = [...aa].filter(word => bb.has(word)).length;
  return aa.size + bb.size ? 2 * intersection / (aa.size + bb.size) : 0;
}
export function matchTrack(original: ImportTrack, candidates: readonly ImportTrack[]): { candidate?: ImportTrack; confidence: number; kind: 'confident' | 'uncertain' | 'missing' } {
  let best: ImportTrack | undefined; let confidence = 0;
  for (const candidate of candidates) {
    const title = similarity(normalizeMetadata(original.title), normalizeMetadata(candidate.title));
    const artist = similarity(normalizeMetadata(original.artist), normalizeMetadata(candidate.artist));
    const delta = original.duration && candidate.duration ? Math.abs(original.duration - candidate.duration) : undefined;
    const score = title * .55 + artist * .35 + (delta === undefined ? .05 : delta <= 3 ? .1 : -.07);
    if (title >= .4 && score > confidence) { confidence = score; best = candidate; }
  }
  return { candidate: best, confidence, kind: confidence >= .9 ? 'confident' : confidence >= .55 ? 'uncertain' : 'missing' };
}
