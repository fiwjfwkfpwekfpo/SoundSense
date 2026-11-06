<script lang="ts">
  import Dock from '../components/Dock.svelte';
  import { isDesktop } from '../../platform/desktop';
  import { tick, untrack } from 'svelte';
  import { useModel } from '../context.svelte';
  import { debugHooks } from '../../core/debug-hooks';
  import { motion, motionTransition } from '../appearance/motion/runtime';
  import type { Lyrics } from '../../core/types';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  // Embedded: the right column of the wide desktop player (no header, no own dock or transition).
  let { embedded = false }: { embedded?: boolean } = $props();
  // Desktop with the side menu: the lyrics screen shows only the mini player, not a second tab bar.
  let sideNav = $derived(isDesktop() && ui.settings.values.navPosition !== 'bottom');
  let container = $state<HTMLDivElement>(); let linesElement = $state<HTMLDivElement>();
  let trackId = $derived(ui.player?.trackId);
  let lyrics = $state.raw<Lyrics | null>(null);
  let loading = $state(true); let failed = $state(false); let retry = $state(0);
  $effect(() => {
    void retry;
    const controller = new AbortController(); lyrics = null; loading = !!trackId; failed = false;
    if (trackId) void ui.api.lyrics.getLyrics(trackId, controller.signal)
      .then(value => { if (!controller.signal.aborted) lyrics = value; })
      .catch(() => { if (!controller.signal.aborted) failed = true; })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });
  // Smooth lyrics. The active line is a run of words; a soft highlight edge sweeps
  // through each word in turn (a background-clip gradient moved by the Web Animations
  // API on the compositor clock). JavaScript only aligns the animations with the audio
  // clock on seeks, pause/resume and rate changes, never per frame.
  let smooth = $derived(ui.settings.values.lyricsSmooth !== false);
  const live = () => ui.api.player.livePosition?.() ?? { position: ui.position, rate: 1, playing: ui.clock.playing };
  /** Words with their trailing space (the sweep runs through it) and their share of the line by letters. */
  function words(text: string) {
    const parts = text.match(/\S+\s*/g) ?? [], total = Math.max(1, text.replace(/\s+/g, '').length);
    let offset = 0;
    return parts.map(part => { const share = part.trim().length / total, start = offset; offset += share; return { text: part, start, share }; });
  }
  function timing(line: { time: number; text: string }, next: { time: number } | undefined) {
    const parts = words(line.text), count = Math.max(1, parts.length);
    // Long instrumental gaps: sing the line at a natural pace instead of stretching it over the gap.
    const length = Math.max(.4, Math.min(next ? next.time - line.time : 4, count * .55 + 1.2) * .96);
    return parts.map(part => ({ at: part.start * length, span: Math.max(.06, part.share * length) }));
  }
  /** Index of the last line that has started (binary search). */
  function locate(lines: readonly { time: number }[], position: number) {
    let low = 0, high = lines.length - 1, found = -1;
    while (low <= high) { const middle = (low + high) >> 1; if (lines[middle]!.time <= position + .05) { found = middle; low = middle + 1; } else high = middle - 1; }
    return found;
  }
  let active = $state(-1);
  // The active line follows the audio clock with its own timer. Small backwards
  // corrections of the clock (native reports arrive late) never move it back to the
  // previous line; only a real seek does.
  let lineTimer: ReturnType<typeof setTimeout> | undefined;
  function follow() {
    clearTimeout(lineTimer);
    const current = lyrics; if (!current || current.synced === false) { active = -1; return; }
    const { position, rate, playing } = live(), found = locate(current.lines, position);
    if (!(found < active && active >= 0 && current.lines[active]!.time - position < .9)) { if (found !== active && debugHooks.lyrics) debugHooks.lyrics(found < active ? 'line.back' : 'line', { from: active, to: found, position: Math.round(position * 1000), lineAt: found >= 0 ? Math.round(current.lines[found]!.time * 1000) : -1 }); active = found; }
    const next = current.lines[active + 1];
    if (playing && next) lineTimer = setTimeout(follow, Math.max(30, (next.time - position) / Math.max(.25, rate) * 1000 + 20));
    align();
  }
  let animations: Animation[] = [], animatedLine = -1;
  /** Puts the word animations of the active line where the audio clock is. */
  function align() {
    const current = lyrics;
    if (!current || !animations.length || animatedLine !== active) return;
    const { position, rate, playing } = live(), wanted = (position - current.lines[active]!.time) * 1000;
    for (const animation of animations) {
      // A sung word never "finishes" (endDelay), so play() cannot rewind it. While playing, only
      // a real jump (> 250 ms) is corrected; late clock reports must not nudge the sweep.
      const drift = Number(animation.currentTime ?? 0) - wanted;
      if (Math.abs(drift) > (playing ? 250 : 20)) { if (playing && animation === animations[0]) debugHooks.lyrics?.('correct', { driftMs: Math.round(drift), line: active, rate }); animation.currentTime = Math.max(0, wanted); }
      if (animation.playbackRate !== rate) animation.playbackRate = Math.max(.25, rate);
      if (playing && animation.playState !== 'running') animation.play(); else if (!playing && animation.playState === 'running') animation.pause();
    }
  }
  $effect(() => { void lyrics; untrack(() => { active = -1; follow(); }); return () => clearTimeout(lineTimer); });
  // Seeks, pause/resume and rate changes re-align immediately.
  $effect(() => { void ui.clock.playing; void ui.clock.position; untrack(follow); });
  $effect(() => {
    const index = active, current = lyrics, enabled = smooth, element = linesElement;
    if (!current || current.synced === false || index < 0 || !enabled || !element) return;
    const plan = timing(current.lines[index]!, current.lines[index + 1]);
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      const spans = [...element.querySelectorAll<HTMLElement>(`[data-line="${index}"] .word`)];
      animations = spans.map((span, i) => { const word = plan[i] ?? { at: 0, span: .2 }; const animation = span.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: word.span * 1000, delay: word.at * 1000, endDelay: 3_600_000, fill: 'both', easing: 'linear' }); animation.pause(); return animation; });
      animatedLine = index; align();
    });
    return () => { cancelled = true; animations.forEach(animation => animation.cancel()); animations = []; animatedLine = -1; };
  });
  $effect(() => {
    const index = active;
    if (index < 0 || !container || !linesElement) return;
    const animations = parseFloat(document.documentElement.style.getPropertyValue('--motion-lyrics-duration')) > 0;
    void tick().then(() => {
      const element = linesElement?.querySelector<HTMLElement>(`[data-line="${index}"]`);
      if (element && container) container.scrollTo({ top: element.offsetTop - container.clientHeight * .4, behavior: animations ? 'smooth' : 'instant' });
    });
  });
</script>
<section class="lyrics" class:embedded data-motion-group="general" transition:motionTransition|global={{ group: 'general', enabled: !embedded }} aria-label={ui.t('lyrics.title')}>
  {#if !embedded}<header><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><div><h1>{ui.t('lyrics.title')}</h1><p>{ui.track?.title} · {ui.track?.artist.name}</p></div><button class="icon-button" aria-label={ui.t('nav.close')} onclick={() => ui.nav.back()}><Icon name="close" size="s" /></button></header>{/if}
  {#if loading}<div class="loading" role="status" aria-live="polite"><span class="loading-line"></span><p>{ui.t('lyrics.loading')}</p></div>
  {:else if lyrics && lyrics.synced === false}<div class="lyrics-scroll plain" bind:this={container}><p class="hint">{ui.t('lyrics.plainHint')}</p><div class="plain-text">{#each lyrics.lines as line}<p class:gap={!line.text}>{line.text || '\u00a0'}</p>{/each}</div><p class="credit">{ui.t(lyrics.creditKey)}</p></div>
  {:else if lyrics}<div class="lyrics-scroll" bind:this={container}><p class="hint">{ui.t('lyrics.seekHint')}</p><div class="lines" bind:this={linesElement}>{#each lyrics.lines as line, index}<button use:motion={{ group: 'lyrics', key: index === active, enabled: index === active }} class:active={index === active} class:past={index < active} class:karaoke={index === active && smooth} data-line={index} aria-current={index === active ? 'true' : undefined} onclick={() => ui.api.player.seek(line.time)}>{#if index === active && smooth}{#each words(line.text) as word}<span class="word">{word.text}</span>{/each}{:else}{line.text}{/if}</button>{/each}</div><p class="credit">{ui.t(lyrics.creditKey)}</p></div>{:else}<EmptyState title={ui.t(failed ? 'lyrics.failed' : 'lyrics.empty')} description={ui.t(failed ? 'lyrics.failedSub' : 'lyrics.emptySub')} icon="lyrics" />{#if failed}<button class="retry text-action" onclick={() => retry++}>{ui.t('state.retry')}</button>{/if}{/if}
{#if !embedded}<Dock nav={!sideNav} />{/if}</section>
<style>
  .plain-text p { font-size: calc(var(--font-size-l) * var(--font-scale)); line-height: var(--line-height-body); color: var(--color-text); padding: 0 calc(var(--space-6) + var(--inset-left)); margin: 0 0 var(--space-1); }
  .plain-text p.gap { margin-bottom: var(--space-3); }
  .lyrics.embedded { position: relative; inset: auto; height: 100%; background: transparent; padding-top: 0; --dock-height: 0px; }
  .lyrics.embedded .lyrics-scroll { scrollbar-width: none; padding-top: 30vh; padding-bottom: 40vh; }
  .lyrics.embedded .lyrics-scroll::-webkit-scrollbar { display: none; }
  .lyrics { position: absolute; inset: 0; display: flex; flex-direction: column; z-index: var(--z-player); background: var(--color-bg); padding-top: var(--inset-top); }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-4) calc(var(--space-3) + var(--inset-right)) var(--space-4) calc(var(--space-3) + var(--inset-left)); border-bottom: var(--border-width) solid var(--color-border); }
  header > div { flex: 1; min-width: 0; text-align: center; }
  h1 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  header p { font-size: calc(var(--font-size-xs) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lyrics-scroll { position: relative; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-6) calc(var(--space-6) + var(--inset-right)) calc(var(--dock-height) + var(--lyrics-scroll-padding)) calc(var(--space-6) + var(--inset-left)); scroll-padding-block: var(--lyrics-scroll-padding); }
  .loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4); padding-bottom: var(--dock-height); color: var(--color-text-muted); }
  .loading-line { width: var(--cover-card); height: var(--space-1); border-radius: var(--radius-full); background: var(--color-surface-3); }
  .retry { margin: 0 auto var(--dock-height); }
  .hint { color: var(--color-text-subtle); font-size: calc(var(--font-size-xs) * var(--font-scale)); margin-bottom: var(--space-8); text-align: start; }
  .lines { display: flex; flex-direction: column; gap: var(--space-5); }
  .lines button { position: relative; min-height: var(--touch-size); font-size: calc(var(--font-size-lyrics) * var(--font-scale)); font-weight: var(--font-weight-bold); line-height: var(--lyrics-line-height); letter-spacing: var(--letter-spacing-heading); text-align: start; color: var(--color-text-subtle); }
  .lines .past { color: var(--color-text-muted); }
  .lines .active { color: var(--color-text); }
  /* The sweep: the left (sung) half of a gradient twice as wide as the word slides in.
     Its soft middle is the moving edge, so each word fills gradually, left to right. */
  .lines .karaoke .word { color: transparent; background: linear-gradient(90deg, var(--color-text) 0 44%, var(--color-text-muted) 56% 100%) 100% 0 / 225% 100% no-repeat; -webkit-background-clip: text; background-clip: text; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .credit { color: var(--color-text-subtle); font-size: calc(var(--font-size-xs) * var(--font-scale)); margin-top: var(--space-8); line-height: var(--line-height-body); }
</style>
