<script lang="ts">
  import { useModel } from '../context.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Button from '../components/Button.svelte';
  import Cover from '../components/Cover.svelte';
  import PlaylistCard from '../components/PlaylistCard.svelte';
  import Charts from '../components/Charts.svelte';
  import ForYou from '../components/ForYou.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let resume = $derived(ui.track);
</script>
<section class="screen home" aria-label={ui.t('nav.home')}>
  <header class="screen-header"><div><p class="eyebrow"><img src="/SoundSense.png" alt="" />{ui.t('app.name')}</p><h1 class="screen-title">{ui.t('nav.home')}</h1></div><button class="icon-button" aria-label={ui.t('nav.library')} onclick={() => ui.nav.go({ name: 'library' })}><Icon name="library" /></button></header>
  <button class="search-field search-link" onclick={() => ui.nav.go({ name: 'search' }, true)}><Icon name="search" /><span>{ui.t('home.search')}</span></button>
  {#if !(ui.library?.playlists.some(playlist => playlist.trackIds.length)) && !ui.library?.history.length}<EmptyState title={ui.t('home.startTitle')} description={ui.t('home.startSubtitle')} /><Button wide onclick={() => ui.nav.go({ name: 'import', source: 'local' })}>{ui.t('import.title')}</Button>{/if}
  {#if ui.settings.values.recommendations !== false && (ui.api.recommendations || ui.library?.recommendations.length)}<ForYou />{/if}
  {#if ui.api.charts && ui.settings.values.charts !== false && ['chartYa', 'chartSpotify', 'chartSc'].some(key => ui.settings.values[key] !== false)}<Charts />{/if}
  <section class="home-section">
    {#if resume}<button class="section-heading" onclick={() => ui.nav.go({ name: 'library', tab: 'history' })}><h2>{ui.t('home.continue')}</h2><Icon name="chevron-right" size="s" /></button>{/if}
    {#if resume}<div class="resume-card"><button class="resume-main" aria-label={ui.t('player.open')} onclick={() => ui.api.player.resume()}><span class="resume-art"><Cover artwork={resume.artwork} /></span><span class="resume-text"><strong>{resume.title}</strong><span>{resume.artist.name}</span><span class="resume-progress"><i style:width={`${ui.position / resume.duration * 100}%`}></i></span></span></button><button class="icon-button surface" aria-label={ui.t(ui.player?.playing ? 'player.pause' : 'player.play')} onclick={() => ui.api.player.toggle()}><Icon name={ui.player?.playing ? 'pause' : 'play'} size="s" /></button></div>{/if}
  </section>
  <section class="home-section">
    <button class="section-heading" onclick={() => ui.nav.go({ name: 'library', tab: 'playlists' })}><h2>{ui.t('home.playlists')}</h2><Icon name="chevron-right" size="s" /></button>
    <div class="playlist-strip">{#each ui.library?.playlists ?? [] as playlist (playlist.id)}<PlaylistCard {playlist} />{/each}</div>
  </section>
</section>
<style>
  .eyebrow { margin-bottom: var(--space-1); display: flex; align-items: center; gap: var(--space-2); }
  .eyebrow img { width: var(--space-6); height: var(--space-6); border-radius: var(--radius-s); }
  .screen-header { margin-bottom: var(--space-5); }
  .search-link { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); text-align: start; }
  .home-section { margin-top: var(--space-5); }
  .resume-card { display: flex; align-items: center; padding: var(--space-2); padding-right: var(--space-3); background: var(--color-surface-1); border-radius: var(--radius-m); gap: var(--space-3); }
  .resume-main { display: flex; flex: 1; min-width: 0; gap: var(--space-3); text-align: start; }
  .resume-art { width: var(--cover-row); height: var(--cover-row); flex-shrink: 0; border-radius: var(--radius-s); }
  .resume-text { display: flex; flex-direction: column; justify-content: center; gap: var(--space-1); min-width: 0; flex: 1; }
  .resume-text strong { font-size: calc(var(--font-size-sm) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .resume-text > span { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); }
  .resume-progress { width: 100%; height: var(--progress-height); background: var(--color-surface-3); border-radius: var(--radius-full); margin-top: var(--space-1); overflow: hidden; }
  .resume-progress i { display: block; height: 100%; background: var(--color-text); border-radius: inherit; }
  .playlist-strip { display: flex; gap: var(--space-3); overflow: auto; margin: 0 calc(-1 * var(--space-6)); padding: 0 var(--space-6) var(--space-1); scrollbar-width: none; }
  .playlist-strip::-webkit-scrollbar { display: none; }
</style>
