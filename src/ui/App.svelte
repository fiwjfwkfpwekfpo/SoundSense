<script module lang="ts">
  import { DEBUG_TOOLS } from '../core/build';
  const Diagnostics = DEBUG_TOOLS ? (await import('../debug/Diagnostics.svelte')).default : undefined;
  const TraceHud = DEBUG_TOOLS ? (await import('../debug/TraceHud.svelte')).default : undefined;
</script>
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Component } from 'svelte';
  import type { AppApi } from '../core/api';
  import { UiModel, provideModel } from './context.svelte';
  import { applyAppearance } from './appearance/loader';
  import { extractArtwork } from './appearance/artwork';
  import { loadArtwork } from '../platform/artwork';
  import { motionTransition } from './appearance/motion/runtime';
  import Import from './screens/Import.svelte';
  import Onboarding from './screens/Onboarding.svelte';
  import PaletteSpread from './components/PaletteSpread.svelte';
  import ScreenState from './components/ScreenState.svelte';
  import Home from './screens/Home.svelte';
  import Playlist from './screens/Playlist.svelte';
  import Search from './screens/Search.svelte';
  import Library from './screens/Library.svelte';
  import Settings from './screens/Settings.svelte';
  import Updates from './screens/Updates.svelte';
  import Plugins from './screens/Plugins.svelte';
  import PluginScreen from './screens/PluginScreen.svelte';
  import { BETA_FEATURES } from '../core/build';
  import Collection from './screens/Collection.svelte';
  import Player from './screens/Player.svelte';
  import Queue from './screens/Queue.svelte';
  import Lyrics from './screens/Lyrics.svelte';
  import Dock from './components/Dock.svelte';
  import SideNav from './components/SideNav.svelte';
  import { isDesktop } from '../platform/desktop';
  import { layout } from './layout.svelte';
  import ActionSheets from './components/ActionSheets.svelte';
  let { api }: { api: AppApi } = $props();
  const ui = new UiModel(untrack(() => api)); provideModel(ui);
  let scrollElement = $state<HTMLElement>();
  let dismissedUpdate = $state(0);
  const screens: Record<string, Component<any>> = { home: Home, liked: Playlist, playlist: Playlist, search: Search, settings: Settings, updates: Updates, ...(BETA_FEATURES ? { plugins: Plugins, plugin: PluginScreen } : {}), ...(DEBUG_TOOLS && Diagnostics ? { diagnostics: Diagnostics } : {}), library: Library, artist: Collection, album: Collection, collection: Collection, import: Import };
  let onboarding = $derived(!ui.settings.values.onboardingDone);
  let route = $derived(ui.nav.state.route);
  // Desktop: tabs on the left (default) or at the bottom, as chosen in Settings → Appearance.
  let sideNav = $derived(isDesktop() && ui.settings.values.navPosition !== 'bottom');
  // Wide desktop window: player bar under the content and a two-column full-screen player.
  let wide = $derived(layout.wide);
  // In the wide layout the lyrics live in the right column of the player: open that instead.
  $effect(() => { if (wide && ui.nav.overlay === 'lyrics') untrack(() => { ui.nav.back(); if (ui.nav.overlay !== 'player') ui.nav.open('player'); }); });
  let playbackActive = $derived(!!ui.player?.playing);
  let overlapActive = $derived(!!ui.player?.crossfade);
  let sheetOpen = $derived(!!ui.nav.state.sheet);
  $effect(() => {
    const power = ui.api.playbackPower;
    if (!power || onboarding || !playbackActive || ui.settings.values.backgroundPromptSeen || sheetOpen || overlapActive) return;
    const timer = setTimeout(() => {
      void power.getStatus().then(state => {
        if (ui.settings.values.backgroundPromptSeen || !ui.player?.playing || ui.nav.state.sheet) return;
        ui.settings.set('backgroundPromptSeen', true);
        if (!state.unrestricted) ui.nav.sheet({ kind: 'playbackPower' });
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  });
  // Offer a new version once per version per day, without interrupting a sheet or an import.
  $effect(() => {
    const release = ui.updateState, manifest = release?.manifest;
    if (onboarding || release?.phase !== 'available' || !manifest || sheetOpen || ui.importJob && !['done', 'cancelled'].includes(ui.importJob.phase)) return;
    let prompted: { code?: number; at?: number } = {};
    try { prompted = JSON.parse(localStorage.getItem('ss_update_prompted') ?? '{}') ?? {}; } catch {}
    if (prompted.code === manifest.versionCode && Date.now() - (prompted.at ?? 0) < 24 * 60 * 60_000) return;
    const timer = setTimeout(() => {
      if (ui.nav.state.sheet) return;
      try { localStorage.setItem('ss_update_prompted', JSON.stringify({ code: manifest.versionCode, at: Date.now() })); } catch {}
      ui.nav.sheet({ kind: 'update' });
    }, 1200);
    return () => clearTimeout(timer);
  });
  $effect(() => { ui.scrollElement = scrollElement; ui.nav.scrollElement = scrollElement; });
  $effect(() => { void route; const top = untrack(() => ui.nav.scroll); void tick().then(() => { if (scrollElement) scrollElement.scrollTop = top; }); });
  let reducedMotion = $state(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let overlapDuration = $derived((ui.player?.crossfade?.duration ?? 0) * 1000);
  let artwork = $derived(ui.track?.artwork);
  let average = $state<{ key: string; color: string }>();
  const averages = new Map<string, string>();
  $effect(() => {
    const values = { ...ui.settings.values }; const currentArtwork = artwork;
    const key = currentArtwork ? `${currentArtwork.seed}-${currentArtwork.variant}-${currentArtwork.url ?? ''}` : '';
    const sampled = average?.key === key ? average.color : averages.get(key);
    const paletteDuration = overlapDuration || undefined;
    const reduced = reducedMotion; const locale = ui.locale;
    const changed = untrack(() => {
      const appearance = ui.appearanceLoader.resolve(values, reduced, currentArtwork, sampled);
      const previous = ui.appearance.colors;
      if (JSON.stringify(previous.palette) !== JSON.stringify(appearance.colors.palette)) ui.colorTransition = {
        id: (ui.colorTransition?.id ?? 0) + 1, from: previous,
        transitionId: ui.player?.transition?.id,
        duration: appearance.groups.general.duration ? paletteDuration ?? appearance.groups.general.duration : 0,
      };
      ui.appearance = appearance;
      const changed = applyAppearance(appearance, Number(values.fontSize) / 100);
      document.documentElement.dataset.artworkSampled = sampled ? 'true' : 'false';
      document.documentElement.lang = locale;
      return changed;
    });
    if (!changed) return;
    // Canvas consumers refresh at the end of an interpolated color change too.
    const timer = setTimeout(() => window.dispatchEvent(new Event('app:theme')), (paletteDuration ?? untrack(() => ui.appearance.groups.general.duration)) + 24);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const current = artwork; const dynamic = ui.appearance.selection.colors.id === 'cover';
    if (!current || !dynamic) return;
    const key = `${current.seed}-${current.variant}-${current.url ?? ''}`;
    if (averages.has(key)) { if (average?.key !== key) average = { key, color: averages.get(key)! }; return; }
    let cancelled = false;
    void tick().then(async () => {
      const nodes = [...document.querySelectorAll<SVGSVGElement>('.backdrop .cover svg, [data-testid="mini-player"] .cover svg')];
      const svg = nodes.filter(node => node.closest<HTMLElement>('.cover')?.dataset.artworkKey === key).at(-1); if (!svg && !current.url) return;
      try { const color = await extractArtwork(current.url ? (await loadArtwork(current.url)).image : svg!, current); if (!cancelled) { averages.set(key, color); if (averages.size > 64) averages.delete(averages.keys().next().value!); average = { key, color }; } }
      catch { /* Deterministic gradient samples remain available without canvas. */ }
    });
    return () => { cancelled = true; };
  });
  let overlapping = $derived(!!ui.player?.crossfade);
  let nextArtwork = $derived(ui.api.library.getTrack(ui.player?.queue[(ui.player?.currentIndex ?? -1) + 1]?.trackId ?? '')?.artwork);
  $effect(() => {
    const next = nextArtwork;
    if (overlapping || ui.appearance.selection.colors.id !== 'cover' || !next?.url) return;
    const key = `${next.seed}-${next.variant}-${next.url}`; if (averages.has(key)) return;
    let cancelled = false;
    void loadArtwork(next.url).then(result => extractArtwork(result.image, next)).then(color => { if (!cancelled) { averages.set(key, color); if (averages.size > 64) averages.delete(averages.keys().next().value!); } }).catch(() => {});
    return () => { cancelled = true; };
  });
  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { reducedMotion = query.matches; };
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  });
  onMount(() => {
    if (!window.history.state?.appNavigation) window.history.pushState({ appNavigation: true }, '');
    const pop = () => { if (ui.nav.back()) window.history.pushState({ appNavigation: true }, ''); };
    const link = (event: Event) => { void ui.openLink((event as CustomEvent<string>).detail); };
    window.addEventListener('app:link', link);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && ui.nav.canBack) { event.preventDefault(); ui.nav.back(); } };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('app:link', link); window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); ui.dispose(); };
  });
  // Capacitor is wired in the composition root; UI sees only a normal back request.
  onMount(() => {
    const back = () => { if (ui.nav.canBack) ui.nav.back(); else window.dispatchEvent(new Event('app:root-back')); };
    window.addEventListener('app:back', back);
    return () => window.removeEventListener('app:back', back);
  });
  onMount(() => { const failed = () => ui.notify('settings.storageUnavailable'); window.addEventListener('app:storage-error', failed); return () => window.removeEventListener('app:storage-error', failed); });
</script>
<div class="stage"><div class="device" class:nav-left={sideNav && !onboarding} class:wide={wide && !onboarding} data-testid="app-shell">
  <PaletteSpread />
  <main bind:this={scrollElement} class="main-scroll" inert={onboarding || !!ui.nav.overlay || !!ui.nav.state.sheet} aria-hidden={onboarding || !!ui.nav.overlay || !!ui.nav.state.sheet ? 'true' : undefined}>
    <ScreenState>{#key `${route.name}-${'id' in route ? route.id : route.name === 'library' ? route.tab : route.name === 'import' ? `${route.source ?? ''}:${route.link ?? ''}:${route.destination ?? ''}` : ''}`}
      {@const descriptor = ui.contributions('screens').find(item => item.route === route.name)}
      {@const Screen = descriptor ? screens[descriptor.component] : undefined}
    <div class="route-content" data-route data-route-kind={ui.nav.transitionKind} style:--route-x={ui.nav.origin.x} style:--route-y={ui.nav.origin.y} data-motion-group="general" in:motionTransition={{ group: 'general', effect: 'fade', duration: 140 }}>
      {#if Screen}<Screen {...(route.name === 'liked' ? { id: 'liked' } : route.name === 'artist' ? { id: route.id, artist: true } : route.name === 'album' ? { id: route.id, album: true } : route)} />{/if}
    </div>{/key}</ScreenState>
  </main>
  <div class="overlay-host" inert={!!ui.nav.state.sheet} aria-hidden={ui.nav.state.sheet ? 'true' : undefined}>{#if ui.nav.overlay === 'player'}<Player />{:else if ui.nav.overlay === 'queue'}<Queue />{:else if ui.nav.overlay === 'lyrics'}<Lyrics />{/if}</div>
  <!-- Kept mounted under the full-screen player: collapsing it no longer rebuilds the mini player and navigation. -->
  {#if !onboarding}<div class="dock-host" class:covered={!!ui.nav.overlay} inert={!!ui.nav.overlay} aria-hidden={ui.nav.overlay ? 'true' : undefined}>{#if sideNav}<SideNav />{/if}<Dock nav={!sideNav} bar={wide} /></div>{/if}
  {#if ui.importJob && !['done', 'cancelled'].includes(ui.importJob.phase) && route.name !== 'import'}<button class="import-banner" onclick={() => ui.nav.go({ name: 'import' })} data-testid="import-banner"><span>{ui.t('import.title')} · {ui.t(`import.phase.${ui.importJob.phase}`)}</span><span>{ui.importJob.completed} / {ui.importJob.total}</span></button>{/if}
  {#if !onboarding && !ui.nav.overlay && route.name !== 'updates' && ui.updateState?.phase === 'available' && ui.updateState.manifest && dismissedUpdate !== ui.updateState.manifest.versionCode && (!ui.importJob || ['done','cancelled'].includes(ui.importJob.phase))}
    <div class="update-banner" role="status"><button onclick={() => ui.nav.go({ name: 'updates' })}>{ui.t('update.availablePrompt', { version: ui.updateState.manifest.version })}</button><button aria-label={ui.t('update.dismiss')} onclick={() => dismissedUpdate = ui.updateState?.manifest?.versionCode ?? 0}>×</button></div>
  {/if}
  {#if DEBUG_TOOLS && ui.profiler?.recording}<div class="rec-pill" data-profiler role="status"><span class="rec-dot"></span><span>{ui.t('profile.recording', { actions: ui.profiler.actions })}</span><button onclick={() => { const summary = ui.profiler?.stop(); if (summary) ui.notify('profile.saved', { p95: summary.p95, janky: summary.janky }, () => ui.nav.go({ name: 'diagnostics' })); }}>{ui.t('profile.stop')}</button></div>{/if}
  {#if TraceHud && ui.trace?.hud && (ui.trace.clock || ui.trace.beat)}<TraceHud />{/if}
  <ActionSheets />
  {#if !ui.settings.values.onboardingDone}<Onboarding />{/if}
  {#if ui.toast}<div class="toast" role="status">{ui.toast}{#if ui.toastAction}<button onclick={() => ui.toastAction?.()}>{ui.t('import.openResult')}</button>{/if}</div>{/if}
</div></div>
<style>
  .stage { height: 100%; width: 100%; display: flex; justify-content: center; align-items: center; background: var(--color-stage); }
  .device { position: relative; width: 100%; height: 100dvh; background: var(--color-bg); overflow: hidden; isolation: isolate; box-shadow: var(--shadow-shell); }
  .main-scroll[aria-hidden="true"] { content-visibility: hidden; }
  .main-scroll { position: absolute; z-index: var(--z-content); inset: var(--inset-top) var(--inset-right) 0 var(--inset-left); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
  .main-scroll::-webkit-scrollbar { display: none; }
  .dock-host.covered { visibility: hidden; }
  .device { --side-nav-width: 0px; }
  .device.nav-left { --side-nav-width: 216px; }
  .device.nav-left .main-scroll { left: calc(var(--side-nav-width) + var(--inset-left)); }
  @media (max-width: 760px) { .device.nav-left { --side-nav-width: calc(var(--touch-size) + var(--space-4)); } }
  /* The bar sits under the content, next to the menu, which then runs the full height. */
  .device.nav-left.wide { --dock-left: var(--side-nav-width); --side-nav-bottom: 0px; }
  .overlay-host { position: absolute; inset: 0; z-index: var(--z-player); pointer-events: none; }
  .overlay-host > :global(*) { pointer-events: auto; }
  .import-banner { position: absolute; z-index: var(--z-dock); bottom: var(--dock-height); left: calc(var(--side-nav-width) + var(--space-5)); right: var(--space-5); display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-3); background: var(--color-surface-2); border-radius: var(--radius-m); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .update-banner { position: absolute; z-index: var(--z-dock); bottom: calc(var(--dock-height) + var(--space-3)); left: calc(var(--side-nav-width) + var(--space-5)); right: var(--space-5); display: flex; gap: var(--space-2); padding: var(--space-2); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); box-shadow: var(--shadow-nav); }
  .update-banner button { min-height: var(--touch-size); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .update-banner button:first-child { flex: 1; text-align: start; padding: 0 var(--space-2); }
  .update-banner button:last-child { min-width: var(--touch-size); color: var(--color-text-muted); }
  .rec-pill { position: absolute; z-index: var(--z-toast); top: calc(var(--inset-top) + var(--space-2)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-full); box-shadow: var(--shadow-nav); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .rec-dot { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); background: var(--color-danger); animation: rec 1.2s steps(2) infinite; }
  @keyframes rec { 50% { opacity: .2; } }
  .rec-pill button { min-height: calc(var(--touch-size) - var(--space-3)); padding: 0 var(--space-3); border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); font-weight: var(--font-weight-semibold); }
  .toast button { display: block; margin: auto; text-decoration: underline; pointer-events: auto; }
  .toast { position: absolute; z-index: var(--z-toast); left: calc(var(--side-nav-width) + var(--space-6) + var(--inset-left)); right: calc(var(--space-6) + var(--inset-right)); bottom: var(--dock-height); padding: var(--space-3) var(--space-4); background: var(--color-accent); color: var(--color-on-accent); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); border-radius: var(--radius-m); text-align: center; box-shadow: var(--shadow-nav); pointer-events: none;  }
  @media (min-width: 600px) { :global(html[data-runtime='web'][data-preview='true']) .device { max-width: var(--shell-width); max-height: var(--shell-height); border-radius: var(--radius-xl); border: var(--border-width) solid var(--color-border); } }
</style>
