<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import { debugHooks } from '../../core/debug-hooks';
  import { BETA_FEATURES } from '../../core/build';
  /**
   * Beat visuals of the player: a glow that pulses with the bass and sparks that fly off
   * the cover on strong beats. Both read the track's bass energy (device analysis, 20
   * frames per second) at the audio clock. Only transform/opacity of one element and a
   * small canvas change per frame; nothing runs while paused, hidden or switched off.
   */
  const ui = useModel();
  const FPS = 20;
  let glow = $state<HTMLDivElement>(), canvas = $state<HTMLCanvasElement>(), root: HTMLDivElement;
  let pulse = $derived(BETA_FEATURES && ui.settings.values.beatPulse !== false && !!ui.appearance.groups.general.duration);
  let sparks = $derived(BETA_FEATURES && ui.settings.values.beatParticles !== false && !!ui.appearance.groups.general.duration);
  let rhythm: Uint8Array | undefined, rhythmTrack = '';
  $effect(() => {
    const id = ui.track?.id; rhythm = undefined; rhythmTrack = id ?? '';
    if (!id || !(pulse || sparks) || !ui.api.library.getRhythm) return;
    let cancelled = false;
    void ui.api.library.getRhythm(id).then(value => { if (!cancelled && rhythmTrack === id) rhythm = value; }).catch(() => {});
    return () => { cancelled = true; };
  });

  type Spark = { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number };
  let particles: Spark[] = [], frame = 0, last = 0, level = 0, lastBeat = 0, color = '', ratio = 1;
  const energy = (seconds: number) => {
    const data = rhythm; if (!data?.length) return 0;
    const at = Math.max(0, seconds * FPS), index = Math.floor(at), fraction = at - index;
    const a = data[Math.min(data.length - 1, index)]!, b = data[Math.min(data.length - 1, index + 1)]!;
    return (a + (b - a) * fraction) / 255;
  };
  /**
   * Bass level of the preceding second, read straight from the analysis. A running average
   * started at zero (every track start fired a burst of sparks) and kept the previous
   * track's or position's level after a skip or seek.
   */
  const recent = (seconds: number) => {
    const data = rhythm; if (!data?.length) return 0;
    const end = Math.min(data.length, Math.max(0, Math.floor(seconds * FPS))), start = Math.max(0, end - FPS);
    if (end - start < 4) return 1;
    let sum = 0; for (let i = start; i < end; i++) sum += data[i]!;
    return sum / (end - start) / 255;
  };
  function spawn(strength: number) {
    const art = document.querySelector<HTMLElement>('[data-testid="player"] [data-testid="track-artwork"]'); if (!art || !root) return;
    const box = art.getBoundingClientRect(), frameBox = root.getBoundingClientRect();
    const cx = box.left + box.width / 2 - frameBox.left, cy = box.top + box.height / 2 - frameBox.top, radius = box.width / 2;
    const count = Math.min(26, 6 + Math.round(strength * 30));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 90 + Math.random() * 220 * (.6 + strength);
      // Start on the cover's edge (a rounded square): stretch the unit circle towards the square.
      const dx = Math.cos(angle), dy = Math.sin(angle), edge = radius / Math.max(Math.abs(dx), Math.abs(dy), .75);
      particles.push({ x: cx + dx * edge, y: cy + dy * edge, vx: dx * speed, vy: dy * speed, life: .55 + Math.random() * .6, age: 0, size: 1 + Math.random() * 2.2 });
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }
  function draw(dt: number) {
    if (!canvas) return;
    const w = Math.round(canvas.clientWidth * ratio), h = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== w) canvas.width = w; if (canvas.height !== h) canvas.height = h;
    const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, w, h);
    if (!particles.length) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.globalCompositeOperation = 'lighter'; context.fillStyle = color;
    particles = particles.filter(spark => {
      spark.age += dt; if (spark.age >= spark.life) return false;
      const drag = Math.exp(-2.2 * dt); spark.vx *= drag; spark.vy *= drag; spark.x += spark.vx * dt; spark.y += spark.vy * dt;
      const t = spark.age / spark.life; context.globalAlpha = (1 - t) * (1 - t) * .9;
      context.beginPath(); context.arc(spark.x, spark.y, spark.size * (1 - t * .5), 0, Math.PI * 2); context.fill();
      return true;
    });
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  }
  function tick(now: number) {
    frame = 0;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    const clock = ui.api.player.livePosition?.() ?? { position: ui.position, rate: 1, playing: ui.clock.playing };
    let value = 0, average = 0, kick = 0, beat = false;
    if (clock.playing && rhythm) {
      value = energy(clock.position + .03); average = recent(clock.position + .03);
      // Beat = bass clearly above the last second's level; the glow jumps up and decays in ~0.2 s.
      kick = Math.max(0, value - average * 1.12 - .03);
      level = Math.max(level * Math.exp(-dt / .18), Math.min(1, kick * 3.2));
      if (sparks && kick > .1 && now - lastBeat > 230) { lastBeat = now; beat = true; spawn(Math.min(1, kick * 2.5)); }
    } else level *= Math.exp(-dt / .25);
    debugHooks.beat?.({ position: clock.position, value, average, kick, level, beat, dt, rhythm: rhythm?.length ?? 0, pulse, sparks, particles: particles.length });
    if (glow) { if (pulse) { glow.style.opacity = (level * .85).toFixed(3); glow.style.transform = `scale(${(1 + level * .1).toFixed(4)})`; } else glow.style.opacity = '0'; }
    draw(dt);
    if (clock.playing || particles.length || level > .01) frame = requestAnimationFrame(tick); else last = 0;
  }
  const start = () => { if (!frame && (pulse || sparks) && !document.hidden) frame = requestAnimationFrame(tick); };
  $effect(() => { void ui.clock.playing; void pulse; void sparks; void ui.track?.id; color = getComputedStyle(root ?? document.documentElement).getPropertyValue('--color-accent').trim() || getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim(); start(); });
  onMount(() => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    const visible = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; } else start(); };
    document.addEventListener('visibilitychange', visible);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visible); };
  });
</script>
<div class="beat" bind:this={root} aria-hidden="true">
  {#if pulse}<div class="glow" bind:this={glow}></div>{/if}
  {#if sparks}<canvas bind:this={canvas}></canvas>{/if}
</div>
<style>
  .beat { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .glow { position: absolute; left: -20%; right: -20%; top: 8%; height: 70%; opacity: 0; background: radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 55%, transparent), transparent); will-change: transform, opacity; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
