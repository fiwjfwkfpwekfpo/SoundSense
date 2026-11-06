<script lang="ts">
  import { useModel } from '../context.svelte';
  import { waveformProgress } from '../appearance/motion/runtime';
  import Cover from './Cover.svelte';
  import Icon from '../icons/Icon.svelte';
  import { formatTime } from '../../core/format';
  // Wide desktop window: the player as a bar under the content (like Yandex Music / Spotify).
  const ui = useModel();
  let lastVolume = 1;
  function seekAt(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement, box = target.getBoundingClientRect();
    if (!ui.track?.duration) return;
    ui.api.player.seek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * ui.track.duration);
  }
</script>
{#if ui.track && ui.player}
<div class="bar" role="group" aria-label={ui.t('player.title')} data-testid="player-bar">
  <div class="now">
    <button class="art" aria-label={ui.t('player.open')} onclick={() => ui.nav.open('player')}><Cover artwork={ui.track.artwork} animate={false} /></button>
    <button class="text" onclick={() => ui.nav.open('player')}><strong>{ui.track.title}</strong><span>{ui.player.resolving ? ui.t('player.loading') : ui.track.artist.name}</span></button>
    <button class="icon-button" aria-pressed={ui.track.liked} aria-label={ui.t(ui.track.liked ? 'track.unlike' : 'track.like')} onclick={() => ui.track && ui.like(ui.track)}><Icon name="heart" filled={ui.track.liked} size="s" /></button>
  </div>
  <div class="center">
    <div class="transport">
      <button class="icon-button" class:on={ui.player.shuffle} aria-pressed={ui.player.shuffle} aria-label={ui.t('player.shuffle')} onclick={() => ui.api.player.setShuffle(!ui.player?.shuffle)}><Icon name="shuffle" size="s" /></button>
      <button class="icon-button" aria-label={ui.t('player.previous')} onclick={() => ui.api.player.previous()}><Icon name="previous" /></button>
      <button class="play" aria-label={ui.t(ui.player.playing ? 'player.pause' : 'player.play')} onclick={() => ui.api.player.toggle()}><Icon name={ui.player.playing ? 'pause' : 'play'} /></button>
      <button class="icon-button" aria-label={ui.t('player.next')} onclick={() => ui.api.player.next()}><Icon name="next" /></button>
      <button class="icon-button" class:on={ui.player.repeat !== 'off'} aria-pressed={ui.player.repeat !== 'off'} aria-label={ui.t(`player.repeat.${ui.player.repeat}`)} onclick={() => ui.api.player.cycleRepeat()}><Icon name={ui.player.repeat === 'one' ? 'repeat-one' : 'repeat'} size="s" /></button>
    </div>
    <div class="time"><span>{formatTime(ui.position)}</span>
      <div class="track" role="slider" tabindex="0" aria-label={ui.t('player.seek')} aria-valuemin={0} aria-valuemax={Math.round(ui.track.duration)} aria-valuenow={Math.round(ui.position)} onpointerdown={seekAt}
        onkeydown={event => { if (event.key === 'ArrowRight') ui.api.player.seek(ui.position + 5); else if (event.key === 'ArrowLeft') ui.api.player.seek(Math.max(0, ui.position - 5)); }}>
        <span class="played" use:waveformProgress={{ position: ui.position / (ui.track.duration || 1), steps: 400 }}><i></i></span></div>
      <span>{formatTime(ui.track.duration)}</span></div>
  </div>
  <div class="side">
    <button class="icon-button" aria-label={ui.t('lyrics.title')} title={ui.t('lyrics.title')} onclick={() => ui.nav.open('lyrics')}><Icon name="lyrics" size="s" /></button>
    <button class="icon-button" aria-label={ui.t('queue.title')} title={ui.t('queue.title')} onclick={() => ui.nav.open('queue')}><Icon name="queue" size="s" /></button>
    {#if ui.api.audioSettings}{@const volume = ui.audioState?.global.volume ?? 1}<label class="volume" title={`${Math.round(volume * 100)}%`}><button class="icon-button" aria-label={ui.t('audio.volume')} onclick={() => { const value = volume > 0 ? 0 : (lastVolume || 1); if (volume > 0) lastVolume = volume; ui.api.audioSettings?.set('volume', value); }}><Icon name="volume" size="s" /></button><input type="range" min="0" max="1" step="0.01" aria-label={ui.t('audio.volume')} value={Math.min(1, volume)} oninput={event => ui.api.audioSettings?.set('volume', Number(event.currentTarget.value))} style:--fill={`${Math.min(1, volume) * 100}%`} /></label>{/if}
    {#if ui.api.capabilities?.soundProcessing !== false}<button class="icon-button" aria-label={ui.t('player.sound')} title={ui.t('player.sound')} onclick={() => ui.nav.sheet({ kind: 'sound' })}><Icon name="sliders" size="s" /></button>{/if}
  </div>
</div>
{/if}
<style>
  .bar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 1.2fr) minmax(0, 1fr); align-items: center; gap: var(--space-4); min-height: calc(var(--mini-height) + var(--space-4)); padding: var(--space-2) var(--space-4); border-radius: var(--radius-l); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); box-shadow: var(--shadow-nav); backdrop-filter: blur(var(--blur-nav)); }
  .now { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  .art { width: calc(var(--mini-height) - var(--space-2)); height: calc(var(--mini-height) - var(--space-2)); flex-shrink: 0; border-radius: var(--radius-s, var(--radius-m)); overflow: hidden; }
  .text { display: grid; min-width: 0; text-align: start; }
  .text strong, .text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text span { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .center { display: grid; gap: var(--space-1); justify-items: center; min-width: 0; }
  .transport { display: flex; align-items: center; gap: var(--space-1); }
  .center { min-width: 0; }
  .icon-button { color: var(--color-text-muted); }
  .icon-button:hover, .icon-button.on { color: var(--color-text); }
  .icon-button.on { color: var(--color-accent); }
  .play { display: grid; place-items: center; width: var(--touch-size); height: var(--touch-size); border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); }
  .time { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); width: 100%; font-size: calc(var(--font-size-xs) * var(--font-scale)); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
  .track { position: relative; height: var(--space-4); display: flex; align-items: center; cursor: pointer; }
  .track::before { content: ''; position: absolute; left: 0; right: 0; height: calc(var(--space-1) * .75); border-radius: var(--radius-full); background: var(--color-surface-3); }
  .played { position: absolute; left: 0; width: 100%; height: calc(var(--space-1) * .75); border-radius: var(--radius-full); overflow: hidden; transform-origin: left; }
  .played i { display: block; height: 100%; width: 100%; background: var(--color-text); transform-origin: left; }
  .side { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-1); min-width: 0; }
  .side > * { flex-shrink: 0; }
  /* Narrow bar: the volume keeps only its button. */
  @media (max-width: 1180px) { .volume input { display: none; } .volume { margin-right: 0; } }
  @media (max-width: 1000px) { .bar { grid-template-columns: minmax(0, 1fr) auto auto; } .time { display: none; } }
  .volume { display: flex; align-items: center; gap: var(--space-1); margin-right: var(--space-2); }
  .volume input { width: calc(var(--space-8) * 2.5); height: var(--space-1); appearance: none; border-radius: var(--radius-full); background: linear-gradient(90deg, var(--color-text) var(--fill), var(--color-surface-3) var(--fill)); cursor: pointer; }
  .volume input::-webkit-slider-thumb { appearance: none; width: var(--space-3); height: var(--space-3); border-radius: var(--radius-full); background: var(--color-text); }
</style>
