import { verifyAsync } from '@noble/ed25519';
import pinnedKey from './update-key.json';
import { APP_CHANNEL } from './build';
import { RELEASES_URL } from './repository';
import type { ReleaseChannel } from './build';
import type { HttpClient } from './http';
import type { Unsubscribe } from './types';

export const UPDATE_CONTEXT = 'SoundSense/update-manifest/v1\n';
export const DEFAULT_UPDATE_URL = `${RELEASES_URL}/${APP_CHANNEL}.json`;
export type UpdatePlatform = 'android' | 'linux-appimage' | 'windows';
export interface UpdateArtifact { filename: string; size: number; sha256: string; urls: readonly string[] }
export interface UpdateManifest {
  schema: 1; version: string; versionCode: number; publishedAt: string; channel?: ReleaseChannel;
  notes: { ru: readonly string[]; en: readonly string[] };
  artifacts: Partial<Record<UpdatePlatform, UpdateArtifact>>;
}
export interface SignedUpdate { schema: 1; payload: string; signature: string }
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'behind' | 'available' | 'downloading' | 'ready' | 'installing' | 'permission' | 'error';
export interface UpdateState { phase: UpdatePhase; manifest?: UpdateManifest; downloaded: number; total: number; error?: 'network' | 'signature' | 'invalid' | 'channel' | 'rollback' | 'download' | 'install' | 'unsupported'; source?: string }
export interface UpdateInstaller {
  download(artifact: UpdateArtifact, progress: (bytes: number) => void, signal: AbortSignal, versionCode: number): Promise<string>;
  install(token: string): Promise<'opened' | 'permission'>;
}
export interface UpdatesApi {
  getSnapshot(): UpdateState; subscribe(listener: (state: UpdateState) => void): Unsubscribe;
  check(options?: { silent?: boolean }): Promise<void>; download(): Promise<void>; install(): Promise<void>; cancel(): void;
  readonly supported: boolean; readonly installed: { version: string; versionCode: number };
}
export class UpdateFailure extends Error { constructor(readonly code: NonNullable<UpdateState['error']>) { super(code); } }
export function hexBytes(input: string): Uint8Array { if (!/^(?:[a-f\d]{2})+$/i.test(input)) throw new UpdateFailure('invalid'); return Uint8Array.from(input.match(/../g)!, value => parseInt(value, 16)); }
function https(input: unknown): input is string { if (typeof input !== 'string' || input.length > 4096) return false; try { const url = new URL(input); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; } catch { return false; } }
export async function verifyUpdate(text: string, publicKey = pinnedKey.publicKey): Promise<UpdateManifest> {
  if (text.length > 200_000) throw new UpdateFailure('invalid');
  let envelope: SignedUpdate;
  try { envelope = JSON.parse(text); } catch { throw new UpdateFailure('invalid'); }
  if (!envelope || envelope.schema !== 1 || typeof envelope.payload !== 'string' || !/^[A-Za-z\d+/]*={0,2}$/.test(envelope.payload) || typeof envelope.signature !== 'string' || !/^[a-f\d]{128}$/i.test(envelope.signature)) throw new UpdateFailure('signature');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(envelope.payload), value => value.charCodeAt(0)); } catch { throw new UpdateFailure('invalid'); }
  const prefix = new TextEncoder().encode(UPDATE_CONTEXT), message = new Uint8Array(prefix.length + bytes.length); message.set(prefix); message.set(bytes, prefix.length);
  try { if (!await verifyAsync(hexBytes(envelope.signature), message, hexBytes(publicKey), { zip215: false })) throw new Error('Signature mismatch'); } catch { throw new UpdateFailure('signature'); }
  let manifest: UpdateManifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new UpdateFailure('invalid'); }
  if (!manifest || manifest.schema !== 1 || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(manifest.version) || !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 || !Number.isFinite(Date.parse(manifest.publishedAt)) || !manifest.artifacts || typeof manifest.artifacts !== 'object') throw new UpdateFailure('invalid');
  if (manifest.channel !== undefined && manifest.channel !== 'stable' && manifest.channel !== 'beta') throw new UpdateFailure('invalid');
  if (!manifest.notes || !['ru', 'en'].every(locale => { const notes = manifest.notes[locale as 'ru' | 'en']; return Array.isArray(notes) && notes.length <= 100 && notes.every(line => typeof line === 'string' && line.length <= 2000); })) throw new UpdateFailure('invalid');
  for (const [platform, artifact] of Object.entries(manifest.artifacts)) {
    if (!['android', 'linux-appimage', 'windows'].includes(platform) || !artifact || !/^[a-z\d][a-z\d._-]{0,180}$/i.test(artifact.filename) || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > 512 * 1024 * 1024 || !/^[a-f\d]{64}$/i.test(artifact.sha256) || !Array.isArray(artifact.urls) || !artifact.urls.length || artifact.urls.length > 12 || !artifact.urls.every(https)) throw new UpdateFailure('invalid');
  }
  if (!Object.keys(manifest.artifacts).length) throw new UpdateFailure('invalid');
  return manifest;
}
export function createUpdates(options: { http: HttpClient; installed: { version: string; versionCode: number }; platform: UpdatePlatform; channel?: ReleaseChannel; urls: () => readonly string[]; installer?: UpdateInstaller; storage?: Pick<Storage, 'getItem' | 'setItem'>; publicKey?: string }): UpdatesApi {
  let state: UpdateState = { phase: 'idle', downloaded: 0, total: 0 }, token = '', controller: AbortController | undefined;
  // Ed25519 verification in JS is slow on phones; periodic checks usually fetch the same manifest.
  let verified: { text: string; manifest: UpdateManifest } | undefined;
  // Rollback protection is per channel: the newest manifest seen from that channel. It does not start
  // at the installed version, so switching from beta to an older stable is not a "rollback" error.
  const channel = options.channel ?? 'stable';
  const highestKey = channel === 'stable' ? 'ss_update_highest_seen' : `ss_update_highest_seen_${channel}`;
  let highest = 0;
  try { highest = Number(options.storage?.getItem(highestKey)) || 0; } catch {}
  const listeners = new Set<(state: UpdateState) => void>();
  const publish = (value: UpdateState) => { state = value; for (const listener of listeners) listener(state); };
  return {
    supported: !!options.installer, installed: options.installed, getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async check(checkOptions = {}) {
      if (['downloading', 'ready', 'permission', 'installing', 'checking'].includes(state.phase)) return;
      controller?.abort(); const current = controller = new AbortController();
      // A background check never flashes "checking" or replaces a known result with a network error.
      const before = state, silent = !!checkOptions.silent && ['available', 'current', 'behind'].includes(before.phase);
      if (!silent) publish({ phase: 'checking', downloaded: 0, total: 0 }); let error: UpdateState['error'] = 'network';
      for (const url of [...new Set(options.urls())].slice(0, 12)) {
        if (!https(url)) { error = 'invalid'; continue; }
        try {
          const text = await options.http.text(url, current.signal);
          const manifest = verified?.text === text ? verified.manifest : await verifyUpdate(text, options.publicKey);
          verified = { text, manifest };
          if (current.signal.aborted) return;
          // Manifests published before channel separation belong to the original stable package.
          if ((manifest.channel ?? 'stable') !== channel) throw new UpdateFailure('channel');
          if (manifest.versionCode < highest) throw new UpdateFailure('rollback');
          highest = Math.max(highest, manifest.versionCode); try { options.storage?.setItem(highestKey, String(highest)); } catch {}
          // 'behind': the chosen channel is older than what is installed (beta → stable). Android cannot
          // downgrade in place; the update arrives once that channel releases a newer build.
          publish({ phase: manifest.versionCode > options.installed.versionCode ? 'available' : manifest.versionCode < options.installed.versionCode ? 'behind' : 'current', manifest, source: url, downloaded: 0, total: manifest.artifacts[options.platform]?.size ?? 0 }); return;
        } catch (failure) { if (current.signal.aborted) return; if (failure instanceof UpdateFailure) error = failure.code; }
      }
      if (silent) { if (state !== before) publish(before); return; }
      publish({ phase: 'error', error, downloaded: 0, total: 0 });
    },
    async download() {
      if (!['available', 'error'].includes(state.phase) || !state.manifest) return;
      const artifact = state.manifest.artifacts[options.platform];
      if (!options.installer || !artifact) { publish({ ...state, phase: 'error', error: 'unsupported' }); return; }
      controller?.abort(); const current = controller = new AbortController(); token = '';
      publish({ ...state, phase: 'downloading', downloaded: 0, total: artifact.size, error: undefined });
      try { token = await options.installer.download(artifact, bytes => { if (!current.signal.aborted) publish({ ...state, downloaded: Math.min(artifact.size, Math.max(0, bytes)) }); }, current.signal, state.manifest.versionCode); if (!current.signal.aborted) publish({ ...state, phase: 'ready', downloaded: artifact.size }); }
      catch { if (!current.signal.aborted) publish({ ...state, phase: 'error', error: 'download' }); }
    },
    async install() {
      if (!options.installer || !token || !['ready', 'permission'].includes(state.phase)) return;
      publish({ ...state, phase: 'installing', error: undefined });
      try { const result = await options.installer.install(token); publish({ ...state, phase: result === 'permission' ? 'permission' : 'ready' }); }
      catch { publish({ ...state, phase: 'error', error: 'install' }); }
    },
    cancel() { controller?.abort(); publish({ ...state, phase: state.manifest ? 'available' : 'idle', error: undefined, downloaded: 0 }); },
  };
}
