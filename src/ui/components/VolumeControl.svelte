<script lang="ts">
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  /*
   * Desktop volume: one button that fits anywhere. Pointing at it (or focusing it) opens a
   * vertical slider above or below; the mouse wheel changes the volume; a click mutes.
   * The slider is placed in the app root, so a clipped or narrow parent cannot hide it.
   */
  let { below = false, size = 's' }: { below?: boolean; size?: 's' | 'm' } = $props();
  const ui = useModel();
  let open = $state(false), place = $state({ x: 0, y: 0 }), last = 1;
  let root: HTMLElement, timer: ReturnType<typeof setTimeout> | undefined;
  let volume = $derived(Math.max(0, Math.min(1, ui.audioState?.global.volume ?? 1)));
  const set = (value: number) => ui.api.audioSettings?.set('volume', Math.round(Math.max(0, Math.min(1, value)) * 100) / 100);
  function show() {
    clearTimeout(timer);
    const host = root.closest<HTMLElement>('.device') ?? document.body, box = root.getBoundingClientRect(), frame = host.getBoundingClientRect();
    place = { x: box.left + box.width / 2 - frame.left, y: below ? box.bottom - frame.top : frame.bottom - box.top };
    open = true;
  }
  const hide = (wait = 280) => { clearTimeout(timer); timer = setTimeout(() => open = false, wait); };
  function mute() { if (volume > 0) { last = volume; set(0); } else set(last || 1); }
  function wheel(event: WheelEvent) { event.preventDefault(); set(volume + (event.deltaY < 0 ? .05 : -.05)); show(); hide(1200); }
  function key(event: KeyboardEvent) { if (event.key === 'ArrowUp') { event.preventDefault(); set(volume + .05); show(); } else if (event.key === 'ArrowDown') { event.preventDefault(); set(volume - .05); show(); } else if (event.key === 'Escape' && open) { event.stopPropagation(); open = false; } }
  // The wheel must be cancellable (the page behind must not scroll).
  function wheelable(node: HTMLElement) { node.addEventListener('wheel', wheel, { passive: false }); return { destroy() { node.removeEventListener('wheel', wheel); } }; }
  function portal(node: HTMLElement) { (root.closest('.device') ?? document.body).appendChild(node); return { destroy() { node.remove(); } }; }
</script>
<span class="volume" bind:this={root} use:wheelable onpointerenter={show} onpointerleave={() => hide()} onfocusin={show} onfocusout={() => hide()} role="group" aria-label={ui.t('audio.volumeShort')}>
  <button class="icon-button" class:muted={volume === 0} aria-label={ui.t('audio.volumeShort')} title={`${ui.t('audio.volumeShort')}: ${Math.round(volume * 100)}%`} onclick={mute} onkeydown={key}><Icon name="volume" {size} /></button>
</span>
{#if open}
  <div class="pop" class:below use:portal use:wheelable style:left={`${place.x}px`} style:top={below ? `${place.y}px` : undefined} style:bottom={below ? undefined : `${place.y}px`} onpointerenter={() => clearTimeout(timer)} onpointerleave={() => hide()} data-testid="volume-pop" role="presentation">
    <output>{Math.round(volume * 100)}</output>
    <input type="range" min="0" max="1" step="0.01" value={volume} aria-label={ui.t('audio.volumeShort')} aria-orientation="vertical" style:--fill={`${volume * 100}%`} oninput={event => set(Number(event.currentTarget.value))} />
  </div>
{/if}
<style>
  .volume { display: inline-flex; }
  .icon-button { color: var(--color-text-muted); }
  .icon-button:hover { color: var(--color-text); }
  .icon-button.muted { opacity: var(--opacity-muted); }
  .pop { position: absolute; z-index: calc(var(--z-overlay) + 1); transform: translateX(-50%); display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-2); margin: var(--space-1) 0; border-radius: var(--radius-full); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); box-shadow: var(--shadow-sheet); }
  output { min-width: calc(var(--space-6) + var(--space-1)); text-align: center; color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); font-variant-numeric: tabular-nums; }
  input { writing-mode: vertical-lr; direction: rtl; appearance: none; width: var(--space-1); height: calc(var(--space-8) * 3.5); margin: 0 var(--space-2); border-radius: var(--radius-full); background: linear-gradient(to top, var(--color-accent) var(--fill), var(--color-surface-3) var(--fill)); cursor: pointer; }
  input::-webkit-slider-thumb { appearance: none; width: var(--space-4); height: var(--space-4); border-radius: var(--radius-full); background: var(--color-text); box-shadow: var(--shadow-nav); }
</style>
