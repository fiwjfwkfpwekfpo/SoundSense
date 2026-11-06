<script lang="ts">
  import { cascade } from '../appearance/motion/runtime';
  import type { Track } from '../../core/types';
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  import Cover from './Cover.svelte';
  import Icon from '../icons/Icon.svelte';
  let { track, onplay, menu = true, active = false }: { track: Track; onplay?: () => void; menu?: boolean; active?: boolean } = $props();
  const ui = useModel();
  let offset = $state(0); let armed = $state(false);
  let gesture: { x: number; y: number; axis: 'pending' | 'x' | 'y'; long: boolean } | null = null;
  let hold: ReturnType<typeof setTimeout> | undefined; let suppress = false;
  function down(event: PointerEvent) {
    if ((event.target as Element).closest('.menu') || event.button !== 0) return;
    suppress = false; gesture = { x: event.clientX, y: event.clientY, axis: 'pending', long: false };
    hold = setTimeout(() => { if (gesture?.axis === 'pending') { gesture.long = true; suppress = true; ui.api.haptics.pulse(); ui.nav.sheet({ kind: 'track', trackId: track.id }); } }, 480);
  }
  function move(event: PointerEvent) {
    if (!gesture) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (gesture.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
      clearTimeout(hold); gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (gesture.axis === 'x') { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); suppress = true; }
    }
    if (gesture.axis !== 'x') return;
    offset = Math.max(-110, Math.min(110, dx));
    const threshold = Math.abs(offset) >= 72;
    if (threshold && !armed) ui.api.haptics.pulse(); armed = threshold;
  }
  function finish(cancelled = false) {
    clearTimeout(hold);
    if (!cancelled && gesture?.axis === 'x' && armed) {
      if (offset > 0) { ui.api.player.enqueue(track.id, true); ui.notify('track.willPlayNext'); } else ui.like(track);
    }
    gesture = null; offset = 0; armed = false;
  }
  function play(event: MouseEvent) { if (event.detail === 0 || !suppress) (onplay ?? (() => ui.play([track.id])))(); }

</script>
<div class="swipe-row" use:cascade role="group" aria-label={track.title} onpointerdown={down} onpointermove={move} onpointerup={() => finish()} onpointercancel={() => finish(true)}>
  <div class="swipe-action" class:armed class:left={offset > 0} aria-hidden="true">{#if offset !== 0}<Icon name={offset > 0 ? 'next' : 'heart'} filled={offset < 0 && !track.liked} />{/if}</div>
<div class="track-row" class:active data-track-id={track.id} style:transform={`translateX(${offset}px)`}>
  <button class="track-main" aria-label={`${ui.t('player.play')}: ${track.title}, ${track.artist.name}`} onclick={play}>
    <span class="art"><Cover artwork={track.artwork} /></span>
    <span class="info"><span class="title"><span>{track.title}</span>{#if track.explicit}<span class="explicit" aria-label={ui.t('track.explicit')}>E</span>{/if}</span><span class="artist">{#if track.downloaded}<span class="offline" title={ui.t('track.offlineReady')} aria-label={ui.t('track.offlineReady')}><Icon name="download" size="s" /></span>{/if}<span class="artist-name">{track.artist.name}</span></span></span>
    {#if active && ui.player?.playing}<span class="playing" aria-hidden="true"><i></i><i></i><i></i></span>{:else}<span class="duration">{formatTime(track.duration)}</span>{/if}
  </button>
  {#if menu}<button class="icon-button menu" aria-label={ui.t('track.menu', { title: track.title })} onclick={() => ui.nav.sheet({ kind: 'track', trackId: track.id })}><Icon name="more-vertical" size="s" /></button>{/if}
</div></div>
<style>
  .artist { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
  .artist-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { display: inline-flex; flex-shrink: 0; color: var(--color-accent); }
  .offline :global(svg) { width: calc(var(--font-size-sm) * var(--font-scale)); height: calc(var(--font-size-sm) * var(--font-scale)); }
  .swipe-row { position: relative; width: 100%; overflow: hidden; touch-action: pan-y; border-radius: var(--radius-s); }
  .swipe-action { position: absolute; inset: 0; display: flex; align-items: center; justify-content: end; padding: 0 var(--space-5); background: var(--color-surface-2); color: var(--color-accent); }
  .swipe-action.left { justify-content: start; }
  .swipe-action.armed { background: var(--color-accent); color: var(--color-on-accent); }
  .track-row { position: relative; background: var(--color-bg); display: flex; align-items: center; width: 100%; height: var(--track-height); gap: 0; border-radius: var(--radius-s); }
  .track-main { display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; height: 100%; text-align: start; }
  .art { width: var(--cover-row); height: var(--cover-row); flex-shrink: 0; border-radius: var(--radius-s); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .title { display: flex; align-items: center; gap: var(--space-2); font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); line-height: var(--line-height-heading); }
  .title > span:first-child, .artist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .artist, .duration { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .duration { padding-left: var(--space-1); font-variant-numeric: tabular-nums; }
  .menu { color: var(--color-text-muted); margin-right: calc(-1 * var(--space-3)); }
  .active .title { color: var(--palette-accentMutedText); }
  .playing { display: flex; align-items: center; gap: calc(var(--space-1) / 2); height: var(--space-5); padding: 0 var(--space-2); }
  .playing i { width: calc(var(--space-1) / 2); height: var(--space-3); background: var(--color-text); border-radius: var(--radius-full); animation: playing var(--motion-general-duration) var(--motion-general-easing) infinite alternate; }
  .playing i:nth-child(2) { animation-delay: calc(-1 * var(--motion-general-duration)); height: var(--space-5); }
  .playing i:nth-child(3) { animation-delay: calc(-1 * var(--motion-general-duration)); }
  @keyframes playing { to { transform: scaleY(.35); } }
</style>
