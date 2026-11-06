import type { PlayerState, Playlist, Track, PlaybackFailureReason } from './types';
import type { ImportJob } from './imports';
export interface CoreEvents {
  'command:before': { domain: string; action: string; args: readonly unknown[] };
  'command:after': { domain: string; action: string };
  'track:change': { previous: string | null; trackId: string | null };
  'player:state': PlayerState; 'history:change': readonly string[];
  'player:play': PlayerState; 'player:pause': PlayerState; 'player:seek': { position: number };
  'queue:change': PlayerState['queue']; 'player:crossfade': PlayerState['crossfade'];
  'library:like': Track; 'library:unlike': Track; 'library:change': { trackIds: readonly string[] };
  'playlist:change': { playlistId: string; playlist: Playlist | null };
  'import:progress': ImportJob; 'import:done': ImportJob;
  'settings:change': { key: string; value: string | number | boolean };
  'ui:command': { command: string; slot: 'trackMenu' | 'playerButtons'; trackId?: string };
  'registry:change': { registry: string };
  'source:resolve': { trackId: string; attemptId: number; provider: string; outcome: 'selected' | 'failed' | 'unmatched'; reason?: PlaybackFailureReason; ms: number; code?: string; status?: number; message?: string };
}
/** Typed local bus. Listener failures are isolated; events are never sent off-device. */
export class EventBus {
  private listeners = new Map<keyof CoreEvents, Set<(value: never) => void>>();
  readonly errors: unknown[] = [];
  on<K extends keyof CoreEvents>(event: K, listener: (value: CoreEvents[K]) => void): () => void {
    let set = this.listeners.get(event); if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(listener as (value: never) => void); return () => set!.delete(listener as (value: never) => void);
  }
  emit<K extends keyof CoreEvents>(event: K, value: CoreEvents[K]): void {
    for (const listener of [...this.listeners.get(event) ?? []]) try { listener(value as never); } catch (error) { this.errors.push(error); if (this.errors.length > 20) this.errors.shift(); }
  }
  mutate<T>(domain: string, action: string, args: readonly unknown[], operation: () => T): T {
    this.emit('command:before', { domain, action, args }); const value = operation(); this.emit('command:after', { domain, action }); return value;
  }
  clear(): void { this.listeners.clear(); this.errors.length = 0; }
}
