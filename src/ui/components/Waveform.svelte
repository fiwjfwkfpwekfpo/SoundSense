<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resampleSamples } from '../../core/waveform';
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  import { waveformProgress } from '../appearance/motion/runtime';
  let { samples = [], position = 0, duration = 0, mirrored = false, building = false, waveKey = '', onseek }: {
    samples?: readonly number[]; position: number; duration?: number; mirrored?: boolean; building?: boolean; waveKey?: string; onseek: (position: number) => void;
  } = $props();
  const ui = useModel();
  let element: HTMLDivElement; let canvas: HTMLCanvasElement; let playedCanvas: HTMLCanvasElement;
  let width = $state(0); let height = $state(0); let revision = $state(0); let preview = $state<number | null>(null);
  let barSize = $state(2); let barGap = $state(2); let dragging = $state(false);
  let targets = $derived(resampleSamples(samples, Math.max(1, Math.floor(width / (barSize + barGap)))));
  // Animated amplitudes belong to the canvas. Keeping them outside reactive
  // state avoids scheduling a Svelte render and progress action on every frame.
  let values: readonly number[] = [];
  function morphProgress(value: number) { if (element) element.dataset.morphProgress = value.toFixed(3); }
  let lastWaveKey = '', lastBuilding = false;
  $effect(() => {
    const target = targets, key = waveKey, progressive = building; if (!width) return;
    const changed = key !== lastWaveKey, finishedBuilding = lastBuilding && !progressive; lastWaveKey = key; lastBuilding = progressive;
    if (!changed && (progressive || finishedBuilding)) { values = target; morphProgress(1); untrack(draw); return; }
    const old = untrack(() => values), effect = untrack(() => ui.appearance.groups.waveform.effect);
    const durationMs = untrack(() => ui.player?.transition?.kind === 'crossfade' && ui.player.crossfade ? ui.player.transition.duration : ui.appearance.groups.waveform.duration);
    if (effect === 'none' || !durationMs) { values = target; morphProgress(1); untrack(draw); return; }
    const from = old.length && effect === 'morph' ? resampleSamples(old, target.length) : target.map(() => 0);
    const animated = [...from]; values = animated;
    const start = performance.now(); let frame = 0; morphProgress(0);
    function animate(now: number) {
      const progress = Math.min(1, (now - start) / durationMs); morphProgress(progress);
      for (let index = 0; index < target.length; index++) {
        const local = Math.max(0, Math.min(1, (progress - index / Math.max(1, target.length - 1) * .28) / .72));
        const spring = local === 1 ? 1 : effect === 'morph' ? 1 - Math.exp(-8 * local) * Math.cos(10 * local) : local * local * (3 - 2 * local);
        animated[index] = Math.max(0, Math.min(1, from[index]! + (target[index]! - from[index]!) * spring));
      }
      untrack(draw);
      if (progress < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  });
  let value = $derived(Math.min(1, Math.max(0, preview ?? position)));
  let paint: { played: string; rest: string; minimum: number; mirrorOpacity: number; line: number } | undefined;
  function draw() {
    if (!canvas || !playedCanvas || !width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (!paint) {
      const tokens = getComputedStyle(document.documentElement);
      paint = { played: tokens.getPropertyValue('--color-wave-played').trim(), rest: tokens.getPropertyValue('--color-wave-rest').trim(), minimum: parseFloat(tokens.getPropertyValue('--wave-min')), mirrorOpacity: parseFloat(tokens.getPropertyValue('--opacity-wave-mirror')), line: parseFloat(tokens.getPropertyValue('--progress-height')) };
    }
    const { played, rest, minimum, mirrorOpacity, line } = paint;
    const center = height / 2;
    const bars = new Path2D(), mirrors = new Path2D();
    if (samples.length) for (let i = 0; i < values.length; i++) {
      const x = i * (barSize + barGap);
      const barHeight = Math.max(minimum, values[i]! * height * (mirrored ? 0.48 : 0.85));
      const y = mirrored ? center - barHeight : (height - barHeight) / 2;
      bars.roundRect(x, y, barSize, barHeight, barSize / 2);
      if (mirrored) mirrors.roundRect(x, center, barSize, barHeight, barSize / 2);
    }
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    // Both colors are rasterized only when samples, size, or palette change.
    // The selected motion runtime reveals the played canvas using transforms.
    for (const [target, color] of [[canvas, rest], [playedCanvas, played]] as const) {
      if (target.width !== pixelWidth) target.width = pixelWidth;
      if (target.height !== pixelHeight) target.height = pixelHeight;
      const context = target.getContext('2d'); if (!context) continue;
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, target.width, target.height);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = color;
      if (!samples.length) {
        context.fillRect(0, center - line / 2, width, line); continue;
      }
      context.fill(bars);
      if (mirrored) { context.globalAlpha = mirrorOpacity; context.fill(mirrors); context.globalAlpha = 1; }
    }
  }
  $effect(() => { void revision; void mirrored; untrack(draw); });
  onMount(() => {
    let updateFrame = 0;
    const update = () => {
      // Layout dimensions come from ResizeObserver, independently of animated
      // parent transforms. Theme events only refresh the paint and bar tokens.
      paint = undefined;
      const tokens = getComputedStyle(document.documentElement);
      barSize = parseFloat(tokens.getPropertyValue('--wave-bar')); barGap = parseFloat(tokens.getPropertyValue('--wave-gap')); revision++;
    };
    const schedule = () => { if (!updateFrame) updateFrame = requestAnimationFrame(() => { updateFrame = 0; update(); }); };
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect; if (!size) return;
      width = size.width; height = size.height; revision++;
    }); observer.observe(canvas); update();
    window.addEventListener('app:theme', schedule); window.addEventListener('app:appearance', schedule); window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(updateFrame); observer.disconnect(); window.removeEventListener('app:theme', schedule); window.removeEventListener('app:appearance', schedule); window.removeEventListener('resize', schedule); };
  });
  function tickHaptics(fraction: number) { const index = Math.min(values.length - 1, Math.floor(fraction * values.length)); ui.api.haptics.wave(index, values[index] ?? 0); }
  function point(event: PointerEvent) { const rect = canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); }
  function down(event: PointerEvent) { dragging = true; canvas.setPointerCapture(event.pointerId); preview = point(event); ui.api.haptics.start(); tickHaptics(preview); }
  function move(event: PointerEvent) { if (dragging) { preview = point(event); tickHaptics(preview); } }
  function up(event: PointerEvent) { if (!dragging) return; dragging = false; ui.api.haptics.end(); onseek(point(event)); preview = null; }
  function key(event: KeyboardEvent) {
    const step = duration ? 5 / duration : .02;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); onseek(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : Math.max(0, Math.min(1, value + (event.key === 'ArrowLeft' ? -step : step))));
    }
  }
</script>
<div bind:this={element} class="waveform" data-motion-group="waveform" data-morph-progress="1.000" data-wave-samples={samples.length} class:dragging data-testid="waveform">
  <canvas bind:this={canvas} role="slider" tabindex="0" aria-label={ui.t('player.seek')} aria-valuemin="0" aria-valuemax={duration || 100} aria-valuenow={Math.round(value * (duration || 100))} aria-valuetext={`${formatTime(value * duration)} / ${formatTime(duration)}`} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { dragging = false; preview = null; ui.api.haptics.end(); }} onkeydown={key}></canvas>
  <div class="wave-progress" aria-hidden="true" use:waveformProgress={{ position: value, instant: dragging, steps: samples.length ? targets.length : 64 }}><canvas bind:this={playedCanvas}></canvas></div>
  <div class="time" style:left={dragging && width ? `${Math.max(78, Math.min(width - 78, value * width))}px` : '50%'} aria-hidden="true"><span>{formatTime(value * duration)}</span><i></i><span>{formatTime(duration)}</span></div>
</div>
<style>
  .waveform { position: relative; width: 100%; height: var(--wave-height); }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: pointer; border-radius: var(--radius-s); }
  .wave-progress { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .wave-progress canvas { pointer-events: none; }
  .time { pointer-events: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--color-bg); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-full); font-size: calc(var(--font-size-sm) * var(--font-scale)); font-variant-numeric: tabular-nums; font-weight: var(--font-weight-semibold); box-shadow: var(--shadow-nav); }
  .time span:last-child { color: var(--color-text-muted); }
  .time i { width: var(--border-width); height: var(--space-3); background: var(--color-text-subtle); }
  .dragging .time { transform: translate(-50%, -50%) scale(1.06); }
</style>
