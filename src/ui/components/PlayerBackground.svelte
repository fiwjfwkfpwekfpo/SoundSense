<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { useModel } from '../context.svelte';
  import { colorVariables } from '../appearance/loader';
  import type { Artwork } from '../../core/types';
  import Cover from './Cover.svelte';
  const ui = useModel();
  let outgoing = $state<{ artwork: Artwork; style: string }>();
  let oldLayer = $state<HTMLDivElement>();
  let transition = $derived(ui.player?.transition);
  let lastTransitionId = -1, lastPaletteId = -1, activeTransitionId = -1, generation = 0;
  let animation: Animation | undefined, disposed = false;
  onDestroy(() => { disposed = true; generation++; animation?.cancel(); });
  $effect(() => {
    const change = transition, palette = ui.colorTransition;
    const changedTrack = !!change && change.id !== lastTransitionId;
    const changedPalette = !!palette && palette.id !== lastPaletteId;
    lastTransitionId = change?.id ?? -1;
    lastPaletteId = palette?.id ?? -1;
    // A late artwork decode can refine the incoming palette during a 3-second
    // crossfade. Keep the original old pixels and their running fade intact.
    if ((!changedTrack && !changedPalette) || (!changedTrack && change?.id === activeTransitionId)) return;
    const run = ++generation; animation?.cancel(); animation = undefined; activeTransitionId = -1;
    const from = untrack(() => changedTrack && change ? ui.api.library.getTrack(change.from) : palette ? ui.track : undefined);
    const duration = untrack(() => ui.appearance.groups.general.duration ? changedTrack ? change!.duration : palette?.duration ?? 0 : 0);
    if (!from || !duration) { outgoing = undefined; return; }
    const previousColors = palette && (!changedTrack || palette.transitionId === change?.id) ? palette.from : untrack(() => ui.appearance.colors);
    outgoing = { artwork: from.artwork, style: Object.entries(colorVariables(previousColors)).map(([key, value]) => `${key}:${value}`).join(';') };
    activeTransitionId = changedTrack ? change!.id : -1;
    void tick().then(() => {
      if (disposed || run !== generation || !oldLayer) return;
      const fade = oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' }); animation = fade;
      void fade.finished.then(async () => { if (!disposed && run === generation) { outgoing = undefined; activeTransitionId = -1; await tick(); if (!disposed && run === generation) { fade.cancel(); animation = undefined; } } }).catch(() => {});
    });
  });
</script>
<div class="background" aria-hidden="true">
  <div class="layer"><div class="backdrop">{#if ui.track}<Cover artwork={ui.track.artwork} animate={false} />{/if}</div><div class="veil"></div></div>
  {#if outgoing}<div class="layer outgoing color-snapshot" bind:this={oldLayer} style={outgoing.style}><div class="backdrop"><Cover artwork={outgoing.artwork} animate={false} /></div><div class="veil"></div></div>{/if}
</div>
<style>
  .background, .layer, .backdrop, .veil { position: absolute; inset: 0; pointer-events: none; }
  .layer { background: var(--color-bg); contain: paint; }
  .outgoing { will-change: opacity; }
  .backdrop { opacity: var(--opacity-art); }
  .backdrop :global(svg) { transform: scale(1.2); }
  .veil { background: var(--gradient-player); }
</style>
