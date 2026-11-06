<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../ui/context.svelte';
  import type { BeatPoint } from './trace.svelte';
  /** Beta overlay: live clock/animation counters and the beat detector graph. */
  const ui = useModel();
  let canvas = $state<HTMLCanvasElement>(), collapsed = $state(false);
  const hud = $derived(ui.trace?.hudState);
  onMount(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const points = ui.trace?.beatPoints, target = canvas; if (!target || !points || !ui.trace?.beat || collapsed) return;
      const ratio = Math.min(devicePixelRatio || 1, 2), w = Math.round(target.clientWidth * ratio), h = Math.round(target.clientHeight * ratio);
      if (target.width !== w) target.width = w; if (target.height !== h) target.height = h;
      const context = target.getContext('2d'); if (!context) return;
      const style = getComputedStyle(document.documentElement), color = (name: string) => style.getPropertyValue(name).trim();
      context.clearRect(0, 0, w, h);
      const step = w / 180, y = (value: number) => h - Math.max(0, Math.min(1, value)) * (h - 2) - 1;
      const line = (pick: (point: BeatPoint) => number, stroke: string) => { context.beginPath(); points.forEach((point, index) => { const x = index * step; if (index) context.lineTo(x, y(pick(point))); else context.moveTo(x, y(pick(point))); }); context.strokeStyle = stroke; context.lineWidth = ratio; context.stroke(); };
      context.fillStyle = color('--color-accent'); context.globalAlpha = .25;
      points.forEach((point, index) => { const height = Math.max(0, Math.min(1, point.level)) * h; context.fillRect(index * step, h - height, Math.max(1, step), height); });
      context.globalAlpha = 1;
      line(point => point.value, color('--color-text'));
      line(point => point.threshold, color('--color-text-muted'));
      context.fillStyle = color('--color-danger');
      points.forEach((point, index) => { if (point.beat) context.fillRect(index * step - ratio, 0, 2 * ratio, h); });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>
<aside class="trace-hud" class:collapsed aria-hidden="true">
  <button onclick={() => collapsed = !collapsed}>{collapsed ? 'trace ▸' : 'trace ▾'}</button>
  {#if !collapsed && hud}
    {#if ui.trace?.clock}<p>{hud.backend || '—'} · ×{hud.rate} · lat {hud.latency} ms · res {hud.residual} ms</p>
      <p>jumps {hud.jumps} · state {hud.stateJumps} · wave {hud.waveCorrections} · lyr {hud.lyricsCorrections} · long {hud.longFrames} · n {hud.samples}</p>{/if}
    {#if ui.trace?.beat}<p>beats {hud.beats} · rhythm {hud.rhythm}/{hud.expected}</p><canvas bind:this={canvas}></canvas>{/if}
  {/if}
</aside>
<style>
  .trace-hud { position: fixed; z-index: var(--z-toast); top: calc(var(--inset-top) + var(--space-1)); left: calc(var(--inset-left) + var(--space-1)); right: calc(var(--inset-right) + var(--space-1)); pointer-events: none; padding: var(--space-1) var(--space-2); border-radius: var(--radius-s); background: color-mix(in srgb, var(--color-bg) 82%, transparent); border: var(--border-width) solid var(--color-border); font: calc(var(--font-size-xs) * .9) / 1.35 ui-monospace, monospace; color: var(--color-text); }
  .trace-hud.collapsed { right: auto; }
  button { pointer-events: auto; color: var(--color-text-muted); font: inherit; }
  p { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  canvas { display: block; width: 100%; height: 56px; margin-top: var(--space-1); }
</style>
