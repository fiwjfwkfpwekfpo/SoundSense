<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { SearchFilters, SearchResults, SourceKind } from '../../core/types';
  import { useModel } from '../context.svelte';
  import TrackRow from '../components/TrackRow.svelte';
  import PlaylistCard from '../components/PlaylistCard.svelte';
  import Cover from '../components/Cover.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  import Select from '../components/Select.svelte';
  import YandexAccount from '../components/YandexAccount.svelte';
  const ui = useModel();
  let input: HTMLInputElement;
  let query = $state(ui.nav.searchQuery);
  $effect(() => { ui.nav.searchQuery = query; });
  let hasQuery = $derived(query.trim().length > 0); let source = $state<SourceKind | 'all'>('all'); let type = $state<SearchFilters['type']>('tracks');
  let recent = $state<readonly string[]>(ui.api.search.getRecent());
  let results = $state.raw<SearchResults>({ tracks: [], artists: [], playlists: [] });
  let loading = $state(false); let delayed = $state(false); let failed = $state(false); let retry = $state(0);
  $effect(() => { if (!loading || results[type].length) { delayed = false; return; } const timer = setTimeout(() => delayed = true, 150); return () => clearTimeout(timer); });
  $effect(() => {
    void retry; failed = false;
    if (!query.trim()) { results = { tracks: [], artists: [], playlists: [] }; loading = false; return; }
    const controller = new AbortController(); loading = true; results = { tracks: [], artists: [], playlists: [] };
    const delay = setTimeout(() => { void ui.api.search.search(query, { source, type }, controller.signal, value => { if (!controller.signal.aborted) results = value; }).then(value => {
      if (!controller.signal.aborted) { results = value; loading = false; }
    }).catch(() => { if (!controller.signal.aborted) { loading = false; failed = true; } }); }, 220);
    return () => { clearTimeout(delay); controller.abort(); };
  });
  onMount(async () => { if (ui.nav.searchFocus) { await tick(); input.focus(); ui.nav.searchFocus = false; } });
  function remember() { ui.api.search.remember(query); recent = ui.api.search.getRecent(); }
  function selectRecent(value: string) { query = value; remember(); input.focus(); }
</script>
<section class="screen" aria-label={ui.t('nav.search')}>
  <header class="screen-header"><h1 class="screen-title">{ui.t('nav.search')}</h1></header>
  <form onsubmit={event => { event.preventDefault(); remember(); input.blur(); }}><label class="search-field"><Icon name="search" /><input bind:this={input} bind:value={query} placeholder={ui.t('search.placeholder')} aria-label={ui.t('search.placeholder')} autocomplete="off" enterkeyhint="search" />{#if query}<button type="button" class="icon-button clear" aria-label={ui.t('search.clearQuery')} onclick={() => { query = ''; input.focus(); }}><Icon name="close" size="s" /></button>{/if}</label></form>
  <div class="sources"><span>{ui.t('search.service')}</span><Select label={ui.t('search.service')} value={source} options={['all', ...ui.api.extensions.sources.list().map(provider => provider.id)].map(value => ({ value, label: ui.t(`source.${value}`) }))} onchange={value => source = value} /></div>
  <div class="type-tabs" role="tablist" aria-label={ui.t('search.results')}>{#each ['tracks', 'artists', 'playlists'] as kind}<button role="tab" aria-selected={type === kind} class:active={type === kind} onclick={() => type = kind as SearchFilters['type']}>{ui.t(`search.${kind}`)}</button>{/each}</div>
  {#if !hasQuery && recent.length}<section class="recent"><div class="recent-heading"><h2>{ui.t('search.recent')}</h2><button class="icon-button" aria-label={ui.t('search.clear')} onclick={() => { ui.api.search.clearRecent(); recent = []; }}><Icon name="close" size="s" /></button></div>{#each recent as value}<button class="recent-row" onclick={() => selectRecent(value)}><Icon name="clock" size="s" /><span>{value}</span><Icon name="arrow-up-right" size="s" /></button>{/each}</section>{/if}
  {#if ui.pendingMatch}<p class="match-hint">{ui.t('import.matchHint')}</p><button class="text-action" onclick={() => { ui.pendingMatch = null; ui.nav.go({ name: 'import' }); }}>{ui.t('import.returnResult')}</button>{/if}
  {#if hasQuery}
  <div class="result-heading" aria-live="polite"><span class="eyebrow">{ui.t(loading ? 'search.loading' : 'search.results')}</span><span>{type === 'tracks' ? results.tracks.length : type === 'artists' ? results.artists.length : results.playlists.length}</span></div>
  {#if delayed}<div class="loading-rows" aria-busy="true" aria-label={ui.t('state.loading')}>{#each Array(6) as _}<div><i></i><span></span></div>{/each}</div>{:else if failed}<EmptyState title={ui.t('state.error')} description={ui.t('state.errorHint')} />{#if source === 'ya' && ui.api.account}<YandexAccount onconnected={() => { retry++; }} />{/if}<button class="text-action" onclick={() => retry++}>{ui.t('state.retry')}</button>{:else if type === 'tracks' && results.tracks.length}{#each results.tracks as track, index}{@const current = ui.library && ui.api.library.getTrack(track.id) || track}<TrackRow track={current} active={ui.player?.trackId === track.id} onplay={() => { remember(); ui.play(results.tracks.map(t => t.id), index); }} />{#if ui.pendingMatch}<button class="text-action" onclick={() => { if (ui.pendingMatch) ui.api.imports.resolve(ui.pendingMatch.index, track.id, ui.pendingMatch.kind); ui.pendingMatch = null; ui.nav.go({ name: 'import' }); }}>{ui.t('import.useMatch')}</button>{/if}{/each}
  {:else if type === 'artists' && results.artists.length}<div class="artists">{#each results.artists as artist}<button class="artist" aria-label={ui.t('search.openArtist', { name: artist.name })} onclick={() => { remember(); ui.nav.go({ name: 'artist', id: artist.id }); }}><span><Cover artwork={artist.artwork} round /></span><strong>{artist.name}</strong><small>{ui.t('common.artist')}</small></button>{/each}</div>
  {:else if type === 'playlists' && results.playlists.length}<div class="playlists">{#each results.playlists as playlist}<PlaylistCard {playlist} />{/each}</div>
  {:else if !loading}<EmptyState title={ui.t('search.empty')} description={ui.t('search.emptySub')} icon="search" />{/if}
  {/if}
</section>
<style>
  .loading-rows > div { display: flex; gap: var(--space-3); align-items: center; height: var(--track-height); }
  .loading-rows i { width: var(--cover-row); height: var(--cover-row); background: var(--color-surface-2); border-radius: var(--radius-s); }
  .loading-rows span { height: var(--space-4); width: 65%; background: var(--color-surface-2); border-radius: var(--radius-s); }
  .match-hint { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .search-field { padding-right: var(--space-1); }
  .clear { color: var(--color-text-muted); }
  .sources { margin: var(--space-4) 0 var(--space-3); padding: 0 var(--space-3); display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-1); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .sources > span { color: var(--color-text-muted); }
  .type-tabs { display: flex; gap: var(--space-5); border-bottom: var(--border-width) solid var(--color-border); margin-bottom: var(--space-5); }
  .type-tabs button { min-height: var(--touch-size); font-size: calc(var(--font-size-sm) * var(--font-scale)); color: var(--color-text-muted); border-bottom: var(--focus-width) solid var(--color-clear); }
  .type-tabs .active { color: var(--color-text); border-color: var(--color-text); }
  .recent { margin-bottom: var(--space-6); }
  .recent-heading { display: flex; align-items: center; justify-content: space-between; }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); }
  .recent-row { display: flex; align-items: center; width: 100%; gap: var(--space-3); min-height: var(--touch-size); color: var(--color-text-muted); font-size: calc(var(--font-size-m) * var(--font-scale)); }
  .recent-row span { flex: 1; text-align: start; color: var(--color-text); }
  .result-heading { display: flex; justify-content: space-between; align-items: center; margin: var(--space-4) 0 var(--space-3); color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .artists, .playlists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6) var(--space-4); }
  .artist { display: flex; align-items: center; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .artist > span { display: block; width: var(--cover-card); height: var(--cover-card); border-radius: var(--radius-full); margin-bottom: var(--space-2); }
  .artist strong { font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .artist small { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .playlists :global(button), .playlists :global(.art) { width: 100%; }
  .playlists :global(.art) { height: auto; aspect-ratio: 1; }
</style>
