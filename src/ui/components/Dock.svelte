<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import MiniPlayer from './MiniPlayer.svelte';
  import BottomNav from './BottomNav.svelte';
  import PlayerBar from './PlayerBar.svelte';
  const ui = useModel();
  let { mini = true, nav = true, bar = false }: { mini?: boolean; nav?: boolean; bar?: boolean } = $props();
  let element: HTMLDivElement;
  onMount(() => {
    const root = element.closest<HTMLElement>('.device')!;
    const measure = () => root.style.setProperty('--dock-height', `${element.offsetHeight}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  });
</script>
<div bind:this={element} class="dock" data-testid="dock" inert={!!ui.nav.state.sheet} aria-hidden={ui.nav.state.sheet ? 'true' : undefined}>
  {#if mini && ui.track}{#if bar}<PlayerBar />{:else}<MiniPlayer />{/if}{/if}{#if nav}<BottomNav />{/if}
</div>
<style>
  .dock { position: absolute; z-index: var(--z-dock); left: var(--dock-left, 0px); right: 0; bottom: 0; display: flex; flex-direction: column; gap: var(--dock-gap); padding: var(--space-4) calc(var(--nav-inset) + var(--inset-right)) calc(var(--nav-bottom) + var(--inset-bottom)) calc(var(--nav-inset) + var(--inset-left)); background: var(--gradient-bottom); pointer-events: none; }
  .dock > :global(*) { pointer-events: auto; }
</style>
