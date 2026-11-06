import type { LibrarySnapshot, Lyrics, PlayerState, SearchFilters, SearchResults, SettingsValues, SettingValue, Track, TrackSort, Unsubscribe, Waveform } from './types';
import type { ImportChoice, ImportCollection, ImportJob, ImportRequest, ImportSource } from './imports';
import type { MusicLink } from './links';
import type { EnvironmentApi } from './environment';
import type { HapticsApi } from './haptics';
import type { Extensions } from './runtime';
import type { LocalAudioMetadata, LocalFileSelection, LocalAudioFile, LocalScanProgress } from './local';
import type { ChartsApi } from './charts';
import type { UpdatesApi } from './updates';
import type { DiagnosticsApi } from './diagnostics';
export interface LibraryApi {
  getSnapshot(): LibrarySnapshot;
  subscribe(listener: (snapshot: LibrarySnapshot) => void): Unsubscribe;
  getTrack(id: string): Track | undefined;
  getPlaylistTracks(id: string, query?: string, sort?: TrackSort): readonly Track[];
  setLiked(id: string, liked: boolean): void;
  addToPlaylist(playlistId: string, trackId: string): void;
  addToPlaylistBatch?(playlistId: string, trackIds: readonly string[]): void;
  createPlaylist(title: string): string;
  removeFromPlaylist(playlistId: string, trackId: string): void;
  deletePlaylist(playlistId: string): void;
  addTracks(tracks: readonly Track[]): void;
  recordPlay(trackId: string): void;
  /** How many times each track was started (for the taste profile). */
  getPlayCounts?(): Readonly<Record<string, number>>;
  setRecommendations?(trackIds: readonly string[]): void;
  /** Device-measured loudness (dBFS RMS) for normalization; may analyse the stream. */
  getLoudness?(trackId: string): Promise<number | undefined>;
  setDownloaded(id: string, downloaded: boolean): void;
  setDownloadedBatch?(updates: readonly { id: string; downloaded: boolean }[]): void;
  /** Device sync: applies what another device sent, in one change (src/core/sync). */
  applyRemote?(changes: import('./sync/engine').RemoteChanges): void;
  resolvePlayback(trackId: string): Promise<{ source: import('./types').TrackSource | null; uri?: string; switchedFrom?: import('./types').SourceKind }>;
  getWaveform(trackId: string, signal?: AbortSignal): Promise<Waveform | null>;
  subscribeWaveform?(trackId: string, listener: (waveform: Waveform) => void): Unsubscribe;
  /** Bass energy of the track, 20 frames per second, 0–255 (device analysis; undefined where unavailable). */
  getRhythm?(trackId: string, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  setWaveformTargets?(trackIds: readonly string[]): void;
}
export interface SearchApi {
  search(query: string, filters: SearchFilters, signal?: AbortSignal, partial?: (results: SearchResults) => void): Promise<SearchResults>;
  getRecent(): readonly string[];
  remember(query: string): void;
  clearRecent(): void;
}
export interface PlayerApi {
  getSnapshot(): PlayerState;
  subscribe(listener: (state: PlayerState) => void): Unsubscribe;
  /** Current position straight from the audio clock (extrapolated between native reports); cheap to call every frame. */
  livePosition?(): { position: number; rate: number; playing: boolean };
  play(trackIds: readonly string[], index?: number): void;
  toggle(): void;
  next(): void;
  /** false always selects the previous entry instead of restarting the current one. */
  previous(restartIfPlayed?: boolean): void;
  skipTo(entryId: string): void;
  seek(seconds: number): void;
  setShuffle(enabled: boolean): void;
  cycleRepeat(): void;
  enqueue(trackId: string, next?: boolean): void;
  move(entryId: string, toIndex: number): void;
  remove(entryId: string): void;
  clearUpcoming(): void;
  resume(): void;
  setSleepTimer(minutes: number | 'track' | null): void;
  dispose(): void;
}
export interface LyricsApi { getLyrics(trackId: string, signal?: AbortSignal): Promise<Lyrics | null> }
export interface SettingsApi {
  getSnapshot(): SettingsValues;
  subscribe(listener: (values: SettingsValues) => void): Unsubscribe;
  set(key: string, value: SettingValue): void;
  setMany(values: SettingsValues): void;
  reset(keys?: readonly string[]): void;
  isPersistent(): boolean;
}
export interface FilesApi {
  /** Save a UTF-8 JSON document with an explicit user-selected destination on Android. */
  saveJson(filename: string, text: string, purpose?: 'diagnostics'): Promise<'saved' | 'cancelled'>;
  readClipboard(): Promise<string>;
  pickFolder(): Promise<readonly { name: string; uri: string }[] | null>;
  pickAudio(kind: 'files' | 'folder'): Promise<LocalFileSelection | null>;
  readAudioMetadata(files: readonly LocalAudioFile[], progress: (value: LocalScanProgress) => void, signal?: AbortSignal): Promise<readonly LocalAudioMetadata[]>;
}
export interface ImportApi {
  getSnapshot(): ImportJob | null;
  subscribe(listener: (job: ImportJob | null) => void): Unsubscribe;
  start(request: ImportRequest): void;
  retry(): void;
  cancel(): void;
  resolve(index: number, candidateId: string | null, kind?: 'uncertain' | 'missing'): void;
  authorize(source: import('./imports').ImportSource): Promise<void>;
  loginYandex(): Promise<readonly ImportCollection[]>;
  inspect?(source: ImportSource, link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]>;
  resolveLink(link: MusicLink): Promise<MusicLink>;
  openTrack(link: MusicLink): Promise<string>;
  dispose(): void;
}
export interface PlaybackPowerState { unrestricted: boolean; powerSave: boolean }
export interface PlaybackPowerApi { getStatus(): Promise<PlaybackPowerState>; request(): Promise<void>; subscribe(listener: (value: PlaybackPowerState) => void): () => void }
export interface AppApi {
  playbackPower?: PlaybackPowerApi;
  performance?: { sampleTransition(durationMs: number): Promise<Record<string, number | string | boolean>> };
  account?: import('./accounts').AccountApi;
  /** Desktop: false when there is no system keyring and account tokens sit in a file only this user can read. */
  accountEncrypted?(): Promise<boolean>;
  audioSettings?: import('./audio-settings').AudioSettingsApi;
  offline?: import('./offline').OfflineApi;
  /** Device-to-device sync (likes, playlists, history, synced settings). */
  sync?: import('./sync/engine').SyncApi;
  library: LibraryApi; search: SearchApi; player: PlayerApi;
  lyrics: LyricsApi; settings: SettingsApi; files: FilesApi; imports: ImportApi; environment: EnvironmentApi; haptics: HapticsApi;
  extensions: Extensions;
  charts?: ChartsApi;
  recommendations?: import('./recommendations').RecommendationsApi;
  updates?: UpdatesApi;
  /** Plugins (beta channel only). */
  plugins?: import('./plugins/host').PluginsApi;
  pluginCatalog?: import('./plugins/catalog').PluginCatalogApi;
  /** Update channel chosen in Settings. Changing it reloads the app (beta loads the debug tools). */
  releaseChannel?: { readonly current: import('./build').ReleaseChannel; set(channel: import('./build').ReleaseChannel): void };
  diagnostics?: DiagnosticsApi;
  waveCache?: {
    getStats(): Promise<{ bytes: number; count: number; limit: number }>;
    clear(): Promise<void>;
  };
  capabilities?: { downloads: boolean; soundProcessing: boolean };
  /** Animated covers (Apple Music motion artwork). */
  liveCovers?: import('./live-covers').LiveCoversApi;
}
