<script lang="ts">
  import { playPause, generalEffect } from '../appearance/motion/runtime';
  import { untrack } from 'svelte';
  export type IconName = 'home' | 'heart' | 'search' | 'settings' | 'bell' | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'more' | 'more-vertical' | 'play' | 'pause' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'repeat-one' | 'lyrics' | 'queue' | 'plus' | 'download' | 'artist' | 'share' | 'close' | 'check' | 'sort' | 'clock' | 'music' | 'folder' | 'sliders' | 'grip' | 'up' | 'down' | 'sun' | 'moon' | 'arrow-up-right' | 'library' | 'volume';
  let { name, size = 'm', filled = false }: { name: IconName; size?: 's' | 'm' | 'l'; filled?: boolean } = $props();
  let spark = $state(false); let sparkVersion = $state(0); let previous = untrack(() => filled);
  $effect(() => { spark = false; if (name === 'heart' && filled && !previous && generalEffect('like-sparks')) { spark = true; sparkVersion = untrack(() => sparkVersion) + 1; const timer = setTimeout(() => spark = false, 650); previous = filled; return () => clearTimeout(timer); } previous = filled; });
  const paths: Partial<Record<IconName, string>> = {
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
    search: 'M21 21l-5.1-5.1M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    settings: 'm9.5 3-.8 2.1-2 .9-2.2-.3-2.4 4.1L3.5 12l-1.4 2.2 2.4 4.1 2.2-.3 2 .9.8 2.1h5l.8-2.1 2-.9 2.2.3 2.4-4.1L20.5 12l1.4-2.2-2.4-4.1-2.2.3-2-.9L14.5 3Z M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4M12 2V1',
    'chevron-right': 'm9 5 7 7-7 7', 'chevron-left': 'm15 5-7 7 7 7', 'chevron-down': 'm5 9 7 7 7-7',
    next: 'm5 4 11 8L5 20ZM19 4v16', previous: 'm19 4-11 8 11 8ZM5 4v16',
    shuffle: 'M3 6h3c5 0 6 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 3.5-2 5-5m2-3c1.5-3 2.5-4 4-4h4m-4-4 4 4-4 4',
    repeat: 'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-3v5a2 2 0 0 1-2 2H3',
    'repeat-one': 'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-3v5a2 2 0 0 1-2 2H3m8-8 2-1v6',
    lyrics: 'M3 5h18M3 11h10M3 17h7m5-6h7m-3.5 0v10',
    queue: 'M3 5h14M3 11h14M3 17h8m5-2 5 3-5 3Z',
    plus: 'M12 4v16M4 12h16', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    artist: 'M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3',
    share: 'M12 16V2m-5 5 5-5 5 5M5 11H3v11h18V11h-2',
    close: 'm6 6 12 12M6 18 18 6', check: 'm5 12 4 4L20 5', sort: 'M4 6h16M4 12h11M4 18h6',
    clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    music: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
    folder: 'M3 6V4h6l3 3h9v14H3Z', sliders: 'M5 3v6m0 4v8M12 3v10m0 4v4m7-18v3m0 4v11M2 9h6m1 8h6m1-11h6',
    grip: 'M5 6h14M5 12h14M5 18h14', up: 'm5 15 7-7 7 7', down: 'm5 9 7 7 7-7',
    sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z',
    'arrow-up-right': 'M6 18 18 6M6 6h12v12', library: 'M4 3v18M9 3v18m5-17 6 16',
    volume: 'm3 9 5 0 5-5v16l-5-5H3Zm14-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16',
  };
</script>
<svg class:small={size === 's'} class:large={size === 'l'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'play' || name === 'pause'}<path use:playPause={name === 'pause'} fill="currentColor" stroke="none" />
  {:else if name === 'more' || name === 'more-vertical'}
    <g transform={name === 'more-vertical' ? 'rotate(90 12 12)' : undefined} fill="currentColor" stroke="none"><circle cx="4" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="20" cy="12" r="2" /></g>
  {:else}<path d={paths[name]} fill={filled ? 'currentColor' : 'none'} />{/if}
  {#key sparkVersion}{#if spark}<g class="sparks" stroke="currentColor" stroke-width="1.5">{#each Array(8) as _, i}<path d="M12 0v-3" style:transform={`rotate(${i * 45}deg)`} />{/each}</g>{/if}{/key}
</svg>
<style>
  svg:has(.sparks) > path { transform-origin: 12px 12px; animation: heart-pop var(--motion-general-duration) var(--motion-general-easing); }
  @keyframes heart-pop { 0% { transform: scale(.55); } 55% { transform: scale(1.25); } 100% { transform: scale(1); } }
  .sparks { transform-origin: 12px 12px; animation: sparks var(--motion-general-duration) var(--motion-general-easing) both; }
  .sparks path { transform-origin: 12px 12px; }
  @keyframes sparks { from { opacity: 1; transform: scale(.6); } to { opacity: 0; transform: scale(1.6); } }
  svg { overflow: visible; width: var(--icon-size); height: var(--icon-size); }
  .small { width: var(--icon-size-s); height: var(--icon-size-s); }
  .large { width: var(--icon-size-l); height: var(--icon-size-l); }
</style>
