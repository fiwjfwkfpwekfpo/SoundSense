import type { LibraryApi, PlayerApi, SettingsApi } from '../core/api';
import type { EnvironmentApi } from '../core/environment';
import type { AudioEngine, AudioSlot } from '../core/audio-engine';
import { audibleRange, equalPower, planCrossfade } from '../core/crossfade';
import { STORAGE_KEYS } from '../core/storage';
import type { PlayerState, QueueEntry } from '../core/types';
import { createAudioEngine } from './audio-engine';
export function createPlayer(library: LibraryApi, storage?: Pick<Storage, 'getItem' | 'setItem'>, environment?: EnvironmentApi, settings?: SettingsApi, audio: AudioEngine = createAudioEngine()): PlayerApi {
  let sequence = 0, noticeId = 0, transitionId = 0, resolution = 0, skipped = 0, persistedAt = 0;
  const entry = (trackId: string): QueueEntry => ({ id: `queue-${++sequence}`, trackId });
  let state: PlayerState = { queue: ['track-1', 'track-2', 'track-9', 'track-14', 'track-6', 'track-22'].map(entry), currentIndex: 0,
    trackId: 'track-1', position: 67, playing: false, shuffle: false, repeat: 'off' };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEYS.player) ?? 'null');
    if (saved && Array.isArray(saved.queue) && saved.queue.length && saved.queue.every((item: QueueEntry) => library.getTrack(item.trackId)) && Number.isInteger(saved.currentIndex) && saved.queue[saved.currentIndex]?.trackId === saved.trackId && Number.isFinite(saved.position)) {
      state = { ...state, queue: saved.queue, currentIndex: saved.currentIndex, trackId: saved.trackId, position: Math.max(0, Math.min(library.getTrack(saved.trackId)!.duration, saved.position)), repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off' };
      sequence = Math.max(sequence, ...state.queue.map(item => Number(item.id.split('-').at(-1)) || 0));
    }
  } catch { /* Bad resume data must not prevent startup. */ }
  let originalOrder: readonly QueueEntry[] | null = null, timer: ReturnType<typeof setInterval> | undefined, lastTick = Date.now();
  let activeSlot: AudioSlot = 'a', outgoingSlot: AudioSlot = 'b', manualRemaining = 0;
  let buffering = 0, preparedNext = '', disposed = false;
  const waves = new Map<string, readonly number[]>();
  const listeners = new Set<(state: PlayerState) => void>();
  const other = (slot: AudioSlot): AudioSlot => slot === 'a' ? 'b' : 'a';
  const emit = () => listeners.forEach(listener => listener(state));
  function persist() {
    if (!storage) return;
    const { crossfade: _crossfade, transition: _transition, resolving: _resolving, notice: _notice, sleepTimer: _sleepTimer, ...resume } = state;
    try { storage.setItem(STORAGE_KEYS.player, JSON.stringify(resume)); persistedAt = Date.now(); } catch { /* Memory remains available. */ }
  }
  function syncTimer() {
    const running = state.playing || !!state.sleepTimer && !state.sleepTimer.endOfTrack;
    if (running && !timer) { lastTick = Date.now(); timer = setInterval(tick, 1000 / 60); }
    if (!running && timer) { clearInterval(timer); timer = undefined; }
  }
  function nextIndex(): number | null {
    if (state.currentIndex + 1 < state.queue.length) return state.currentIndex + 1;
    return state.repeat === 'all' && state.queue.length > 1 ? 0 : null;
  }
  async function buffer() {
    const token = ++buffering, id = state.trackId, index = nextIndex();
    const nextId = index === null ? undefined : state.queue[index]?.trackId;
    for (const key of [...waves.keys()]) if (key !== id && key !== nextId) waves.delete(key);
    const load = async (trackId: string) => { if (!waves.has(trackId)) { try { const waveform = await library.getWaveform(trackId); if (token === buffering && !disposed) waves.set(trackId, waveform?.samples ?? []); } catch { /* Missing wave means untrimmed timing. */ } } };
    if (id) await load(id);
    if (nextId) await load(nextId);
    if (token !== buffering || disposed || state.crossfade || manualRemaining > 0 || !nextId) return;
    const track = library.getTrack(nextId);
    if (track) { await audio.prepare(other(activeSlot), track); if (token === buffering && !disposed) preparedNext = nextId; }
  }
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  function publish(next: PlayerState, prepare = false) {
    const previous = state;
    state = next; syncTimer();
    if (state.playing && state.trackId && (previous.trackId !== state.trackId || !previous.playing)) library.recordPlay(state.trackId);
    if ((!state.playing || Date.now() - persistedAt >= 1000) && !persistTimer) persistTimer = setTimeout(() => { persistTimer = undefined; persist(); }, 400);
    emit();
    if (prepare) void buffer();
    if (environment && state.playing && state.trackId && (previous.trackId !== state.trackId || !previous.playing)) void resolveCurrent(++resolution);
  }
  async function resolveCurrent(token: number) {
    const id = state.trackId; if (!id) return;
    state = { ...state, resolving: true }; emit();
    try {
      const result = await library.resolvePlayback(id);
      if (disposed || token !== resolution || id !== state.trackId || !state.playing) return;
      if (!result.source) {
        state = { ...state, resolving: false, notice: { id: ++noticeId, key: environment?.getSnapshot().online ? 'player.skipped' : 'state.notDownloaded' } }; emit();
        if (++skipped >= state.queue.length) publish({ ...state, playing: false }); else advance(false);
      } else {
        skipped = 0;
        publish({ ...state, resolving: false, ...(result.switchedFrom ? { notice: { id: ++noticeId, key: 'player.fallback', from: result.switchedFrom, to: result.source.kind } } : {}) });
      }
    } catch {
      if (token === resolution && !disposed) { state = { ...state, resolving: false, notice: { id: ++noticeId, key: 'player.skipped' } }; emit(); if (++skipped >= state.queue.length) publish({ ...state, playing: false }); else advance(false); }
    }
  }
  function gains() {
    const master = state.sleepTimer?.gain ?? 1;
    if (state.crossfade) { const gain = equalPower(state.crossfade.progress); audio.gain(outgoingSlot, gain.from * master); audio.gain(activeSlot, gain.to * master); }
    else audio.gain(activeSlot, master);
  }
  function cancelOverlap() { if (state.crossfade) audio.stop(outgoingSlot); state = { ...state, crossfade: undefined }; }
  function changeIndex(index: number, playing = state.playing, manual = true, direction: 1 | -1 = 1, position = 0) {
    const item = state.queue[index], from = state.trackId;
    cancelOverlap(); manualRemaining = manual && from && item ? .3 : 0;
    if (manualRemaining) { audio.fadeOut(activeSlot, .3); outgoingSlot = activeSlot; activeSlot = other(activeSlot); }
    else audio.stop(activeSlot);
    const track = item && library.getTrack(item.trackId);
    if (track) void audio.prepare(activeSlot, track).then(() => { if (!disposed && !manualRemaining && state.trackId === track.id && state.playing) { audio.start(activeSlot, state.position); gains(); } });
    preparedNext = '';
    publish({ ...state, currentIndex: item ? index : -1, trackId: item?.trackId ?? null, position, playing: !!item && playing, resolving: false,
      transition: from && item ? { id: ++transitionId, kind: 'manual', from, to: item.trackId, duration: manual ? 300 : 0, direction } : undefined }, true);
    lastTick = Date.now();
  }
  function advance(automatic = false) {
    if (!state.queue.length) return;
    if (automatic && state.repeat === 'one') { cancelOverlap(); audio.seek(activeSlot, 0); publish({ ...state, position: 0 }); return; }
    const index = nextIndex();
    if (index !== null) changeIndex(index, state.playing, !automatic);
    else { audio.pause(activeSlot); publish({ ...state, position: library.getTrack(state.trackId ?? '')?.duration ?? 0, playing: false, crossfade: undefined }); }
  }
  function startOverlap(index: number, seconds: number, toStart: number) {
    const to = state.queue[index]!.trackId, from = state.trackId!;
    outgoingSlot = activeSlot; activeSlot = other(activeSlot); manualRemaining = 0;
    audio.start(activeSlot, toStart); audio.gain(activeSlot, 0);
    publish({ ...state, trackId: to, currentIndex: index, position: toStart,
      crossfade: { from, to, duration: seconds, progress: 0, fromPosition: state.position, toPosition: toStart },
      transition: { id: ++transitionId, kind: 'crossfade', from, to, duration: seconds * 1000, direction: 1 } });
    preparedNext = ''; gains();
  }
  function tick() {
    const now = Date.now(); let elapsed = Math.max(0, (now - lastTick) / 1000); lastTick = now;
    const duration = library.getTrack(state.trackId ?? '')?.duration ?? 0;
    if (state.sleepTimer) {
      const remaining = state.sleepTimer.endOfTrack ? duration - state.position - (state.playing ? elapsed : 0) : state.sleepTimer.remaining - elapsed;
      if (remaining <= 0) { audio.pause(activeSlot); audio.stop(outgoingSlot); publish({ ...state, playing: false, sleepTimer: undefined, crossfade: undefined }); return; }
      state = { ...state, sleepTimer: { ...state.sleepTimer, remaining, gain: Math.min(1, remaining / 10) } }; gains();
    }
    if (!state.playing || state.resolving) { if (state.sleepTimer) emit(); return; }
    if (!duration) { publish({ ...state, playing: false }); return; }
    if (manualRemaining > 0) {
      const consumed = Math.min(manualRemaining, elapsed); manualRemaining -= consumed; elapsed -= consumed;
      if (manualRemaining <= .000001) { manualRemaining = 0; audio.stop(outgoingSlot); audio.start(activeSlot, state.position); gains(); void buffer(); }
      if (!elapsed) return;
    }
    if (state.crossfade) {
      const crossfade = { ...state.crossfade, progress: Math.min(1, state.crossfade.progress + elapsed / state.crossfade.duration), fromPosition: state.crossfade.fromPosition + elapsed, toPosition: state.crossfade.toPosition + elapsed };
      if (crossfade.progress >= 1) { audio.stop(outgoingSlot); publish({ ...state, position: crossfade.toPosition, crossfade: undefined }, true); }
      else publish({ ...state, position: crossfade.toPosition, crossfade });
      gains(); return;
    }
    const index = nextIndex(), from = library.getTrack(state.trackId!), to = index === null ? undefined : library.getTrack(state.queue[index]!.trackId);
    const seconds = Number(settings?.getSnapshot().crossfade ?? 3);
    const plan = from && to ? planCrossfade({ from, to, fromWave: waves.get(from.id) ?? [], toWave: waves.get(to.id) ?? [], seconds, repeat: state.repeat, sameAlbumGapless: settings?.getSnapshot().sameAlbumGapless !== false }) : null;
    const nextPosition = state.position + elapsed;
    if (plan && index !== null && preparedNext === to?.id && nextPosition >= plan.fromStart && state.position < plan.fromEnd && !(state.sleepTimer?.endOfTrack)) {
      const overlap = Math.max(.001, plan.fromEnd - Math.max(state.position, plan.fromStart));
      startOverlap(index, Math.min(plan.duration, overlap), plan.toStart); return;
    }
    const end = seconds > 0 && state.repeat !== 'one' && from ? audibleRange(waves.get(from.id) ?? [], duration).end : duration;
    if (nextPosition >= end) advance(true); else publish({ ...state, position: nextPosition });
  }
  const initialTrack = library.getTrack(state.trackId ?? ''); if (initialTrack) void audio.prepare(activeSlot, initialTrack);
  void buffer();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    play(ids, index = 0) {
      const queue = ids.filter(id => library.getTrack(id)).map(entry); if (!queue.length) return;
      originalOrder = null; state = { ...state, queue, shuffle: false }; changeIndex(Math.min(Math.max(0, index), queue.length - 1), true);
    },
    resume() { if (state.trackId && !state.playing) this.toggle(); },
    toggle() {
      if (!state.trackId) return;
      const playing = !state.playing, duration = library.getTrack(state.trackId)?.duration ?? 0;
      const position = state.position >= duration ? 0 : state.position;
      if (playing && !manualRemaining) { audio.start(activeSlot, position); if (state.crossfade) audio.start(outgoingSlot, state.crossfade.fromPosition); }
      else if (!playing) { audio.pause(activeSlot); audio.pause(outgoingSlot); }
      publish({ ...state, playing, position, resolving: false }); gains(); lastTick = Date.now();
    },
    next: () => advance(),
    previous(restartIfPlayed = true) { if (restartIfPlayed && state.position > 3) this.seek(0); else changeIndex(Math.max(0, state.currentIndex - 1), state.playing, true, -1); },
    skipTo(id) { const index = state.queue.findIndex(item => item.id === id); if (index >= 0) changeIndex(index, true); },
    seek(seconds) {
      cancelOverlap(); const duration = library.getTrack(state.trackId ?? '')?.duration ?? 0;
      const position = Number.isFinite(seconds) ? Math.max(0, Math.min(duration, seconds)) : 0;
      audio.seek(activeSlot, position); publish({ ...state, position, transition: undefined }); lastTick = Date.now(); gains();
    },
    setSleepTimer(minutes) { const remaining = minutes === 'track' ? (library.getTrack(state.trackId ?? '')?.duration ?? 0) - state.position : (minutes ?? 0) * 60; publish({ ...state, sleepTimer: minutes === null ? undefined : { remaining, endOfTrack: minutes === 'track', gain: 1 } }); },
    setShuffle(shuffle) {
      if (shuffle === state.shuffle) return;
      let queue = [...state.queue];
      if (shuffle) { originalOrder = [...queue]; for (let i = queue.length - 1; i > state.currentIndex + 1; i--) { const j = state.currentIndex + 1 + Math.floor(Math.random() * (i - state.currentIndex)); [queue[i], queue[j]] = [queue[j]!, queue[i]!]; } }
      else if (originalOrder) { const played = queue.slice(0, state.currentIndex + 1), playedIds = new Set(played.map(item => item.id)), available = new Set(queue.map(item => item.id)); queue = [...played, ...originalOrder.filter(item => available.has(item.id) && !playedIds.has(item.id)), ...queue.filter(item => !originalOrder!.some(original => original.id === item.id) && !playedIds.has(item.id))]; originalOrder = null; }
      publish({ ...state, queue, shuffle }, true);
    },
    cycleRepeat() { publish({ ...state, repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' }, true); },
    enqueue(trackId, next = false) { if (!library.getTrack(trackId)) return; const queue = [...state.queue]; queue.splice(next ? state.currentIndex + 1 : queue.length, 0, entry(trackId)); publish({ ...state, queue, currentIndex: state.trackId ? state.currentIndex : 0, trackId: state.trackId ?? trackId }, true); },
    move(entryId, toIndex) { const queue = [...state.queue], from = queue.findIndex(item => item.id === entryId); if (from < 0 || !Number.isFinite(toIndex)) return; const activeId = queue[state.currentIndex]?.id; const [item] = queue.splice(from, 1); queue.splice(Math.max(0, Math.min(queue.length, toIndex)), 0, item!); publish({ ...state, queue, currentIndex: queue.findIndex(item => item.id === activeId) }, true); },
    remove(entryId) {
      const activeId = state.queue[state.currentIndex]?.id, queue = state.queue.filter(item => item.id !== entryId);
      const currentIndex = activeId === entryId ? Math.min(state.currentIndex, queue.length - 1) : queue.findIndex(item => item.id === activeId);
      if (activeId === entryId) { state = { ...state, queue }; changeIndex(currentIndex, state.playing && queue.length > 0); }
      else publish({ ...state, queue, currentIndex }, true);
    },
    clearUpcoming() { publish({ ...state, queue: state.queue.slice(0, state.currentIndex + 1) }, true); },
    dispose() { disposed = true; resolution++; buffering++; if (timer) clearInterval(timer); timer = undefined; clearTimeout(persistTimer); persist(); audio.dispose(); listeners.clear(); },
  };
}
