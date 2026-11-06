<script lang="ts">
  import LyricsScreen from './Lyrics.svelte';
  import { layout } from '../layout.svelte';
  import { useModel } from '../context.svelte';
  import { motionTransition } from '../appearance/motion/runtime';
  import type { Waveform as WaveformData } from '../../core/types';
  import TrackArtwork from '../components/TrackArtwork.svelte';
  import PlayerBackground from '../components/PlayerBackground.svelte';
  import BeatVisuals from '../components/BeatVisuals.svelte';
  import Waveform from '../components/Waveform.svelte';
  import WaveformZoom from '../components/WaveformZoom.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let currentId = $derived(ui.track?.id);
  let waveform = $state<WaveformData | null>(null);
  let waveformId = $state('');
  const waveforms = new Map<string, WaveformData>();
  let nextId = $derived(ui.player?.queue[(ui.player?.currentIndex ?? -1) + 1]?.trackId);
  $effect(() => { const id = nextId; if (!id || !ui.settings.values.waveform) return; const controller = new AbortController(); void ui.api.library.getWaveform(id, controller.signal).then(value => { if (value && !controller.signal.aborted) { waveforms.set(id, value); if (waveforms.size > 4) waveforms.delete(waveforms.keys().next().value!); } }).catch(() => {}); return () => controller.abort(); });
  $effect(() => {
    const controller = new AbortController(); if (!ui.settings.values.waveform) waveform = null;
    const id = currentId;
    if (id && waveforms.has(id)) { waveform = waveforms.get(id)!; waveformId = id; }
    const accept = (value: WaveformData | null) => { if (!controller.signal.aborted) { waveform = value; waveformId = id ?? ''; if (id && value) waveforms.set(id, value); } };
    const unsubscribe = id && ui.settings.values.waveform ? ui.api.library.subscribeWaveform?.(id, accept) : undefined;
    if (currentId && ui.settings.values.waveform) void ui.api.library.getWaveform(currentId, controller.signal)
      .then(accept).catch(() => {});
    return () => { controller.abort(); unsubscribe?.(); };
  });
  // Speed, pitch, effects: highlight the button when the current track sounds different from normal.
  let soundChanged = $derived.by(() => { const state = ui.audioState, id = ui.track?.id; if (!state) return false; const values = (id && state.tracks[id]) || state.global; return Math.abs(values.speed - 1) > .001 || Math.abs(values.pitch) > .001; });
  const seek = (fraction: number) => ui.api.player.seek(fraction * (ui.track?.duration ?? 0));
  /*
   * Gestures on the player: left/right switches tracks (the cover follows the finger),
   * down collapses the player (the whole sheet follows the finger and slides away),
   * up opens the lyrics.
   */
  let gesture: { x: number; y: number; lastX: number; time: number; velocity: number; axis?: 'x' | 'y'; start: number } | null = null;
  let dragX = $state(0), dragY = $state(0), dragging = $state(false);
  // Wide desktop window: cover and controls on the left, lyrics on the right (like Yandex Music).
  let wide = $derived(layout.wide);
  function move(event: PointerEvent) {
    if (!gesture) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    gesture.axis ??= Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) ? 'y' : undefined;
    if (gesture.axis === 'x') { const elapsed = Math.max(1, event.timeStamp - gesture.time); gesture.velocity = gesture.velocity * .4 + Math.max(-2500, Math.min(2500, (event.clientX - gesture.lastX) / elapsed * 1000)) * .6; gesture.lastX = event.clientX; gesture.time = event.timeStamp; dragging = true; dragX = Math.max(-220, Math.min(220, dx)); }
    // Up and down move the cover too (like left/right); up opens the lyrics, down collapses the player.
    else if (gesture.axis === 'y') { dragging = true; dragY = Math.max(-160, Math.min(220, dy * .8)); }
  }
  function down(event: PointerEvent) { if (!(event.target as Element).closest('button, canvas, input, [role="slider"]')) { if (event.pointerType === 'mouse') event.preventDefault(); // no image drag or text selection with the mouse
 gesture = { x: event.clientX, y: event.clientY, lastX: event.clientX, time: event.timeStamp, velocity: 0, start: event.timeStamp }; event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId); } }
  function reset() { gesture = null; dragX = 0; dragY = 0; dragging = false; }
  function up(event: PointerEvent) {
    if (!gesture) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, speed = dy / Math.max(1, event.timeStamp - gesture.start) * 1000;
    if (gesture.axis === 'x' && Math.abs(dx) >= 64) { const offset = dragX, velocity = gesture.velocity * Math.exp(-Math.max(0, event.timeStamp - gesture.time) / 50); if (dx < 0) ui.api.player.next(); else ui.api.player.previous(false); ui.coverRelease = { transitionId: ui.player?.transition?.id ?? -1, offset, velocity }; reset(); return; }
    if (gesture.axis === 'y' && (dy > 120 || dy > 40 && speed > 700)) { reset(); ui.nav.back(); return; }
    if (gesture.axis === 'y' && !wide && (dy < -70 || dy < -30 && speed < -600)) ui.nav.open('lyrics');
    reset();
  }
</script>
<section class="player" data-motion-group="player" transition:motionTransition|global={{ group: 'player' }} aria-label={ui.t('player.title')} title={ui.t('player.swipeHint')} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={reset} data-testid="player" data-crossfade={ui.clock.crossfade ? ui.clock.crossfade.progress.toFixed(3) : undefined}>
  {#if ui.track && ui.player}
    <PlayerBackground />
    <BeatVisuals />
    <div class="split" class:wide>
    <div class="player-content">
      <header class="toolbar"><button class="icon-button" aria-label={ui.t('player.collapse')} onclick={() => ui.nav.back()}><Icon name="chevron-down" size="l" /></button><div class="toolbar-actions">{#if ui.api.capabilities?.soundProcessing !== false}<button class="icon-button sound-button" class:active={soundChanged} aria-label={ui.t('player.sound')} title={ui.t('player.sound')} onclick={() => ui.nav.sheet({ kind: 'sound' })}><Icon name="sliders" /></button>{/if}<button class="icon-button" aria-label={ui.t('player.menu')} onclick={() => ui.nav.sheet({ kind: 'playerMenu' })}><Icon name="more" /></button></div></header>
      <div class="metadata"><div class="track-info">{#key ui.track.id}<div class="title-motion" data-motion-group="title" transition:motionTransition={{ group: 'title', duration: ui.player.transition?.kind === 'crossfade' ? ui.player.transition.duration : undefined }}><div data-motion-content><h1 aria-label={ui.track.title}><span data-title-text data-title={ui.track.title}>{ui.track.title}</span>{#if ui.track.explicit}<span class="explicit" aria-label={ui.t('track.explicit')}>E</span>{/if}</h1><button class="artist" onclick={() => ui.track && ui.nav.go({ name: 'artist', id: ui.track.artist.id })}>{ui.track.artist.name}</button></div></div>{/key}<p class="stream-source" data-testid="stream-source">{#if ui.track.downloaded || ui.track.sources.some(source => source.kind === 'local')}<Icon name="download" size="s" /><span>{ui.t(ui.track.sources.some(source => source.kind === 'local') ? 'player.playingLocal' : 'player.playingOffline')}</span>{:else}{@const provider = ui.streams[ui.track.id] ?? ui.track.sources[0]?.kind}{#if provider}<span class="dot"></span><span>{ui.t('player.playingFrom', { source: ui.t(`source.${provider}`) })}</span>{/if}{/if}</p></div><div class="side-actions">{#each ui.contributions('playerButtons').filter(item => item.location === 'side') as item}<button class="icon-button surface" aria-pressed={item.command === 'like' ? ui.track.liked : undefined} aria-label={ui.t(item.command === 'like' ? ui.track.liked ? 'track.unlike' : 'track.like' : item.titleKey)} onclick={() => { if (item.command === 'like' && ui.track) ui.like(ui.track); else if (item.command === 'lyrics') ui.nav.open('lyrics'); else ui.api.extensions.events.emit('ui:command', { command: item.command, slot: 'playerButtons', trackId: ui.track?.id }); }}><Icon name={item.icon as IconName} filled={item.command === 'like' && ui.track.liked} /></button>{/each}</div></div>
      <div class="art-space"><TrackArtwork {dragX} {dragY} {dragging} /></div>
      <div class="playback">{#if !ui.settings.values.waveform || waveform?.status === 'deferred'}<ProgressBar position={ui.position} duration={ui.track.duration} onseek={seek} />
        {:else if ui.settings.values.waveformZoom !== false}<WaveformZoom samples={waveform?.samples ?? []} building={waveform?.status === 'building'} waveKey={waveformId} position={ui.position} duration={ui.track.duration} onseek={seek} />
        {:else}<Waveform samples={waveform?.samples ?? []} building={waveform?.status === 'building'} waveKey={waveformId} position={ui.position / (ui.track.duration || 1)} duration={ui.track.duration} onseek={seek} />{/if}
        <div class="controls">{#each ui.contributions('playerButtons').filter(item => item.location === 'transport') as item}<button class:play-button={item.command === 'toggle'} class:icon-button={item.command !== 'toggle'} class:secondary={['shuffle', 'repeat'].includes(item.command)} class:enabled={item.command === 'shuffle' && ui.player.shuffle || item.command === 'repeat' && ui.player.repeat !== 'off'} aria-label={ui.t(item.command === 'toggle' ? ui.player.playing ? 'player.pause' : 'player.play' : item.command === 'repeat' ? `player.repeat.${ui.player.repeat}` : item.titleKey)} aria-pressed={item.command === 'shuffle' ? ui.player.shuffle : item.command === 'repeat' ? ui.player.repeat !== 'off' : undefined} onclick={() => { if (item.command === 'toggle') ui.api.player.toggle(); else if (item.command === 'shuffle') ui.api.player.setShuffle(!ui.player?.shuffle); else if (item.command === 'repeat') ui.api.player.cycleRepeat(); else if (item.command === 'previous') ui.api.player.previous(); else if (item.command === 'next') ui.api.player.next(); else ui.api.extensions.events.emit('ui:command', { command: item.command, slot: 'playerButtons', trackId: ui.track?.id }); }}><Icon name={(item.command === 'toggle' ? ui.player.playing ? 'pause' : 'play' : item.command === 'repeat' && ui.player.repeat === 'one' ? 'repeat-one' : item.icon) as IconName} size={['shuffle','repeat'].includes(item.command) ? 'm' : 'l'} /></button>{/each}</div>
        <button class="queue-link" onclick={() => ui.nav.open('queue')}><Icon name="queue" size="s" /><span>{ui.t('queue.title')}</span><span class="queue-number">{Math.max(0, ui.player.queue.length - ui.player.currentIndex - 1)}</span></button>
      </div>
    </div>
    {#if wide}<div class="lyrics-pane"><LyricsScreen embedded /></div>{/if}
    </div>
  {:else}<button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-down" /></button><EmptyState title={ui.t('player.noTrack')} description={ui.t('player.noTrackSub')} />{/if}
</section>
<style>
  .player { position: absolute; inset: 0; overflow: hidden; background: var(--color-bg); z-index: var(--z-player); touch-action: none; }
  .split { position: relative; height: 100%; }
  .split.wide { display: grid; grid-template-columns: minmax(320px, 440px) minmax(0, 1fr); gap: var(--space-8); max-width: 1400px; margin: 0 auto; padding: 0 var(--space-6); }
  .split.wide .player-content { justify-content: center; }
  .lyrics-pane { position: relative; height: 100%; min-width: 0; overflow: hidden; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-bg) 72%, transparent) var(--space-8)); }
  .split.wide .art-space :global(.art-stack) { width: min(100%, 380px); }
  .player-content { position: relative; display: flex; flex-direction: column; height: 100%; padding: calc(var(--space-4) + var(--inset-top)) calc(var(--space-6) + var(--inset-right)) calc(var(--space-4) + var(--inset-bottom)) calc(var(--space-6) + var(--inset-left)); }
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin: 0 calc(-1 * var(--space-3)) var(--space-7); }
  .toolbar-actions { display: flex; align-items: center; gap: var(--space-1); }
  .sound-button { position: relative; }
  .sound-button.active { color: var(--color-accent); }
  .metadata { display: flex; gap: var(--space-4); justify-content: space-between; }
  .track-info { position: relative; min-width: 0; flex: 1; padding-top: var(--space-1); }
  .title-motion { width: 100%; }
  h1 { font-size: calc(var(--font-size-3xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-tight); line-height: var(--line-height-tight); overflow-wrap: anywhere; }
  h1 .explicit { margin-left: var(--space-2); display: inline-flex; vertical-align: middle; height: var(--space-4); min-width: var(--space-4); transform: translateY(calc(-1 * var(--space-1))); }
  .artist { margin-top: var(--space-2); min-height: var(--touch-size); font-size: calc(var(--font-size-l) * var(--font-scale)); color: var(--color-text-muted); text-align: start; }
  .stream-source { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1); color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .stream-source .dot { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); background: var(--color-accent); }
  .side-actions { display: flex; flex-direction: column; gap: var(--space-3); }
  .side-actions button { background: var(--color-player-control-surface); border: var(--border-width) solid var(--color-player-control-border); }
  .art-space { flex: 1; min-height: var(--space-8); display: flex; align-items: center; justify-content: center; padding: var(--space-4) 0 var(--space-5); }
  @media (max-height: 760px) { .art-space :global(.art-stack) { width: min(34vw, 140px); } }
  .playback { padding-bottom: var(--space-1); }
  .controls { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-top: var(--space-7); }
  .secondary { color: var(--color-text-muted); position: relative; }
  .enabled { color: var(--color-text); }
  .enabled::after { position: absolute; bottom: 0; left: 50%; content: ''; width: var(--space-1); height: var(--space-1); background: var(--color-text); border-radius: var(--radius-full); }
  .play-button { display: grid; place-items: center; width: var(--player-play-size); height: var(--player-play-size); flex-shrink: 0; border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); }
  .queue-link { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--touch-size); margin: var(--space-4) auto 0; color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .queue-number { border: var(--border-width) solid var(--color-border); border-radius: var(--radius-full); padding: 0 var(--space-2); }
  @media (max-height: 650px) { .toolbar { margin-bottom: var(--space-3); } .controls { margin-top: var(--space-3); } .queue-link { margin-top: var(--space-1); } }
</style>
