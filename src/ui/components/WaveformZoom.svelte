<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resampleSamples } from '../../core/waveform';
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  import { debugHooks } from '../../core/debug-hooks';
  /**
   * SoundCloud-style waveform: the playhead stays in the centre and a zoomed
   * view of the whole track scrolls under it.
   */
  let { samples = [], position = 0, duration = 0, building = false, waveKey = '', onseek }: {
    samples?: readonly number[]; position: number; duration?: number; building?: boolean; waveKey?: string; onseek: (fraction: number) => void;
  } = $props();
  const ui = useModel();
  const BARS_PER_SECOND = 1, MAX_BARS = 1600, MAX_CANVAS = 16000, BASELINE = .64;
  let root: HTMLDivElement, bars: HTMLDivElement;
  let width = $state(0), height = $state(0), pitch = $state(4), barSize = $state(2), revision = $state(0);
  let dragging = $state(false), preview: number | null = null, timeText = $state('0:00');
  let count = $derived(Math.max(1, Math.min(MAX_BARS, Math.max(Math.round(duration * BARS_PER_SECOND), Math.ceil(width / pitch * 1.5)))));
  let total = $derived(count * pitch);
  let values = $derived(resampleSamples(samples, count));
  let paint: { played: string; rest: string; minimum: number; mirror: number; ghost: number } | undefined;

  /**
   * Motion runs on the compositor, like the Quickshell progress bar: a strip of bars a
   * little wider than the widget is drawn once (into a "rest" and a "played" canvas) and
   * slid left by a linear Web Animation at the playback rate. The played colour is a fixed
   * clip at the playhead. The strip is redrawn only when it runs out (~every 20 s), on
   * seeks and while scrubbing; JavaScript never moves it frame by frame, so the wave keeps
   * gliding even while the page is busy.
   */
  const MARGIN_BARS = 24;
  let restCanvas: HTMLCanvasElement, playedCanvas: HTMLCanvasElement, ghostCanvas: HTMLCanvasElement, playedClip: HTMLDivElement, ghostClip: HTMLDivElement;
  let strip: { from: number; seconds: number; left: number } | null = null, motions: Animation[] = [];
  const speed = () => duration ? total / duration : 0;
  function tokensOnce() { if (!paint) { const tokens = getComputedStyle(document.documentElement); paint = { played: tokens.getPropertyValue('--color-wave-played').trim(), rest: tokens.getPropertyValue('--color-wave-rest').trim(), minimum: parseFloat(tokens.getPropertyValue('--wave-min')) || 2, mirror: parseFloat(tokens.getPropertyValue('--opacity-wave-mirror')) || .35, ghost: parseFloat(tokens.getPropertyValue('--opacity-wave-ghost')) || .45 }; } return paint; }
  /** Draws bars [from, from + n) of the track into a canvas, bar `from` at x = 0. */
  function paintStrip(target: HTMLCanvasElement, color: string, from: number, stripWidth: number) {
    const look = tokensOnce(), ratio = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(stripWidth * ratio), h = Math.round(height * ratio);
    if (target.width !== w) target.width = w; if (target.height !== h) target.height = h;
    target.style.width = `${stripWidth}px`;
    const context = target.getContext('2d'); if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, w, h); context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const base = height * BASELINE, up = new Path2D(), down = new Path2D(), last = Math.min(count - 1, from + Math.ceil(stripWidth / pitch));
    for (let i = Math.max(0, from); i <= last; i++) {
      const value = values[i] ?? 0, x = (i - from) * pitch;
      const top = Math.max(look.minimum, value * base * .96), bottom = Math.max(look.minimum * .6, value * (height - base) * .9);
      up.rect(x, base - top, barSize, top); down.rect(x, base + 1, barSize, bottom);
    }
    context.fillStyle = color; context.fill(up); context.globalAlpha = look.mirror; context.fill(down); context.globalAlpha = 1;
  }
  /** Screen x of the strip's left edge when the playhead is at `seconds`. */
  const stripX = (seconds: number) => width / 2 - seconds * speed() + (strip?.left ?? 0);
  function build(seconds: number) {
    if (!restCanvas || !width || !height || !duration) return;
    const center = width / 2, from = Math.max(0, Math.floor((seconds * speed() - center) / pitch) - 2), stripWidth = width + MARGIN_BARS * pitch + 4 * pitch;
    strip = { from, seconds, left: from * pitch };
    const look = tokensOnce();
    paintStrip(restCanvas, look.rest, from, stripWidth); paintStrip(playedCanvas, look.played, from, stripWidth); paintStrip(ghostCanvas, look.played, from, stripWidth);
    animate(seconds);
  }
  /** One linear slide covering the strip's spare width; its time is media time from strip start. */
  function animate(seconds: number) {
    motions.forEach(motion => motion.cancel()); motions = [];
    if (!strip || !speed()) return;
    const run = MARGIN_BARS * pitch / speed(), start = stripX(strip.seconds), end = start - MARGIN_BARS * pitch;
    const frames = [{ transform: `translate3d(${start}px,0,0)` }, { transform: `translate3d(${end}px,0,0)` }];
    for (const canvas of [restCanvas, playedCanvas]) { const motion = canvas.animate(frames, { duration: run * 1000, fill: 'both', easing: 'linear' }); motion.pause(); motions.push(motion); }
    motions[0]!.onfinish = () => { if (playing) build(current()); };
    align(seconds, true);
  }
  function current() { const clock = ui.api.player.livePosition?.(); return Math.max(0, Math.min(duration, clock ? clock.position : position)); }
  /** Puts the slide where the audio clock is; corrects only differences you could see (> ~½ px). */
  function align(seconds: number, force = false) {
    if (!strip || !motions.length) { build(seconds); return; }
    const offset = (seconds - strip.seconds) * 1000, run = MARGIN_BARS * pitch / speed() * 1000;
    if (offset < 0 || offset >= run) { if (!force && playing) debugHooks.wave?.('rebuild', { reason: offset < 0 ? 'behind' : 'ahead', offsetMs: Math.round(offset), runMs: Math.round(run) }); build(seconds); return; }
    const clock = ui.api.player.livePosition?.(), rate = Math.max(.25, clock?.rate ?? 1);
    // play() on a finished animation would rewind the strip by ~20 s: rebuild instead.
    if (motions.some(motion => motion.playState === 'finished')) { if (playing) debugHooks.wave?.('rebuild', { reason: 'finished', offsetMs: Math.round(offset), runMs: Math.round(run) }); build(seconds); return; }
    const drift = Number(motions[0]!.currentTime ?? 0) - offset, limit = Math.max(60, 500 / speed());
    if (!force && Math.abs(drift) > limit && playing && preview === null) debugHooks.wave?.('correct', { driftMs: Math.round(drift), limitMs: Math.round(limit), px: Math.round(drift / 1000 * speed() * 10) / 10, rate });
    for (const motion of motions) {
      if (force || Math.abs(Number(motion.currentTime ?? 0) - offset) > limit) motion.currentTime = offset;
      if (motion.playbackRate !== rate) motion.playbackRate = rate;
      if (playing && preview === null && motion.playState !== 'running') motion.play(); else if ((!playing || preview !== null) && motion.playState === 'running') motion.pause();
    }
  }
  /** Scrubbing: the strip follows the finger; the real position stays visible as a shadow. */
  function place() {
    if (preview === null) { ghostClip?.style.setProperty('display', 'none'); align(current(), true); return; }
    align(preview, true);
    const center = width / 2, actual = Math.max(-1, Math.min(width + 1, center + (Math.max(0, Math.min(duration, position)) - preview) * speed()));
    const from = Math.min(center, actual), to = Math.max(center, actual);
    if (to - from > .5 && ghostClip) { ghostClip.style.display = ''; ghostClip.style.left = `${from}px`; ghostClip.style.width = `${to - from}px`; ghostCanvas.style.transform = `translate3d(${stripX(preview) - from}px,0,0)`; }
    else ghostClip?.style.setProperty('display', 'none');
    const text = formatTime(preview); if (text !== timeText) timeText = text;
  }
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; strip = null; build(preview ?? current()); }); };
  $effect(() => { void values; void revision; void total; void duration; void height; schedule(); });
  // A new track never inherits a scrub preview or its shadow.
  $effect(() => { void waveKey; untrack(() => { if (!gesture) { preview = null; ghostClip?.style.setProperty('display', 'none'); } }); });
  $effect(() => { if (playedClip) playedClip.style.width = `${width / 2}px`; });

  let playing = false;
  $effect(() => {
    const clock = ui.clock; untrack(() => {
      playing = clock.playing;
      if (preview === null) { align(current(), !playing); const text = formatTime(Math.max(0, Math.min(duration, clock.position))); if (text !== timeText) timeText = text; }
    });
  });
  onMount(() => () => { motions.forEach(motion => motion.cancel()); cancelAnimationFrame(frame); });

  // A new track grows out of the baseline; crossfades use the crossfade length.
  // Not an effect cleanup: progressive sample updates must not cancel a running grow.
  let lastKey = '', grow: Animation | undefined;
  onMount(() => () => grow?.cancel());
  $effect(() => {
    const key = waveKey, ready = samples.length > 0; if (!ready || key === lastKey) return;
    const first = !lastKey; lastKey = key; if (first || !bars?.animate) return;
    const group = untrack(() => ui.appearance.groups.waveform), transition = untrack(() => ui.player?.transition);
    const ms = transition?.kind === 'crossfade' ? transition.duration : group.duration;
    if (group.effect === 'none' || !ms) return;
    grow?.cancel();
    const animation = grow = bars.animate([{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: Math.min(ms, 3000), easing: 'cubic-bezier(.2,.8,.2,1)' });
    root.dataset.morphProgress = '0.000'; const done = () => { if (root) root.dataset.morphProgress = '1.000'; };
    animation.onfinish = done; animation.oncancel = done;
  });

  onMount(() => {
    const tokens = () => { const style = getComputedStyle(document.documentElement); barSize = parseFloat(style.getPropertyValue('--wave-bar')) || 2; pitch = barSize + (parseFloat(style.getPropertyValue('--wave-gap')) || 2); paint = undefined; revision++; };
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect; if (!size) return; width = size.width; height = size.height; revision++; });
    observer.observe(root); tokens();
    window.addEventListener('app:theme', tokens); window.addEventListener('app:appearance', tokens);
    return () => { observer.disconnect(); window.removeEventListener('app:theme', tokens); window.removeEventListener('app:appearance', tokens); };
  });

  let gesture: { id: number; x: number; from: number; moved: boolean } | null = null;
  const bar = (seconds: number) => Math.min(count - 1, Math.floor((duration ? seconds / duration : 0) * count));
  function down(event: PointerEvent) {
    if (!duration) return;
    event.stopPropagation(); root.setPointerCapture(event.pointerId);
    gesture = { id: event.pointerId, x: event.clientX, from: Math.max(0, Math.min(duration, position)), moved: false };
    dragging = true; ui.api.haptics.start();
  }
  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x; if (!gesture.moved && Math.abs(dx) < 5) return;
    gesture.moved = true;
    preview = Math.max(0, Math.min(duration, gesture.from - dx / total * duration));
    ui.api.haptics.wave(bar(preview), 0); place();
  }
  function up(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const target = gesture.moved ? preview ?? gesture.from : Math.max(0, Math.min(duration, gesture.from + (event.clientX - root.getBoundingClientRect().left - width / 2) / total * duration));
    gesture = null; dragging = false; ui.api.haptics.end();
    preview = target; place(); onseek(duration ? target / duration : 0);
    // Keep the preview until the player confirms the new position.
    // The shadow must go away with the preview, or a stale one stays on screen (also into the next track).
    requestAnimationFrame(() => { preview = null; place(); });
  }
  function cancel() { gesture = null; dragging = false; preview = null; ui.api.haptics.end(); place(); }
  function key(event: KeyboardEvent) {
    if (!duration || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const seconds = event.key === 'Home' ? 0 : event.key === 'End' ? duration : position + (event.key === 'ArrowLeft' ? -5 : 5);
    onseek(Math.max(0, Math.min(1, seconds / duration)));
  }
</script>
<div bind:this={root} class="wave-zoom" class:dragging role="slider" tabindex="0" aria-label={ui.t('player.seek')} aria-valuemin="0" aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
  data-testid="waveform" data-morph-progress="1.000" data-wave-samples={samples.length} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} onkeydown={key}>
  <div bind:this={bars} class="bars" aria-hidden="true"><canvas bind:this={restCanvas}></canvas><div class="clip" bind:this={playedClip}><canvas bind:this={playedCanvas}></canvas></div><div class="clip ghost" style="display:none" bind:this={ghostClip}><canvas bind:this={ghostCanvas}></canvas></div></div>
  <div class="time" aria-hidden="true"><span>{timeText}</span><i></i><span>{formatTime(duration)}</span></div>
</div>
<style>
  .wave-zoom { position: relative; width: 100%; height: var(--wave-height); overflow: hidden; touch-action: none; cursor: grab; outline-offset: var(--space-1); }
  .dragging { cursor: grabbing; }
  .bars { position: absolute; inset: 0; transform-origin: 50% 64%; pointer-events: none; }
  canvas { position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
  .clip { position: absolute; left: 0; top: 0; bottom: 0; overflow: hidden; }
  .ghost { opacity: var(--opacity-wave-ghost, .45); }
  .time { pointer-events: none; position: absolute; top: 64%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); background: var(--color-bg); border-radius: var(--radius-s); font-size: calc(var(--font-size-sm) * var(--font-scale)); font-variant-numeric: tabular-nums; font-weight: var(--font-weight-semibold); }
  .time span:last-child { color: var(--color-text-muted); }
  .time i { width: var(--border-width); height: var(--space-3); background: var(--color-text-subtle); }
  .dragging .time { transform: translate(-50%, -50%) scale(1.06); }
</style>
