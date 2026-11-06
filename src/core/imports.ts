import type { MusicLink } from './links';
import type { Track } from './types';
export const importErrorKinds = ['invalid_link', 'not_found', 'private', 'region', 'auth', 'expired', 'rate_limit', 'offline', 'timeout', 'invalid_archive', 'incomplete', 'empty'] as const;
export type ImportErrorKind = typeof importErrorKinds[number];
export class ImportFailure extends Error {
  constructor(readonly kind: ImportErrorKind, readonly detail = '', readonly retryAfter = 5) { super(kind); }
}
export function classifyImportError(error: unknown): ImportFailure {
  if (error instanceof ImportFailure) return error;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = Number(value.status ?? value.statusCode);
  const detail = String(value.message ?? error ?? '');
  const kind: ImportErrorKind = /expired|token.expir/i.test(detail) ? 'expired' : status === 451 || /geo|legal reasons|region/i.test(detail) ? 'region'
    : status === 404 ? 'not_found' : /private|closed/i.test(detail) ? 'private' : status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limit'
      : /offline|network|fetch/i.test(detail) ? 'offline' : /archive|zip|YourLibrary/i.test(detail) ? 'invalid_archive' : 'timeout';
  return new ImportFailure(kind, detail, Math.max(1, Math.min(300, Number(value.retryAfter) || 5)));
}
export interface ImportTrack { id: string; title: string; artist: string; duration?: number; unavailable?: 'deleted' | 'private' | 'preview'; track?: Track }
export interface ImportCollection { id: string; title: string; tracks: readonly ImportTrack[]; liked?: boolean }
export interface ImportChoice { id: string; title: string; count?: number; liked?: boolean; link: MusicLink }
export type ImportSource = 'sc' | 'yt' | 'ya' | 'spotify' | 'local' | (string & {});
export interface ImportRequest { source: ImportSource; link?: MusicLink; selections?: readonly ImportChoice[]; collections?: readonly ImportCollection[]; destination: 'new' | 'liked' | 'separate' | string; title: string }
export interface ImportIssue { original: ImportTrack; candidateId?: string; confidence?: number; reason?: ImportTrack['unavailable']; resolved?: 'accepted' | 'skipped'; alternatives?: readonly string[]; destinations?: readonly string[] }
export interface ImportResult {
  total: number; imported: number; added: number; existing: number; playlistId: string;
  missing: readonly ImportIssue[]; uncertain: readonly ImportIssue[]; unavailable: readonly ImportIssue[];
  collections?: readonly { id: string; title: string; playlistId: string; imported: number; added: number; existing: number }[];
  duplicates?: number;
}
export interface ImportJob {
  id: string; request: ImportRequest; phase: 'fetching' | 'matching' | 'scanning' | 'done' | 'error' | 'cancelled';
  completed: number; total: number; result?: ImportResult; error?: ImportFailure; retryIn?: number;
}
