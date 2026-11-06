<script lang="ts">
  import { flyToMini } from '../appearance/motion/runtime';
  import type { TrackSort } from '../../core/types';
  import { useModel } from '../context.svelte';
  import Cover from '../components/Cover.svelte';
  import TrackRow from '../components/TrackRow.svelte';
  import Button from '../components/Button.svelte';
  import Select from '../components/Select.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let { id }: { id: string } = $props();
  const view = ui.nav.view;
  let query = $state(String(view.query ?? '')); let sort = $state<TrackSort>((view.sort as TrackSort) ?? 'added');
  $effect(() => { view.query = query; view.sort = sort; });
  let playlist = $derived(ui.library?.playlists.find(p => p.id === id));
  let tracks = $derived.by(() => { void ui.library; return ui.api.library.getPlaylistTracks(id, query, sort); });
  function listen(shuffle = false) {
    const ids = tracks.map(t => t.id);
    if (shuffle) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
    ui.play(ids); if (shuffle) ui.api.player.setShuffle(true);
  }
</script>
<section class="screen playlist" aria-label={playlist ? ui.playlistTitle(playlist) : ui.t('nav.liked')}>
  <header class="toolbar"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><span class="eyebrow">{ui.t('home.collection')}</span><button class="icon-button" aria-label={ui.t('playlist.menu')} onclick={() => ui.nav.sheet({ kind: 'playlistMenu', playlistId: id })}><Icon name="more-vertical" size="s" /></button></header>
  {#if playlist}<div class="playlist-hero"><span class="cover"><Cover artwork={playlist.artwork} heart={playlist.kind === 'liked'} /></span><div class="heading"><h1>{ui.playlistTitle(playlist)}</h1><p>{ui.count(playlist.trackIds.length)}</p>{#if playlist.descriptionKey}<span>{ui.t(playlist.descriptionKey)}</span>{/if}</div></div>{/if}
  <div class="actions"><Button wide onclick={event => { listen(); flyToMini(event.currentTarget as HTMLElement); }} disabled={!tracks.length}><Icon name="play" size="s" />{ui.t('playlist.listen')}</Button><button class="shuffle icon-button surface" aria-label={ui.t('playlist.shuffle')} disabled={!tracks.length} onclick={() => listen(true)}><Icon name="shuffle" /></button></div>
  <div class="filters"><label class="search-field"><Icon name="search" size="s" /><input bind:value={query} placeholder={ui.t('playlist.search')} aria-label={ui.t('playlist.search')} /></label><Select compact icon="sort" label={ui.t('playlist.sort')} value={sort} options={['added', 'title', 'artist', 'duration'].map(value => ({ value, label: ui.t(`sort.${value}`) }))} onchange={value => sort = value as TrackSort} /></div>
  {#if query}<p class="result-count">{ui.t('playlist.filtered', { count: tracks.length })}</p>{/if}
  {#if tracks.length}<VirtualList items={tracks} itemKey={t => t.id}>{#snippet children(track, index)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(tracks.map(t => t.id), index)} />{/snippet}</VirtualList>{:else}<EmptyState title={ui.t(query ? 'playlist.noResults' : 'playlist.empty')} description={ui.t(query ? 'playlist.noResultsSub' : 'playlist.emptySub')} icon="heart" />{#if !query}<Button wide onclick={() => ui.nav.go({ name: 'search' }, true)}>{ui.t('playlist.addTracks')}</Button>{/if}{/if}
</section>
<style>
  .playlist { padding-top: var(--space-4); }
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin: 0 calc(-1 * var(--space-3)) var(--space-5); }
  .playlist-hero { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-5); }
  .cover { width: var(--cover-playlist); height: var(--cover-playlist); border-radius: var(--radius-l); flex-shrink: 0; }
  .heading { min-width: 0; }
  h1 { font-size: calc(var(--font-size-2xl) * var(--font-scale)); line-height: var(--line-height-tight); letter-spacing: var(--letter-spacing-tight); }
  .heading p { font-size: calc(var(--font-size-m) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-2); }
  .heading > span { display: block; margin-top: var(--space-2); font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); }
  .actions { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
  .shuffle { min-width: calc(var(--touch-size) + var(--space-5)); }
  .filters { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-3); }
  .filters .search-field { min-height: var(--touch-size); background: var(--color-surface-1); }
  .result-count { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); margin: var(--space-3) 0; }
</style>
