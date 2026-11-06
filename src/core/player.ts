import type { LibraryApi, PlayerApi, SettingsApi } from './api';
import type { AudioEngine, AudioSlot } from './audio-engine';
import { playbackFailureReason } from './audio-engine';
import type { DiagnosticsApi } from './diagnostics';
import { errorDetails } from './diagnostics';
import { planCrossfade } from './crossfade';
import type { PlayerState, QueueEntry } from './types';

const PLAYER_STORAGE_KEY = 'ss_player_v2', POSITION_STORAGE_KEY = 'ss_player_position_v1';
/** A real transport. Media clocks, not UI timers, determine playback position. */
export function createPlayer(library: LibraryApi, settings: SettingsApi, audio: AudioEngine, storage?: Pick<Storage, 'getItem' | 'setItem'>, diagnostics?: DiagnosticsApi, processing?: import('./audio-settings').AudioSettingsApi): PlayerApi {
  let sequence = 0, generation = 0, transitionId = 0, noticeId = 0, buffering = 0, disposed = false;
  const entry = (trackId: string): QueueEntry => ({ id: `queue-${++sequence}`, trackId });
  let state: PlayerState = { queue: [], currentIndex: -1, trackId: null, position: 0, playing: false, shuffle: false, repeat: 'off' };
  try {
    const saved = JSON.parse(storage?.getItem(PLAYER_STORAGE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.queue) && saved.queue.length && saved.queue.every((item: QueueEntry) => typeof item.id === 'string' && library.getTrack(item.trackId)) && Number.isInteger(saved.currentIndex) && saved.queue[saved.currentIndex]?.trackId === saved.trackId && Number.isFinite(saved.position)) {
      state = { ...state, queue: saved.queue, trackId: saved.trackId, currentIndex: saved.currentIndex, position: Math.max(0, Math.min(saved.position, library.getTrack(saved.trackId)!.duration)), repeat: ['one', 'all'].includes(saved.repeat) ? saved.repeat : 'off' };
      sequence = Math.max(0, ...state.queue.map(item => Number(item.id.split('-').at(-1)) || 0));
      const resume = JSON.parse(storage?.getItem(POSITION_STORAGE_KEY) ?? 'null');
      if (resume && resume.trackId === state.trackId && Number.isFinite(resume.position)) state = { ...state, position: Math.max(0, Math.min(resume.position, library.getTrack(state.trackId!)!.duration)) };
    }
  } catch { /* Empty state is valid. No demo queue is injected. */ }
  let active: AudioSlot = 'a', prepared = '', nextPrepared = '', originalOrder: readonly QueueEntry[] | null = null;
  let nextPreparing: { id: string; slot: AudioSlot; promise: Promise<void> } | undefined;
  const other = (slot: AudioSlot): AudioSlot => slot === 'a' ? 'b' : 'a';
  const waves = new Map<string, readonly number[]>(), listeners = new Set<(state: PlayerState) => void>();
  const waveSubscriptions = new Map<string, () => void>();
  let timer: ReturnType<typeof setInterval> | undefined, saveTimer: ReturnType<typeof setTimeout> | undefined, lastSaved = 0, lastTick = performance.now();
  let overlapEnd = 0, sleepEnd = 0;
  // Native hand-off (see AudioEngine.arm): the key of the plan the engine holds, and since when it is overdue.
  let armedKey = '', armOverdue = 0;
  let savedQueue: unknown, savedKey = '';
  function persist() {
    const { crossfade: _crossfade, transition: _transition, notice: _notice, resolving: _resolving, sleepTimer: _sleepTimer, ...resume } = state;
    try {
      // The queue can hold thousands of entries. Rewrite it only when it changes;
      // the resume position goes to its own tiny key every couple of seconds.
      const key = `${resume.trackId}|${resume.currentIndex}|${resume.shuffle}|${resume.repeat}`;
      if (savedQueue !== resume.queue || savedKey !== key) { storage?.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ ...resume, playing: false })); savedQueue = resume.queue; savedKey = key; }
      storage?.setItem(POSITION_STORAGE_KEY, JSON.stringify({ trackId: resume.trackId, position: resume.position }));
      lastSaved = Date.now();
    } catch { /* Playback remains usable if storage is denied. */ }
  }
  function publish(next: PlayerState) {
    const previous = state; state = next;
    if (previous.trackId !== state.trackId || previous.queue !== state.queue || previous.repeat !== state.repeat) updateWaveforms();
    if (state.playing && !state.resolving && state.trackId && (previous.trackId !== state.trackId || !previous.playing || previous.resolving)) library.recordPlay(state.trackId);
    const running = state.playing || !!state.sleepTimer;
    if (running && !timer) { lastTick = performance.now(); timer = setInterval(tick, tickEvery()); }
    if (!running && timer) { clearInterval(timer); timer = undefined; }
    if (!saveTimer && (!state.playing || Date.now() - lastSaved > 2000)) saveTimer = setTimeout(() => { saveTimer = undefined; persist(); }, 500);
    syncArm();
    for (const listener of listeners) listener(state);
  }
  function crossfadePlan(track: import('./types').Track, next: import('./types').Track, rate: number) {
    return planCrossfade({ from: track, to: next, fromWave: waves.get(track.id) ?? [], toWave: waves.get(next.id) ?? [], seconds: Number(settings.getSnapshot().crossfade ?? 3) * rate, repeat: state.repeat, sameAlbumGapless: settings.getSnapshot().sameAlbumGapless !== false });
  }
  /** What the engine should do by itself at the end of this track; null when JavaScript decides. */
  function handOffPlan() {
    if (!audio.arm || !state.playing || state.resolving || state.crossfade || !state.trackId || prepared !== state.trackId || state.repeat === 'one' || state.sleepTimer) return null;
    const index = nextIndex(), next = index === null ? undefined : library.getTrack(state.queue[index]!.trackId);
    if (!next || nextPrepared !== next.id) return null;
    const track = library.getTrack(state.trackId); if (!track) return null;
    const rate = audio.clock?.(active)?.rate ?? 1, plan = crossfadePlan(track, next, rate);
    return { track: next, at: plan ? plan.fromStart : -1, until: plan ? plan.fromEnd : track.duration + 3600, duration: plan ? plan.duration : 0, position: plan ? plan.toStart : 0 };
  }
  function syncArm() {
    if (!audio.arm || disposed) return;
    const plan = handOffPlan();
    const key = plan ? [active, plan.track.id, plan.at.toFixed(2), plan.until.toFixed(2), plan.duration.toFixed(2), plan.position.toFixed(2)].join('|') : '';
    if (key === armedKey) return;
    if (!plan && !armedKey) return;
    armedKey = key; armOverdue = 0;
    audio.arm(active, other(active), plan);
  }
  /** The engine switched to the armed next track on its own (screen off, notification "next"). */
  function nativeAdvance(event: import('./audio-engine').AudioEvent) {
    armedKey = ''; armOverdue = 0;
    const latency = event.at ? Math.max(0, Date.now() - event.at) : 0, hidden = typeof document !== 'undefined' && document.hidden;
    let index = nextIndex();
    if (index === null || state.queue[index]?.trackId !== event.trackId) {
      // Queue changed meanwhile: follow what is actually playing.
      const found = state.queue.findIndex((item, at) => at > state.currentIndex && item.trackId === event.trackId);
      diagnostics?.record('player', 'handoff.mismatch', { expected: index === null ? null : state.queue[index]?.trackId, playing: event.trackId, found }, 'warn');
      if (found < 0) return; index = found;
    }
    if (event.slot !== active) { diagnostics?.record('player', 'handoff.slot', { slot: event.slot, active }, 'warn'); return; }
    const from = state.trackId!, to = state.queue[index]!.trackId, seconds = event.seconds ?? 0, position = event.position ?? 0;
    diagnostics?.record('player', 'handoff.received', { trackId: to, kind: event.manual ? 'manual' : seconds > 0 ? 'crossfade' : 'end', latencyMs: latency, hidden });
    active = other(active); prepared = to; nextPrepared = ''; nextPreparing = undefined; buffering++; syncLoop();
    const track = library.getTrack(to); if (track) audio.select?.(active, track);
    // The crossfade itself runs in the engine; the state carries only the transition for the
    // animations. The next track is prepared right away (the engine waits for the fade to end),
    // so nothing here depends on a WebView timer that Android may throttle in the background.
    overlapEnd = 0;
    const transition = hidden ? undefined : event.manual ? { id: ++transitionId, kind: 'manual' as const, from, to, duration: 240, direction: 1 as const } : seconds > 0 ? { id: ++transitionId, kind: 'crossfade' as const, from, to, duration: Math.max(0, seconds * 1000 - latency), direction: 1 as const } : undefined;
    publish({ ...state, currentIndex: index, trackId: to, position, crossfade: undefined, transition });
    void prepareNext();
  }
  // Nobody sees the clock while the app is hidden: tick once a second instead of 12 times
  // (transitions are switched by the engine; see AudioEngine.arm).
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const tickEvery = () => hidden() ? 1000 : 80;
  const onVisibility = () => { if (!timer) return; clearInterval(timer); timer = setInterval(tick, tickEvery()); if (!hidden()) tick(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  const nextIndex = (): number | null => state.currentIndex + 1 < state.queue.length ? state.currentIndex + 1 : state.repeat === 'all' && state.queue.length > 1 ? 0 : null;
  function updateWaveforms() {
    const index = nextIndex();
    const targets = settings.getSnapshot().waveform === false ? [] : [...new Set([state.trackId, index === null ? undefined : state.queue[index]?.trackId].filter((id): id is string => !!id))];
    library.setWaveformTargets?.(targets);
    // Without the waveform view, loudness is still measured for normalization.
    if (!targets.length && state.trackId && settings.getSnapshot().normalize !== false && !loudness.has(state.trackId)) { const id = state.trackId; void library.getLoudness?.(id).then(level => { if (Number.isFinite(level)) learnLoudness(id, level!); }).catch(() => {}); }
    for (const [id, unsubscribe] of waveSubscriptions) if (!targets.includes(id)) { unsubscribe(); waveSubscriptions.delete(id); }
    for (const id of waves.keys()) if (!targets.includes(id)) waves.delete(id);
    for (const id of targets) {
      const accept = (value: import('./types').Waveform | null) => {
        if (!disposed && waveSubscriptions.has(id) && value?.status !== 'building' && value?.status !== 'deferred') waves.set(id, value?.samples ?? []);
        if (!disposed && Number.isFinite(value?.loudness)) learnLoudness(id, value!.loudness!);
        else if (!disposed && value?.status !== 'building' && value?.status !== 'deferred' && settings.getSnapshot().normalize !== false && !loudness.has(id)) void library.getLoudness?.(id).then(level => { if (Number.isFinite(level)) learnLoudness(id, level!); }).catch(() => {});
      };
      if (!waveSubscriptions.has(id)) {
        waveSubscriptions.set(id, library.subscribeWaveform?.(id, accept) ?? (() => {}));
        void library.getWaveform(id).then(accept).catch(() => {});
      }
    }
  }
  async function prepareNext() {
    const index = nextIndex(), nextId = index === null ? undefined : state.queue[index]?.trackId;
    // Waveform analysis never delays preparation of the next audio file.
    updateWaveforms();
    if (!nextId || state.crossfade || nextPrepared === nextId || nextPreparing?.id === nextId && nextPreparing.slot === other(active)) return;
    const token = ++buffering;
    const track = library.getTrack(nextId); if (!track) return;
    if (processing) audio.processing?.(other(active), processingFor(track.id));
    const pending = nextPreparing = { id: nextId, slot: other(active), promise: audio.prepare(other(active), track, 'preload') };
    try { await pending.promise; if (token === buffering && !disposed) { nextPrepared = nextId; syncArm(); } }
    catch { /* A failed preload is retried when that track is selected. */ }
    finally { if (nextPreparing === pending) nextPreparing = undefined; }
  }
  // Loudness normalization: bring every track to about -14 dBFS RMS (cut up to 9 dB, boost up to 6 dB).
  const loudness = new Map<string, number>(), TARGET = -14;
  function normalizationGain(id: string): number {
    if (settings.getSnapshot().normalize === false) return 1;
    const level = loudness.get(id); if (level === undefined) return 1;
    return 10 ** (Math.max(-9, Math.min(6, TARGET - level)) / 20);
  }
  function processingFor(id: string) { const value = processing!.get(id); const gain = normalizationGain(id); return gain === 1 ? value : { ...value, volume: value.volume * gain }; }
  function learnLoudness(id: string, level: number) {
    if (loudness.get(id) === level) return; loudness.set(id, level); if (loudness.size > 200) loudness.delete(loudness.keys().next().value!);
    if (!processing) return;
    if (state.trackId === id) audio.processing?.(active, processingFor(id));
    else if (nextPrepared === id || state.crossfade?.from === id) audio.processing?.(other(active), processingFor(id));
  }
  function syncLoop() { audio.loop?.(active, state.repeat === 'one'); audio.loop?.(other(active), false); }
  const retries = new Map<string, number>();
  function retry(id: string, reason: string): boolean {
    if (!['auth', 'network', 'timeout', 'decoder', 'unavailable'].includes(reason)) return false;
    const last = retries.get(id) ?? 0; if (Date.now() - last < 60_000) return false;
    retries.set(id, Date.now()); if (retries.size > 50) retries.delete(retries.keys().next().value!); return true;
  }
  function cancelOverlap() { if (state.crossfade) audio.stop(other(active)); state = { ...state, crossfade: undefined }; overlapEnd = 0; }
  async function change(index: number, playing = state.playing, manual = true, direction: 1 | -1 = 1, position = 0) {
    const token = ++generation, item = state.queue[index], from = state.trackId;
    const reuseNext = !!item && nextPrepared === item.trackId && !state.crossfade;
    const pendingNext = item && nextPreparing?.id === item.trackId && nextPreparing.slot === other(active) && !state.crossfade ? nextPreparing.promise : undefined;
    const started = performance.now(); diagnostics?.record('player', 'prepare.start', { trackId: item?.trackId, previous: from, index, playing });
    buffering++; nextPrepared = ''; nextPreparing = undefined; cancelOverlap();
    const old = active; active = other(active); if (!reuseNext && !pendingNext) audio.stop(active);
    if (manual && state.playing && from) audio.fadeOut(old, .3); else audio.stop(old);
    prepared = '';
    publish({ ...state, currentIndex: item ? index : -1, trackId: item?.trackId ?? null, position, playing: !!item && playing, resolving: !!item,
      transition: manual && item && from && item.trackId !== from ? { id: ++transitionId, kind: 'manual', from, to: item.trackId, duration: 240, direction } : undefined });
    if (!item) { audio.stop(old); return; }
    const track = library.getTrack(item.trackId)!;
    if (reuseNext || pendingNext) audio.select?.(active, track);
    if (processing) audio.processing?.(active, processingFor(track.id));
    try {
      const minimumFade = manual && playing && from ? new Promise(resolve => setTimeout(resolve, 300)) : Promise.resolve();
      const selected = active;
      await Promise.all([reuseNext ? Promise.resolve() : pendingNext ? pendingNext.catch(error => { if (token !== generation || disposed) throw error; return audio.prepare(selected, track, 'play'); }) : audio.prepare(active, track, 'play'), minimumFade]);
      if (token !== generation || disposed) return;
      audio.stop(old); prepared = track.id; syncLoop();
      if (state.playing) { audio.gain(active, 1); audio.start(active, state.position); }
      diagnostics?.record('player', 'prepare.ready', { trackId: track.id, ms: Math.round(performance.now() - started) });
      publish({ ...state, resolving: false }); void prepareNext();
    } catch (error) {
      if (token !== generation || disposed || error instanceof DOMException && error.name === 'AbortError') return;
      const reason = playbackFailureReason(error);
      // Stream links expire and networks blip: one silent retry with a freshly resolved link first.
      if (retry(track.id, reason)) { diagnostics?.record('player', 'prepare.retry', { trackId: track.id, reason }); audio.stop(old); prepared = ''; setTimeout(() => { if (token === generation && !disposed) void change(index, playing, false, direction, position); }, 700); return; }
      diagnostics?.record('player', 'prepare.failed', { trackId: track.id, title: track.title, reason, ms: Math.round(performance.now() - started), ...errorDetails(error) }, 'error');
      audio.stop(old); publish({ ...state, playing: false, resolving: false, notice: { id: ++noticeId, key: `player.error.${reason}` } });
    }
  }
  function advance(automatic = false) {
    if (!state.queue.length) return;
    if (automatic && state.repeat === 'one') { cancelOverlap(); audio.seek(active, 0); audio.start(active, 0); publish({ ...state, position: 0 }); return; }
    const index = nextIndex();
    if (index === null) { audio.pause(active); publish({ ...state, playing: false, position: library.getTrack(state.trackId ?? '')?.duration ?? 0, crossfade: undefined }); }
    else void change(index, state.playing, !automatic);
  }
  function beginOverlap(index: number, seconds: number, position: number) {
    const from = state.trackId!, to = state.queue[index]!.trackId, outgoing = active; active = other(active);
    if (audio.crossfade) audio.crossfade(outgoing, active, seconds, position); else { audio.gain(active, 0); audio.start(active, position); }
    prepared = to; nextPrepared = ''; overlapEnd = performance.now() + seconds * 1000; syncLoop();
    publish({ ...state, currentIndex: index, trackId: to, position, crossfade: { from, to, progress: 0, duration: seconds, fromPosition: state.position, toPosition: position }, transition: { id: ++transitionId, kind: 'crossfade', from, to, duration: seconds * 1000, direction: 1 } });
  }
  function tick() {
    const now = performance.now(), elapsed = Math.max(0, (now - lastTick) / 1000); lastTick = now;
    if (state.sleepTimer && !state.sleepTimer.endOfTrack) {
      const remaining = Math.max(0, (sleepEnd - now) / 1000);
      if (!remaining) { audio.pause(active); audio.stop(other(active)); publish({ ...state, playing: false, sleepTimer: undefined, crossfade: undefined }); return; }
      state = { ...state, sleepTimer: { ...state.sleepTimer, remaining, gain: Math.min(1, remaining / 10) } };
      if (!state.crossfade) audio.gain(active, Math.min(1, remaining / 10));
    }
    if (!state.playing || state.resolving || !state.trackId) { if (state.sleepTimer) publish({ ...state }); return; }
    const track = library.getTrack(state.trackId)!;
    const clock = audio.clock?.(active), position = Math.min(track.duration, Math.max(0, clock?.position ?? state.position + elapsed));
    if (clock?.buffering) { if (state.sleepTimer) publish({ ...state }); return; }
    if (state.crossfade) {
      const progress = Math.min(1, Math.max(0, 1 - (overlapEnd - now) / (state.crossfade.duration * 1000)));
      if (!audio.crossfade) { audio.gain(active, Math.sin(progress * Math.PI / 2)); audio.gain(other(active), Math.cos(progress * Math.PI / 2)); }
      if (progress >= 1) { audio.stop(other(active)); publish({ ...state, position, crossfade: undefined }); void prepareNext(); }
      else publish({ ...state, position, crossfade: { ...state.crossfade, progress, fromPosition: state.crossfade.fromPosition + elapsed, toPosition: position } });
      return;
    }
    const index = nextIndex(), next = index === null ? undefined : library.getTrack(state.queue[index]!.trackId);
    const rate = clock?.rate ?? 1;
    const plan = next ? crossfadePlan(track, next, rate) : null;
    if (armedKey) {
      // The engine switches by itself. JavaScript steps in only if it clearly did not.
      const late = clock?.ended || position >= track.duration || (plan ? position >= plan.fromEnd + .5 : false);
      if (!late) armOverdue = 0; else if (!armOverdue) armOverdue = now;
      if (!late || now - armOverdue < 2000) { publish({ ...state, position }); return; }
      diagnostics?.record('player', 'handoff.fallback', { trackId: track.id, position: Math.round(position * 1000) / 1000, ended: !!clock?.ended }, 'warn');
      armedKey = ''; armOverdue = 0; audio.arm?.(active, other(active), null);
    }
    if (plan && index !== null && nextPrepared === next?.id && position >= plan.fromStart && position < plan.fromEnd && !state.sleepTimer?.endOfTrack) { beginOverlap(index, Math.min(plan.duration, plan.fromEnd - position) / rate, plan.toStart); return; }
    if (clock?.ended || position >= track.duration) {
      if (state.sleepTimer?.endOfTrack) { audio.pause(active); publish({ ...state, position: track.duration, playing: false, sleepTimer: undefined }); }
      else advance(true);
    } else publish({ ...state, position, ...(state.sleepTimer?.endOfTrack ? { sleepTimer: { ...state.sleepTimer, remaining: track.duration - position } } : {}) });
  }
  const unsubscribe = audio.subscribe?.(event => {
    if (disposed) return;
    diagnostics?.record('system-player', event.type, { trackId: state.trackId, slot: event.slot, code: event.code, reason: event.reason, message: event.message, index: state.currentIndex, queue: state.queue.length });
    if (event.type === 'error' && (!event.slot || event.slot === active)) {
      const id = state.trackId, reason = (event.reason ?? 'decoder') as import('./types').PlaybackFailureReason;
      // A 403 from an expired CDN link is reported as "auth"; re-resolve and continue from the same place.
      if (id && retry(id, reason)) { diagnostics?.record('player', 'stream.retry', { trackId: id, reason, position: state.position }); prepared = ''; void change(state.currentIndex, true, false, 1, state.position); return; }
      audio.pause(active); publish({ ...state, playing: false, resolving: false, notice: { id: ++noticeId, key: `player.error.${reason}` } });
    }
    else if (event.type === 'advanced') nativeAdvance(event);
    else if (event.type === 'next') api.next(); else if (event.type === 'previous') api.previous(true);
    else if (event.type === 'seek' && typeof event.position === 'number' && (!event.slot || event.slot === active)) api.seek(event.position);
    else if (event.type === 'like' && state.trackId && typeof event.liked === 'boolean') library.setLiked(state.trackId, event.liked);
    else if (event.type === 'pause' && state.playing || event.type === 'play' && !state.playing) api.toggle();
  });
  const api: PlayerApi = {
    livePosition() {
      const running = state.playing && !state.resolving && !!state.trackId && prepared === state.trackId;
      const clock = running ? audio.clock?.(active) : undefined, duration = library.getTrack(state.trackId ?? '')?.duration ?? Infinity;
      return { position: Math.min(duration, clock && !clock.buffering ? clock.position : state.position), rate: clock?.rate ?? 1, playing: running && !!clock && !clock.buffering && !clock.ended };
    },
    getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    play(ids, index = 0) { const queue = ids.filter(id => library.getTrack(id)).map(entry); if (!queue.length) return; originalOrder = null; state = { ...state, queue, shuffle: false }; void change(Math.max(0, Math.min(queue.length - 1, index)), true); },
    toggle() {
      if (!state.trackId) return;
      if (state.playing) { audio.pause(active); audio.pause(other(active)); publish({ ...state, playing: false }); }
      else if (prepared !== state.trackId) void change(state.currentIndex, true, false, 1, state.position);
      else { const position = state.position >= library.getTrack(state.trackId)!.duration ? 0 : state.position; cancelOverlap(); audio.gain(active, 1); audio.start(active, position); publish({ ...state, playing: true, position }); }
    },
    resume() { if (!state.playing) this.toggle(); }, next() { advance(); },
    // Within the first 5 s: previous track; later: back to the start (also for the Android notification and headset).
    previous(restart = true) { if (!state.trackId) return; if (restart && state.position > 5) this.seek(0); else void change(Math.max(0, state.currentIndex - 1), state.playing, true, -1); },
    skipTo(id) { const index = state.queue.findIndex(item => item.id === id); if (index >= 0) void change(index, true); },
    seek(seconds) { if (!state.trackId || !Number.isFinite(seconds)) return; cancelOverlap(); const position = Math.max(0, Math.min(library.getTrack(state.trackId)!.duration, seconds)); if (prepared === state.trackId) audio.seek(active, position); publish({ ...state, position, transition: undefined }); void prepareNext(); },
    setShuffle(shuffle) {
      if (shuffle === state.shuffle) return;
      let queue = [...state.queue];
      if (shuffle) { originalOrder = [...queue]; for (let i = queue.length - 1; i > state.currentIndex + 1; i--) { const j = state.currentIndex + 1 + Math.floor(Math.random() * (i - state.currentIndex)); [queue[i], queue[j]] = [queue[j]!, queue[i]!]; } }
      else if (originalOrder) { const played = queue.slice(0, state.currentIndex + 1), ids = new Set(played.map(item => item.id)), available = new Set(queue.map(item => item.id)); queue = [...played, ...originalOrder.filter(item => available.has(item.id) && !ids.has(item.id)), ...queue.filter(item => !originalOrder!.some(old => old.id === item.id) && !ids.has(item.id))]; originalOrder = null; }
      publish({ ...state, queue, shuffle }); void prepareNext();
    },
    cycleRepeat() { publish({ ...state, repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' }); syncLoop(); void prepareNext(); },
    enqueue(trackId, next = false) { if (!library.getTrack(trackId)) return; const queue = [...state.queue]; queue.splice(next ? state.currentIndex + 1 : queue.length, 0, entry(trackId)); publish({ ...state, queue, currentIndex: state.trackId ? state.currentIndex : 0, trackId: state.trackId ?? trackId }); void prepareNext(); },
    move(id, to) { const queue = [...state.queue], from = queue.findIndex(item => item.id === id), activeId = queue[state.currentIndex]?.id; if (from < 0 || !Number.isFinite(to)) return; const [item] = queue.splice(from, 1); queue.splice(Math.max(0, Math.min(to, queue.length)), 0, item!); publish({ ...state, queue, currentIndex: queue.findIndex(item => item.id === activeId) }); void prepareNext(); },
    remove(id) { const activeId = state.queue[state.currentIndex]?.id, queue = state.queue.filter(item => item.id !== id); if (activeId === id) { state = { ...state, queue }; void change(Math.min(state.currentIndex, queue.length - 1), state.playing, false); } else { publish({ ...state, queue, currentIndex: queue.findIndex(item => item.id === activeId) }); void prepareNext(); } },
    clearUpcoming() { publish({ ...state, queue: state.queue.slice(0, state.currentIndex + 1) }); void prepareNext(); },
    setSleepTimer(minutes) { if (minutes === null) { sleepEnd = 0; publish({ ...state, sleepTimer: undefined }); audio.gain(active, 1); } else { const remaining = minutes === 'track' ? (library.getTrack(state.trackId ?? '')?.duration ?? 0) - state.position : minutes * 60; sleepEnd = performance.now() + remaining * 1000; publish({ ...state, sleepTimer: { remaining, endOfTrack: minutes === 'track', gain: 1 } }); } },
    dispose() { disposed = true; generation++; buffering++; clearInterval(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility); clearTimeout(saveTimer); persist(); unsubscribe?.(); unsubscribeSettings(); unsubscribeProcessing?.(); for (const unsubscribeWave of waveSubscriptions.values()) unsubscribeWave(); waveSubscriptions.clear(); library.setWaveformTargets?.([]); audio.dispose(); listeners.clear(); },
  };
  let normalizeSetting = settings.getSnapshot().normalize !== false;
  const unsubscribeSettings = settings.subscribe(() => {
    updateWaveforms();
    const next = settings.getSnapshot().normalize !== false;
    if (next !== normalizeSetting) { normalizeSetting = next; if (processing && state.trackId) audio.processing?.(active, processingFor(state.trackId)); }
  });
  const unsubscribeProcessing = processing?.subscribe(() => {
    if (state.trackId) audio.processing?.(active, processingFor(state.trackId));
    const id = state.crossfade?.from ?? nextPrepared;
    if (id) audio.processing?.(other(active), processingFor(id));
  });
  updateWaveforms();
  return api;
}
