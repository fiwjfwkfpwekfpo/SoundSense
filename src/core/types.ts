export type SourceKind = 'sc' | 'yt' | 'ya' | 'local' | (string & {});
export type PlaybackFailureReason = 'network' | 'auth' | 'region' | 'protected' | 'preview' | 'unavailable' | 'unsupported' | 'file' | 'timeout' | 'decoder';
export interface TrackSource { kind: SourceKind; externalId: string }
export interface Artwork { seed: number; variant: 'ribbon' | 'orbit' | 'haze' | 'terrain'; url?: string }
export interface Artist { id: string; name: string; artwork: Artwork }
/** `loudness`: whole-track RMS in dBFS (computed on the device), used for volume normalization. */
/** `rhythm`: base64 bass energy, 20 frames per second (beat visuals). */
export interface Waveform { samples: readonly number[]; progress?: number; status?: 'ready' | 'building' | 'deferred'; cached?: boolean; loudness?: number; rhythm?: string }
export interface Track {
  id: string; title: string; artist: Artist; duration: number;
  sources: readonly TrackSource[]; explicit: boolean; liked: boolean; playbackHint?: 'protected' | 'preview' | 'unavailable';
  downloaded: boolean; addedAt: number; artwork: Artwork; albumId?: string;
  /** Album as tagged in the file (local music) or given by the service. */
  album?: { title: string; artist?: string; year?: number };
  /** Position on the album, from tags: track and disc number. */
  trackNo?: number; discNo?: number;
}
export interface Playlist {
  id: string; title: string; titleKey?: string; descriptionKey?: string;
  trackIds: readonly string[]; artwork: Artwork; kind: 'liked' | 'playlist';
}
export type RepeatMode = 'off' | 'all' | 'one';
export interface QueueEntry { id: string; trackId: string }
export interface PlayerState {
  queue: readonly QueueEntry[]; currentIndex: number; trackId: string | null;
  position: number; playing: boolean; shuffle: boolean; repeat: RepeatMode;
  crossfade?: { from: string; to: string; progress: number; duration: number; fromPosition: number; toPosition: number };
  transition?: { id: number; kind: 'manual' | 'crossfade'; from: string; to: string; duration: number; direction: 1 | -1 };
  resolving?: boolean; notice?: { id: number; key: 'player.fallback' | 'player.skipped' | 'player.alternative' | 'state.notDownloaded' | 'player.audioError' | `player.error.${PlaybackFailureReason}`; from?: SourceKind; to?: SourceKind };
  sleepTimer?: { remaining: number; endOfTrack: boolean; gain: number };
}
export interface LyricsLine { time: number; text: string }
/** `synced: false` means plain text: lines carry no timing. */
export interface Lyrics { trackId: string; language: 'ru' | 'en'; lines: readonly LyricsLine[]; creditKey: string; synced?: boolean }
export type TrackSort = 'added' | 'title' | 'artist' | 'duration';
export type SettingValue = string | number | boolean;
export type SettingsValues = Record<string, SettingValue>;
export interface LibrarySnapshot {
  tracks: readonly Track[]; playlists: readonly Playlist[];
  recommendations: readonly string[]; history: readonly string[];
}
export interface SearchFilters { source: SourceKind | 'all'; type: 'tracks' | 'artists' | 'playlists' }
export interface SearchResults { tracks: readonly Track[]; artists: readonly Artist[]; playlists: readonly Playlist[] }
export type Unsubscribe = () => void;
