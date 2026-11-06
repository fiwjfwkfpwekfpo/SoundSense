<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import type { Artwork } from '../../core/types';
  import { motionTransition } from '../appearance/motion/runtime';
  import Icon from '../icons/Icon.svelte';
  import { loadArtwork, peekArtwork, thumbnailUrl } from '../../platform/artwork';
  let { artwork, heart = false, round = false, animate = true, full = false }: { artwork: Artwork; heart?: boolean; round?: boolean; animate?: boolean; full?: boolean } = $props();
  let source = $derived(artwork.url ? full ? artwork.url : thumbnailUrl(artwork.url) : '');
  const uid = $props.id();
  let mounted = $state(false);
  onMount(() => { mounted = true; });
  let artUid = $derived(`${uid}-${artwork.seed}-${artwork.variant}`);
  let angle = $derived((artwork.seed % 9 - 4) * 5);
  let offset = $derived(artwork.seed % 35);
  let image = $state(untrack(() => source ? peekArtwork(source) : ''));
  let decoded = $state(!!untrack(() => image));
  $effect(() => { const uri = source; if (!uri) { image = ''; decoded = false; return; } const cached = peekArtwork(uri); if (cached) { image = cached; decoded = true; return; } decoded = false; let cancelled = false; void loadArtwork(uri).then(async result => { if (!cancelled) { image = result.url; await tick(); requestAnimationFrame(() => { if (!cancelled) decoded = true; }); } }).catch(() => { if (!cancelled) image = ''; }); return () => { cancelled = true; }; });
</script>
<div class="cover" class:round aria-hidden="true" data-artwork-key={`${artwork.seed}-${artwork.variant}-${artwork.url ?? ''}`}>
  {#if image}<img class:decoded src={image} alt="" decoding="async" draggable="false" onerror={() => image = ''} />{:else}
  {#key `${artwork.seed}-${artwork.variant}`}
  <svg data-motion-group="cover" transition:motionTransition={{ group: 'cover', enabled: mounted && animate }} viewBox="0 0 360 360" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={`${artUid}-base`} x1="0" y1="0" x2="1" y2="1"><stop class="base" /><stop offset=".6" class="mid" /><stop offset="1" class="base" /></linearGradient>
      <linearGradient id={`${artUid}-ribbon`} x1=".2" y1="0" x2=".8" y2="1"><stop class="base" /><stop offset=".42" class="mid" /><stop offset=".53" class="shine" /><stop offset=".59" class="mid" /><stop offset="1" class="base" /></linearGradient>
      <radialGradient id={`${artUid}-glow`}><stop class="light" /><stop offset=".32" class="mid" /><stop offset="1" class="base" /></radialGradient>
      <filter id={`${artUid}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
    <rect width="360" height="360" fill={`url(#${artUid}-base)`} />
    {#if artwork.variant === 'ribbon'}
      <g transform={`rotate(${angle} 180 180)`}>
        <path d={`M-120 330C20 ${150 + offset} 90 310 210 160S340 65 480 5L470 100C330 100 320 210 205 235S30 290-90 430Z`} fill={`url(#${artUid}-ribbon)`} />
        <path class="ribbon-line" d={`M-70 310C40 220 130 290 220 178S365 55 430 80`} />
        <path class="ribbon-haze" d="M-40 260C110 130 190 270 330 45" filter={`url(#${artUid}-soft)`} />
      </g>
    {:else if artwork.variant === 'orbit'}
      <rect width="360" height="360" fill={`url(#${artUid}-glow)`} />
      <circle class="orbit" cx={180 + offset / 3} cy="164" r="62" />
      <ellipse class="orbit-ring" cx="180" cy="180" rx="155" ry="49" transform={`rotate(${-25 - offset} 180 180)`} />
      <path class="horizon" d="M-30 300Q130 160 390 290V360H0Z" />
    {:else if artwork.variant === 'haze'}
      <rect width="360" height="360" fill={`url(#${artUid}-glow)`} />
      <g class="haze" filter={`url(#${artUid}-soft)`}><ellipse cx={175 + offset} cy="155" rx="48" ry="62" /><path d="M66 360C70 230 110 207 180 206S284 252 303 360Z" /></g>
      <path class="haze-line" d="M0 299Q180 270 360 320" />
    {:else}
      <rect width="360" height="360" fill={`url(#${artUid}-glow)`} />
      {#each [0, 1, 2, 3, 4, 5] as i}<path class="terrain" style:opacity={`calc(var(--opacity-line) + ${i} * var(--opacity-terrain-step))`} d={`M-20 ${130 + i * 38}Q80 ${60 + i * 42 + offset} 170 ${150 + i * 23}T390 ${115 + i * 43}V370H-20Z`} />{/each}
    {/if}

  </svg>
  {/key}
  {/if}
  <div class="grain"></div>
  {#if heart}<span class="heart"><Icon name="heart" size="l" /></span>{/if}
</div>
<style>
  .cover { position: relative; width: 100%; height: 100%; aspect-ratio: 1; overflow: hidden; border-radius: inherit; background: var(--color-art-base); isolation: isolate; }
  .round { border-radius: var(--radius-full); }
  svg, img { width: 100%; height: 100%; object-fit: cover; display: block; }
  img { opacity: 0; transition: opacity var(--motion-cover-duration) ease-out; } img.decoded { opacity: 1; }
  .base { stop-color: var(--color-art-base); } .mid { stop-color: var(--color-art-mid); } .light { stop-color: var(--color-art-light); } .shine { stop-color: var(--color-art-shine); }
  .ribbon-line { fill: none; stroke: var(--color-art-shine); stroke-width: var(--border-width); opacity: var(--opacity-line); }
  .ribbon-haze { fill: none; stroke: var(--color-art-light); stroke-width: var(--space-5); opacity: var(--opacity-ring); }
  .orbit { fill: var(--color-art-light); } .orbit-ring { fill: none; stroke: var(--color-art-light); stroke-width: var(--border-width); opacity: var(--opacity-line); }
  .horizon, .haze { fill: var(--color-art-base); } .haze-line { fill: none; stroke: var(--color-art-mid); opacity: var(--opacity-muted); }
  .terrain { fill: var(--color-art-base); stroke: var(--color-art-light); stroke-width: var(--border-width); }
  :global(html[data-runtime='native']) .grain { display: none; }
  /* SVG blur filters are rasterised on the CPU in Android WebView: every placeholder cover repainted slowly. */
  :global(html[data-runtime='native']) svg [filter] { filter: none; }
  .grain { position: absolute; inset: 0; pointer-events: none; background: url('/noise.png') repeat; opacity: var(--opacity-noise); mix-blend-mode: screen; }
  .heart { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-art-shine); }
</style>
