<script lang="ts">
  import { useModel } from '../context.svelte';
  import Button from '../components/Button.svelte';
  import PlaylistCard from '../components/PlaylistCard.svelte';
  import TrackRow from '../components/TrackRow.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  import Cover from '../components/Cover.svelte';
  import AlbumCard from '../components/AlbumCard.svelte';
  import { albums, artists, isLocal } from '../library-groups';
  const ui = useModel();
  let { tab }: { tab?: 'playlists' | 'history' | 'downloaded' | 'local' } = $props();
  let selected = $derived(tab);
  let playlists = $derived((ui.library?.playlists ?? []).filter(playlist => playlist.kind !== 'liked'));
  let liked = $derived((ui.library?.tracks ?? []).filter(track => track.liked));
  let offline = $derived((ui.library?.tracks ?? []).filter(track => track.downloaded || track.sources.some(source => source.kind === 'local')));
  // Local music, Poweramp-style: albums and artists built from the tags.
  let localTracks = $derived((ui.library?.tracks ?? []).filter(isLocal));
  let localView = $state<'albums' | 'artists' | 'tracks'>((ui.nav.view.localView as 'albums' | 'artists' | 'tracks') ?? 'albums');
  $effect(() => { ui.nav.view.localView = localView; });
  let localAlbums = $derived(selected === 'local' ? albums(localTracks) : []), localArtists = $derived(selected === 'local' ? artists(localTracks) : []);
  let tracks = $derived(selected === 'playlists' ? [] : selected === 'history' ? (ui.library?.history ?? []).flatMap(id => { const t = ui.api.library.getTrack(id); return t ? [t] : []; }) :
    (ui.library?.tracks ?? []).filter(t => selected === 'downloaded' ? t.downloaded || t.sources.some(s => s.kind === 'local') : t.sources.some(s => s.kind === 'local')));
</script>
<section class="screen" aria-label={ui.t('nav.library')}>
  <header class="screen-header">{#if selected}<button class="icon-button back" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button>{/if}<h1 class="screen-title">{ui.t(selected ? `library.${selected}` : 'nav.library')}</h1><button class="icon-button" aria-label={ui.t('import.title')} onclick={() => ui.nav.go({ name: 'import' })}><Icon name="plus" /></button></header>
  {#if !selected}
    <p class="subtitle">{ui.t('library.overviewHint')}</p>
    <button class="liked-card" data-testid="library-liked" onclick={() => ui.nav.go({ name: 'liked' })}>
      <span class="liked-art">{#if liked[0]}<Cover artwork={liked[0].artwork} />{:else}<Icon name="heart" size="l" />{/if}<span class="heart-badge"><Icon name="heart" size="s" filled /></span></span>
      <span class="card-copy"><strong>{ui.t('nav.liked')}</strong><span>{ui.count(liked.length)}</span><small>{ui.t('library.likesHint')}</small></span><Icon name="chevron-right" size="s" />
    </button>
    <div class="sections">
      {#each [{ id: 'playlists', icon: 'folder', count: playlists.length }, { id: 'history', icon: 'clock', count: ui.library?.history.length ?? 0 }, ...(localTracks.length ? [{ id: 'local', icon: 'folder', count: localTracks.length }] : []), { id: 'downloaded', icon: 'download', count: offline.length }] as section}
        <button class="section-card" data-testid={`library-${section.id}`} onclick={() => ui.nav.go({ name: 'library', tab: section.id as 'playlists' | 'history' | 'downloaded' | 'local' })}><span class="section-icon"><Icon name={section.icon as 'folder' | 'clock' | 'download'} size="l" /></span><strong>{ui.t(`library.${section.id}`)}</strong><span>{section.id === 'playlists' ? ui.t('library.playlistCount', { count: section.count }) : ui.count(section.count)}</span></button>
      {/each}
    </div>
    {#if playlists.length}<button class="section-heading recent" onclick={() => ui.nav.go({ name: 'library', tab: 'playlists' })}><h2>{ui.t('library.yourPlaylists')}</h2><Icon name="chevron-right" size="s" /></button><div class="grid">{#each playlists.slice(0, 4) as playlist}<PlaylistCard {playlist} />{/each}</div>{/if}
  {:else}
  <p class="subtitle">{ui.t('library.subtitle')}</p>
  {#if selected === 'downloaded' && ui.offlineState?.entries.some(entry => entry.state !== 'complete')}<p class="cache-hint">{ui.t('offline.pending', { count: ui.offlineState.entries.filter(entry => entry.state !== 'complete').length })}</p>{/if}
  {#if selected === 'local' && localTracks.length}
    <div class="segments" role="tablist">{#each ['albums', 'artists', 'tracks'] as view}<button role="tab" aria-selected={localView === view} class:active={localView === view} onclick={() => localView = view as typeof localView}>{ui.t(`library.${view}`)}</button>{/each}</div>
    {#if localView === 'albums'}{#if localAlbums.length}<div class="album-grid">{#each localAlbums as album (album.id)}<AlbumCard {album} />{/each}</div>{:else}<p class="cache-hint">{ui.t('library.noAlbums')}</p>{/if}
    {:else if localView === 'artists'}<div class="artist-list">{#each localArtists as item (item.artist.id)}<button class="artist-row" onclick={() => ui.nav.go({ name: 'artist', id: item.artist.id })}><span class="artist-art"><Cover artwork={item.artist.artwork} round /></span><span class="card-copy"><strong>{item.artist.name}</strong><span>{ui.count(item.tracks)}{item.albums ? ` · ${ui.t('library.albumCount', { count: item.albums })}` : ''}</span></span><Icon name="chevron-right" size="s" /></button>{/each}</div>
    {:else}<VirtualList items={tracks} itemKey={t => t.id}>{#snippet children(track, index)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(tracks.map(t => t.id), index)} />{/snippet}</VirtualList>{/if}
  {:else if selected === 'playlists' && playlists.length}<div class="grid">{#each playlists as playlist}<PlaylistCard {playlist} />{/each}</div>
  {:else if tracks.length}<VirtualList items={tracks} itemKey={t => t.id}>{#snippet children(track, index)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(tracks.map(t => t.id), index)} />{/snippet}</VirtualList>
  {:else}<EmptyState title={ui.t('library.empty')} description={ui.t('library.emptySub')} /><Button wide onclick={() => ui.nav.go({ name: 'import', source: selected === 'local' || selected === 'downloaded' ? 'local' : 'sc' })}>{ui.t('import.title')}</Button>{/if}
  {/if}
</section>
<style>
  .cache-hint { color: var(--color-text-muted); margin-bottom: var(--space-4); }
  .screen-header { gap: var(--space-2); }
  .screen-header:has(.back) { margin-left: calc(-1 * var(--space-3)); }
  .screen-title { font-size: calc(var(--font-size-2xl) * var(--font-scale)); }
  .screen-header h1 { flex: 1; min-width: 0; }
  .liked-card { display: flex; align-items: center; width: 100%; gap: var(--space-4); padding: var(--space-4); margin-bottom: var(--space-5); border-radius: var(--radius-l); text-align: start; background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1)); }
  .liked-art { position: relative; width: calc(var(--cover-row) * 1.4); aspect-ratio: 1; flex-shrink: 0; display: grid; place-items: center; border-radius: var(--radius-m); background: var(--color-surface-2); color: var(--color-accent); }
  .heart-badge { position: absolute; right: calc(-1 * var(--space-1)); bottom: calc(-1 * var(--space-1)); display: grid; place-items: center; width: var(--space-7); height: var(--space-7); border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); }
  .card-copy { display: grid; gap: var(--space-1); flex: 1; min-width: 0; }
  .card-copy strong { overflow-wrap: anywhere; font-size: calc(var(--font-size-l) * var(--font-scale)); }
  .card-copy > span, .section-card > span:last-child { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .card-copy small { color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); line-height: var(--line-height-body); }
  .sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .section-card { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-4); min-width: 0; text-align: start; border-radius: var(--radius-m); background: var(--color-surface-1); }
  .section-card:last-child { grid-column: 1 / -1; display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: var(--space-3); }
  .section-card:last-child .section-icon { grid-row: 1 / 3; margin: 0; }
  .section-icon { display: grid; place-items: center; width: var(--touch-size); height: var(--touch-size); color: var(--color-accent); margin-bottom: var(--space-2); }
  .section-card strong { font-size: calc(var(--font-size-m) * var(--font-scale)); overflow-wrap: anywhere; }
  .recent { margin-top: var(--space-6); }
  .segments { display: flex; gap: var(--space-2); margin-bottom: var(--space-5); padding: var(--space-1); border-radius: var(--radius-full); background: var(--color-surface-1); }
  .segments button { flex: 1; min-height: calc(var(--touch-size) - var(--space-2)); border-radius: var(--radius-full); color: var(--color-text-muted); font-weight: var(--font-weight-medium); }
  .segments button.active { background: var(--color-surface-3); color: var(--color-text); }
  .album-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--cover-card), 1fr)); gap: var(--space-5) var(--space-4); }
  .artist-list { display: grid; gap: var(--space-1); }
  .artist-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; text-align: start; }
  .artist-art { width: var(--cover-row); height: var(--cover-row); flex-shrink: 0; border-radius: var(--radius-full); overflow: hidden; }
  .subtitle { color: var(--color-text-muted); font-size: calc(var(--font-size-m) * var(--font-scale)); margin-bottom: var(--space-6); }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-6) var(--space-4); }
  .grid :global(button) { width: 100%; min-width: 0; }
  .grid :global(.art) { width: 100%; height: auto; aspect-ratio: 1; }
</style>
