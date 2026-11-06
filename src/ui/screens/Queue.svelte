<script lang="ts">
  import Dock from '../components/Dock.svelte';
  import { useModel } from '../context.svelte';
  import { motionTransition } from '../appearance/motion/runtime';
  import TrackRow from '../components/TrackRow.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let scroller = $state<HTMLDivElement>();
  let dragging = $state<string | null>(null); let swipeId = $state<string | null>(null); let swipeX = $state(0);
  let swipeStart: { x: number; y: number; id: string } | null = null;
  // Position ticks reuse the same queue. Derive identity/index separately so a
  // media clock update cannot copy thousands of entries and reset the list.
  let queue = $derived(ui.player?.queue);
  let currentIndex = $derived(ui.player?.currentIndex ?? -1);
  let upcoming = $derived(queue?.slice(currentIndex + 1) ?? []);
  function dragMove(event: PointerEvent) {
    if (!dragging) return;
    // Hysteresis: swap only once the finger passes the middle of the neighbouring row,
    // otherwise the list oscillates while rows re-render under the pointer.
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-queue-index]');
    if (target && target.dataset.queueId !== dragging) {
      const to = Number(target.dataset.queueIndex), from = queue?.findIndex(item => item.id === dragging) ?? -1, rect = target.getBoundingClientRect(), middle = rect.top + rect.height / 2;
      if (from >= 0 && to !== from && (to > from ? event.clientY >= middle : event.clientY <= middle)) ui.api.player.move(dragging, to);
    }
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      if (event.clientY < bounds.top + 100) scroller.scrollTop -= 16;
      else if (event.clientY > bounds.bottom - 180) scroller.scrollTop += 16;
    }
  }
  function swipeDown(event: PointerEvent, id: string) { if (!(event.target as Element).closest('.grip')) swipeStart = { x: event.clientX, y: event.clientY, id }; }
  function swipeMove(event: PointerEvent) { if (!swipeStart || dragging) return; if (Math.abs(event.clientY - swipeStart.y) < 35) { swipeId = swipeStart.id; swipeX = Math.min(0, event.clientX - swipeStart.x); } }
  function finish() {
    if (swipeStart && swipeX < -80) { ui.api.player.remove(swipeStart.id); }
    swipeStart = null; swipeId = null; swipeX = 0; dragging = null;
  }
  function reorder(event: KeyboardEvent, id: string, index: number) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); ui.api.player.move(id, Math.max((ui.player?.currentIndex ?? 0) + 1, index + (event.key === 'ArrowUp' ? -1 : 1))); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); ui.api.player.remove(id); }
  }
</script>
<svelte:window onpointermove={dragMove} onpointerup={finish} onpointercancel={() => { dragging = null; swipeStart = null; swipeX = 0; swipeId = null; }} />
<section class="queue overlay-screen" data-motion-group="general" transition:motionTransition|global={{ group: 'general' }} aria-label={ui.t('queue.title')}>
  <div class="queue-scroll screen" bind:this={scroller}>
    <header class="overlay-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{ui.t('queue.title')}</h1><button class="icon-button" aria-label={ui.t('nav.close')} onclick={() => ui.nav.back()}><Icon name="close" size="s" /></button></header>
    <span class="eyebrow">{ui.t('queue.now')}</span>{#if ui.track}<div class="current"><TrackRow track={ui.track} active menu={false} onplay={() => ui.nav.open('player')} /></div>{/if}
    <div class="next-heading"><h2>{ui.t('queue.next')} <span>{upcoming.length}</span></h2><button disabled={!upcoming.length} onclick={() => ui.api.player.clearUpcoming()}>{ui.t('queue.clear')}</button></div><p class="hint">{ui.t('queue.hint')}</p>
    {#if upcoming.length}<VirtualList items={upcoming} itemKey={entry => entry.id} {scroller}>{#snippet children(entry, index)}{@const track = ui.api.library.getTrack(entry.trackId)}{#if track}<div role="group" class="queue-row" class:dragging={dragging === entry.id} data-queue-id={entry.id} data-queue-index={(ui.player?.currentIndex ?? 0) + 1 + index} onpointerdown={event => swipeDown(event, entry.id)} onpointermove={swipeMove} style:transform={`translateX(${swipeId === entry.id ? swipeX : 0}px)`}><TrackRow {track} menu={false} onplay={() => { if (swipeX > -20) ui.api.player.skipTo(entry.id); }} /><button class="icon-button grip" aria-label={ui.t('queue.move', { title: track.title })} onpointerdown={event => { event.preventDefault(); dragging = entry.id; ui.api.haptics.pulse(); }} onkeydown={event => reorder(event, entry.id, (ui.player?.currentIndex ?? 0) + 1 + index)}><Icon name="grip" size="s" /></button></div>{/if}{/snippet}</VirtualList>{:else}<EmptyState title={ui.t('queue.empty')} description={ui.t('queue.emptySub')} icon="queue" />{/if}
  </div>
<Dock /></section>
<style>
  .overlay-screen { position: absolute; inset: 0; z-index: var(--z-player); background: var(--color-bg); }
  .queue-scroll { position: absolute; inset: var(--inset-top) var(--inset-right) 0 var(--inset-left); min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-top: var(--space-4); animation: none; }
  .overlay-header { display: flex; align-items: center; justify-content: space-between; margin: 0 calc(-1 * var(--space-3)) var(--space-7); }
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); }
  .current { border-bottom: var(--border-width) solid var(--color-border); padding: var(--space-3) 0 var(--space-5); }
  .next-heading { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-5); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  h2 span { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); font-weight: var(--font-weight-normal); margin-left: var(--space-2); }
  .next-heading button { min-height: var(--touch-size); font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); }
  .hint { color: var(--color-text-subtle); font-size: calc(var(--font-size-xs) * var(--font-scale)); line-height: var(--line-height-body); margin-bottom: var(--space-4); }
  .queue-row { display: flex; align-items: center; border-radius: var(--radius-s); touch-action: pan-y; }
  .queue-row :global(.track-row) { min-width: 0; flex: 1; }
  .grip { color: var(--color-text-subtle); margin-right: calc(-1 * var(--space-3)); touch-action: none; cursor: grab; }
  .dragging { background: var(--color-surface-2); box-shadow: var(--shadow-nav); }
</style>
