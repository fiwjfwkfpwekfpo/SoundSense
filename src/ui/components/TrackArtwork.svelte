<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { useModel } from '../context.svelte';
  import Cover from './Cover.svelte';
  import LiveCover from './LiveCover.svelte';
  import { loadArtwork } from '../../platform/artwork';
  import { sampleTransition } from '../../debug/frame-sample';
  import { DEBUG_TOOLS } from '../../core/build';
  let { dragX = 0, dragY = 0, dragging = false }: { dragX?: number; dragY?: number; dragging?: boolean } = $props();
  const ui = useModel();
  const uid = $props.id();
  let transition = $derived(ui.player?.transition);
  let elapsed = $state(1);
  let currentElement = $state<HTMLDivElement>(), outgoingElement = $state<HTMLDivElement>();
  let progress = $derived(elapsed);
  let coverEffect = $derived(ui.appearance.groups.cover.effect);
  let old = $derived(transition && progress < 1 ? ui.api.library.getTrack(transition.from) : undefined);
  let next = $derived(ui.api.library.getTrack(ui.player?.queue[(ui.player?.currentIndex ?? 0) + 1]?.trackId ?? ''));
  $effect(() => { if (ui.player?.crossfade) return; const url = next?.artwork.url; if (url) void loadArtwork(url).catch(() => {}); });
  let releaseOffset = $derived(transition?.id === ui.coverRelease.transitionId ? ui.coverRelease.offset : 0);
  let releaseVelocity = $derived(transition?.id === ui.coverRelease.transitionId ? ui.coverRelease.velocity : 0);
  let width = $state(250);
  let direction = $derived(transition?.direction ?? 1);
  $effect(() => {
    const current = transition;
    if (!current) { elapsed = 1; return; }
    const duration = untrack(() => !ui.appearance.groups.cover.duration ? 0 : current.kind === 'crossfade' ? current.duration : Math.min(340, ui.appearance.groups.cover.duration));
    if (!duration) { elapsed = 1; return; }
    const speed = untrack(() => Math.max(0, Math.min(20, releaseVelocity / (-direction * width * 1.45 - releaseOffset || 1))));
    const effect = untrack(() => coverEffect), dir = untrack(() => direction), offset = untrack(() => releaseOffset);
    elapsed = 0; let cancelled = false; const animations: Animation[] = [];
    const finishSample = DEBUG_TOOLS ? sampleTransition(duration, stats => ui.api.diagnostics?.record('ui', 'track.transition.frames', { ...stats, transitionId: current.id, kind: current.kind, effect, duration, queue: ui.player?.queue.length ?? 0, library: ui.library?.tracks.length ?? 0, pixelRatio: devicePixelRatio, cores: navigator.hardwareConcurrency })) : () => {};
    if (DEBUG_TOOLS) void ui.api.performance?.sampleTransition(duration).then(stats => ui.api.diagnostics?.record('ui', 'track.transition.nativeFrames', { ...stats, transitionId: current.id, kind: current.kind, effect, duration })).catch(() => {});
    void tick().then(() => {
      if (cancelled || !currentElement) return;
      const incoming: Keyframe[] = [], outgoing: Keyframe[] = [];
      // Bake the spring once. Transform/opacity then run on the compositor;
      // no reactive Svelte render loop runs on every animation frame.
      for (let i = 0; i <= 32; i++) {
        const t = i / 32, seconds = t * duration / 1000;
        const p = current.kind === 'crossfade' ? t : i === 32 ? 1 : Math.max(0, Math.min(1, 1 - (1 + (22 - speed) * seconds) * Math.exp(-22 * seconds)));
        incoming.push({ offset: t, transform: transformFor(p, effect, dir), opacity: ['crossfade', 'zoom'].includes(effect) ? p : effect === 'stack' ? .62 + .38 * p : 1, ...(effect === 'goo' ? { clipPath: clipFor(p) } : {}) });
        outgoing.push({ offset: t, transform: effect === 'stack' ? `translateX(calc(${offset * (1 - p)}px + ${-dir * p * 145}%)) rotate(${offset / 24 * (1 - p) - dir * p * 24}deg)` : effect === 'slide' ? `translateX(calc(${offset * (1 - p)}px + ${-dir * p * 100}%))` : 'none', opacity: effect === 'goo' ? 1 : current.kind === 'manual' && effect === 'stack' ? Math.min(1, (1 - p) / .3) : 1 - p });
      }
      animations.push(currentElement.animate(incoming, { duration, easing: 'linear', fill: 'forwards' }));
      if (outgoingElement) animations.push(outgoingElement.animate(outgoing, { duration, easing: 'linear', fill: 'forwards' }));
      void animations[0]!.finished.then(async () => { if (!cancelled) { elapsed = 1; await tick(); if (!cancelled) for (const animation of animations) animation.cancel(); } }).catch(() => {});
    });
    return () => { cancelled = true; for (const animation of animations) animation.cancel(); finishSample(); };
  });
  function transformFor(progress: number, effect: string, dir: number): string {
    if (effect === 'stack') return `translateY(${-12 * (1 - progress)}px) scale(${.92 + .08 * progress})`;
    if (effect === 'zoom') return `scale(${1.1 - .1 * progress})`;
    if (effect === 'slide') return `translateX(${dir * (1 - progress) * 100}%)`;
    return 'none';
  }
  function clipFor(progress: number) { return `polygon(0 0,100% 0,100% ${Math.min(100, progress * 120)}%,85% ${Math.min(100, progress * 130)}%,70% ${Math.min(100, progress * 115)}%,55% ${Math.min(100, progress * 135)}%,40% ${Math.min(100, progress * 110)}%,25% ${Math.min(100, progress * 130)}%,10% ${Math.min(100, progress * 115)}%,0 ${Math.min(100, progress * 125)}%)`; }
</script>
{#if ui.track}
<div class="art-stack" bind:clientWidth={width} data-testid="track-artwork" data-effect={coverEffect} data-transition-progress={progress.toFixed(3)}>
  {#if coverEffect === 'stack' && next}<div class="stack-back"><Cover artwork={old ? ui.track.artwork : next.artwork} animate={false} full /></div>{/if}
  <div class="current" bind:this={currentElement} class:settling={!dragging && !old} style:transform={old ? transformFor(0, coverEffect, direction) : `translate(${dragX}px, ${dragY}px) rotate(${dragX / 24}deg) scale(${1 - Math.min(.12, Math.abs(dragY) / 1600)})`} style:filter={old && coverEffect === 'goo' ? `url(#${uid}-goo)` : undefined}><Cover artwork={ui.track.artwork} animate={false} full />{#if !old}<LiveCover />{/if}</div>
  {#if old && coverEffect !== 'none'}<div class="outgoing" bind:this={outgoingElement} style:transform={`translateX(${releaseOffset}px) rotate(${releaseOffset / 24}deg)`} style:z-index={coverEffect === 'goo' ? 0 : 2}><Cover artwork={old.artwork} animate={false} full /></div>{/if}
  {#if coverEffect === 'goo'}<svg class="filter" aria-hidden="true"><defs><filter id={`${uid}-goo`}><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" /><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7" result="goo" /><feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter></defs></svg>{/if}
</div>
{/if}
<style>
  .art-stack { position: relative; width: min(58vw, 250px); aspect-ratio: 1; max-height: 100%; border-radius: var(--radius-l); isolation: isolate; touch-action: none; will-change: transform; }
  .current, .outgoing, .stack-back { position: absolute; inset: 0; border-radius: inherit; box-shadow: var(--shadow-nav); }
  .current { z-index: 1; will-change: transform, opacity; overflow: hidden; }
  /* After a vertical drag the cover springs back; during a drag it follows the finger exactly. */
  .current.settling { transition: transform 220ms cubic-bezier(.2, .8, .2, 1); } .outgoing { z-index: 2; will-change: transform, opacity; pointer-events: none; }
  .stack-back { transform: translateY(-12px) scale(.92); opacity: var(--opacity-muted); }
  .filter { position: absolute; width: 0; height: 0; pointer-events: none; }
</style>
