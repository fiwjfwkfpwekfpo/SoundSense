<script lang="ts">
  import { swapCard, cancelCardSwap } from '../appearance/motion/card-swipe';
  import { useModel } from '../context.svelte';
  import { miniDrop, rememberMiniPlayer, waveformProgress } from '../appearance/motion/runtime';
  import Cover from './Cover.svelte';
  import Icon from '../icons/Icon.svelte';
  import { loadArtwork } from '../../platform/artwork';
  const ui = useModel();
  let resolving = $derived(!!ui.player?.resolving);
  let loading = $state(false);
  $effect(() => { if (!resolving) { loading = false; return; } const timer = setTimeout(() => loading = true, 150); return () => clearTimeout(timer); });
  $effect(() => { for (const offset of [-1, 1]) { const id = ui.player?.queue[(ui.player?.currentIndex ?? 0) + offset]?.trackId, url = id && ui.api.library.getTrack(id)?.artwork.url; if (url) void loadArtwork(url).catch(() => {}); } });
  let card = $state<HTMLDivElement>();
  let gesture: { x: number; y: number; axis: 'pending' | 'x' | 'y' } | null = null;
  let suppressClick = false;
  function down(event: PointerEvent) {
    if (card) cancelCardSwap(card);
    suppressClick = false; gesture = { x: event.clientX, y: event.clientY, axis: 'pending' };
  }
  function move(event: PointerEvent) {
    if (!gesture || !card) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    // A swipe up to open the player often drifts sideways: horizontal needs a clearly horizontal start.
    if (gesture.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 2 ? 'x' : 'y'; suppressClick = true; card.setPointerCapture(event.pointerId);
    }
    if (gesture.axis === 'x' && dy < -24 && Math.abs(dy) > Math.abs(dx) * .8) gesture.axis = 'y';
    if (gesture.axis === 'x') card.style.transform = `translateX(${dx}px)`;
    else if (gesture.axis === 'y') card.style.transform = `translateY(${Math.max(-45, Math.min(25, dy * .4))}px)`;
  }
  async function up(event: PointerEvent) {
    if (!gesture || !card) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, axis = gesture.axis; gesture = null;
    if (axis !== 'pending' && dy < -48 && Math.abs(dy) > Math.abs(dx) * .8) { suppressClick = true; card.style.transform = ''; ui.nav.open('player'); return; }
    if (axis === 'x' && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressClick = true;
      await swapCard(card, dx < 0 ? 1 : -1, dx, () => { const before = ui.track?.id; if (dx < 0) ui.api.player.next(); else ui.api.player.previous(false); return before !== ui.track?.id; });
    } else {
      const transform = card.style.transform; card.style.transform = '';
      if (transform) card.animate([{ transform }, { transform: 'none' }], { duration: 130, easing: 'ease-out' });
    }
  }
  function cancel() { gesture = null; if (card) card.style.transform = ''; }

</script>
{#if ui.track && ui.player}
  <div class="mini-viewport" use:miniDrop role="group" aria-label={ui.t('player.title')} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel}><div bind:this={card} class="mini" use:rememberMiniPlayer role="group" aria-label={ui.t('player.title')} data-testid="mini-player" onclickcapture={event => { if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}>
    <button class="info" aria-label={ui.t('player.open')} title={ui.t('player.swipeHint')} onclick={event => { if (event.detail === 0 || !suppressClick) ui.nav.open('player'); }}>
      <span class="art"><Cover artwork={ui.track.artwork} animate={false} /></span><span class="text"><span class="title-motion"><span class="title-content"><strong aria-label={ui.track.title}>{ui.track.title}</strong><span role={loading ? 'status' : undefined}>{loading ? ui.t('player.loading') : ui.track.artist.name}</span></span></span></span>
    </button>
    <button class="icon-button" aria-label={ui.t(ui.player.playing ? 'player.pause' : 'player.play')} onclick={() => ui.api.player.toggle()}><Icon name={ui.player.playing ? 'pause' : 'play'} size="s" /></button>
    <button class="icon-button" aria-pressed={ui.track.liked} aria-label={ui.t(ui.track.liked ? 'track.unlike' : 'track.like')} onclick={() => ui.track && ui.like(ui.track)}><Icon name="heart" filled={ui.track.liked} size="s" /></button>
    <button class="icon-button next" aria-label={ui.t('player.next')} onclick={() => ui.api.player.next()}><Icon name="next" size="s" /></button>
    <div class="progress"><span class="progress-played" use:waveformProgress={{ position: ui.position / (ui.track.duration || 1), steps: 100 }}><i></i></span></div>
  </div></div>
{/if}
<style>
  .mini-viewport { position: relative; height: var(--mini-height); overflow: hidden; border-radius: var(--radius-m); touch-action: none; }
  .mini { position: relative; height: var(--mini-height); display: flex; align-items: center; border-radius: var(--radius-m); padding: var(--space-2); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); overflow: hidden; box-shadow: var(--shadow-nav); touch-action: none; will-change: transform; }
  .info { display: flex; align-items: center; gap: var(--space-3); text-align: start; min-width: 0; flex: 1; min-height: var(--touch-size); }
  .art { width: var(--cover-mini); height: var(--cover-mini); border-radius: var(--radius-s); flex-shrink: 0; }
  .text { position: relative; display: block; min-width: 0; flex: 1; }
  .title-motion { display: block; width: 100%; }
  .title-content { display: flex; flex-direction: column; gap: var(--space-1); width: 100%; }
  strong { font-size: calc(var(--font-size-sm) * var(--font-scale)); font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title-content > span { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .next { color: var(--color-text-muted); }
  .progress { position: absolute; height: var(--progress-height); bottom: 0; left: 0; right: 0; background: var(--color-surface-3); overflow: hidden; }
  .progress-played { display: block; width: 100%; height: 100%; overflow: hidden; transform-origin: left; }
  .progress i { display: block; width: 100%; height: 100%; background: var(--color-text); transform-origin: left; }
</style>
