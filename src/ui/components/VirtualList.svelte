<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';
  import { useModel } from '../context.svelte';
  let { items, itemKey, children, scroller }: { items: readonly T[]; itemKey: (item: T) => string; children: Snippet<[T, number]>; scroller?: HTMLElement } = $props();
  const ui = useModel();
  let container: HTMLDivElement;
  let rowHeight = $state(68); let start = $state(0); let end = $state(25);
  const overscan = 6;
  let itemCount = $derived(items.length);
  let visible = $derived(items.slice(start, Math.max(start, end)));
  $effect(() => {
    const host = scroller ?? ui.scrollElement; if (!host || !container) return;
    const count = itemCount;
    let viewport = 0, top = 0, frame = 0;
    const range = () => {
      // Scrolling only reads scrollTop. Geometry and CSS are stable between
      // resizes/themes, and crossing a row boundary is the only reactive write.
      const offset = host.scrollTop - top, height = untrack(() => rowHeight);
      start = Math.max(0, Math.min(count, Math.floor(offset / height) - overscan));
      end = Math.min(count, Math.max(0, Math.ceil((offset + viewport) / height)) + overscan);
    };
    const measure = () => {
      if (host.closest('[aria-hidden="true"]')) return;
      viewport = host.clientHeight;
      top = container.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
      rowHeight = parseFloat(document.documentElement.style.getPropertyValue('--track-height')) || 68;
      if (count && host.scrollTop > top + count * untrack(() => rowHeight)) host.scrollTop = Math.max(0, top);
      range();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    measure(); host.addEventListener('scroll', range, { passive: true });
    const observer = new ResizeObserver(measure); observer.observe(host); observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    window.addEventListener('app:theme', schedule); window.addEventListener('app:appearance', schedule);
    return () => { cancelAnimationFrame(frame); host.removeEventListener('scroll', range); observer.disconnect(); window.removeEventListener('app:theme', schedule); window.removeEventListener('app:appearance', schedule); };
  });
</script>
<div bind:this={container} class="virtual-list" style:height={`${items.length * rowHeight}px`} data-testid="virtual-list" data-total={items.length}>
  {#each visible as item, offset (itemKey(item))}<div class="virtual-row" style:height={`${rowHeight}px`} style:transform={`translateY(${(start + offset) * rowHeight}px)`}>{@render children(item, start + offset)}</div>{/each}
</div>
<style>
  .virtual-list { position: relative; width: 100%; overflow-anchor: none; }
  .virtual-row { position: absolute; inset: 0 0 auto; contain: layout style; }
</style>
