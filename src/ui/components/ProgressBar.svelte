<script lang="ts">
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  /** Plain progress line used when the waveform is turned off: elapsed on the left, length on the right. */
  let { position = 0, duration = 0, onseek }: { position: number; duration?: number; onseek: (fraction: number) => void } = $props();
  const ui = useModel();
  let track: HTMLDivElement;
  let preview = $state<number | null>(null), dragging = $state(false);
  let fraction = $derived(Math.max(0, Math.min(1, preview ?? (duration ? position / duration : 0))));
  function point(event: PointerEvent) { const rect = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); }
  function down(event: PointerEvent) { if (!duration) return; event.stopPropagation(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); dragging = true; preview = point(event); }
  function move(event: PointerEvent) { if (dragging) preview = point(event); }
  function up(event: PointerEvent) { if (!dragging) return; dragging = false; const value = point(event); onseek(value); requestAnimationFrame(() => { preview = null; }); }
  function key(event: KeyboardEvent) {
    if (!duration || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const step = 5 / duration;
    onseek(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : Math.max(0, Math.min(1, fraction + (event.key === 'ArrowLeft' ? -step : step))));
  }
</script>
<div class="progress-bar" class:dragging data-testid="waveform" data-wave-samples="0">
  <div class="hit" role="slider" tabindex="0" aria-label={ui.t('player.seek')} aria-valuemin="0" aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(fraction * duration)} aria-valuetext={`${formatTime(fraction * duration)} / ${formatTime(duration)}`}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { dragging = false; preview = null; }} onkeydown={key}>
    <div bind:this={track} class="line"><div class="fill" style:transform={`scaleX(${fraction})`}></div><div class="knob" style:left={`${fraction * 100}%`}></div></div>
  </div>
  <div class="times" aria-hidden="true"><span>{formatTime(fraction * duration)}</span><span>{formatTime(duration)}</span></div>
</div>
<style>
  .progress-bar { width: 100%; padding-top: var(--space-5); }
  .hit { position: relative; height: var(--touch-size); display: flex; align-items: center; touch-action: none; cursor: pointer; margin: calc(var(--touch-size) / -2 + var(--progress-height) / 2) 0; }
  .line { position: relative; width: 100%; height: var(--progress-height); background: var(--color-wave-rest); border-radius: var(--radius-full); }
  .fill { position: absolute; inset: 0; background: var(--color-wave-played); border-radius: var(--radius-full); transform-origin: left; will-change: transform; }
  .knob { position: absolute; top: 50%; width: var(--space-3); height: var(--space-3); margin-left: calc(var(--space-3) / -2); background: var(--color-wave-played); border-radius: var(--radius-full); transform: translateY(-50%) scale(1); transition: transform var(--motion-general-duration) var(--motion-general-easing); }
  .dragging .knob { transform: translateY(-50%) scale(1.5); }
  .times { display: flex; justify-content: space-between; margin-top: var(--space-2); font-size: calc(var(--font-size-sm) * var(--font-scale)); font-variant-numeric: tabular-nums; color: var(--color-text-muted); }
  .times span:first-child { color: var(--color-text); }
</style>
