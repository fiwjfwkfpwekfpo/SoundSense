<script lang="ts">
  import { useModel } from '../context.svelte';
  import TrackRow from '../components/TrackRow.svelte';
  import VirtualList from '../components/VirtualList.svelte';
  import Cover from '../components/Cover.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Button from '../components/Button.svelte';
  import Icon from '../icons/Icon.svelte';
  import AlbumCard from '../components/AlbumCard.svelte';
  import { albumOrder, albums } from '../library-groups';
  const ui = useModel();
  let { id, artist = false, album = false }: { id: string; artist?: boolean; album?: boolean } = $props();
  let artistData = $derived(ui.library?.tracks.find(t => t.artist.id === id)?.artist);
  // An album is listed in its own order (disc, track number); an artist page groups its albums first.
  let albumTracks = $derived(album ? (ui.library?.tracks ?? []).filter(t => t.albumId === id).sort(albumOrder) : []);
  let albumInfo = $derived(albumTracks.find(t => t.album)?.album);
  let tracks = $derived(album ? albumTracks : artist ? (ui.library?.tracks ?? []).filter(t => t.artist.id === id || t.album?.artist === artistData?.name && !!artistData) : (id === 'history' ? ui.library?.history : ui.library?.recommendations)?.flatMap(id => { const track = ui.api.library.getTrack(id); return track ? [track] : []; }) ?? []);
  let artistAlbums = $derived(artist ? albums(tracks) : []);
  let title = $derived(album ? albumInfo?.title ?? '' : artist ? artistData?.name ?? '' : ui.t(id === 'history' ? 'library.history' : 'home.recommendations'));
</script>
<section class="screen"><header class="toolbar"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><span class="eyebrow">{ui.t(album ? 'common.album' : artist ? 'common.artist' : 'app.name')}</span><span class="spacer"></span></header>
  {#if artistData && artist}<div class="artist-cover"><Cover artwork={artistData.artwork} round /></div>{/if}{#if album && albumTracks[0]}<div class="album-cover"><Cover artwork={albumTracks.find(t => t.artwork.url)?.artwork ?? albumTracks[0].artwork} /></div>{/if}<h1 class="screen-title">{title}</h1>
  {#if album && albumInfo}<p class="count">{#if albumTracks[0]}<button class="link" onclick={() => ui.nav.go({ name: 'artist', id: albumTracks[0]!.artist.id })}>{albumInfo.artist}</button>{/if}{albumInfo.year ? ` · ${albumInfo.year}` : ''} · {ui.count(tracks.length)}</p>{:else}<p class="count">{ui.count(tracks.length)}</p>{/if}
  {#if artistAlbums.length}<h2 class="albums-title">{ui.t('library.albums')}</h2><div class="albums">{#each artistAlbums as item (item.id)}<AlbumCard album={item} />{/each}</div>{/if}<Button wide disabled={!tracks.length} onclick={() => ui.play(tracks.map(t => t.id))}><Icon name="play" size="s" />{ui.t('playlist.listen')}</Button><div class="tracks">{#if !tracks.length}<EmptyState title={ui.t('library.empty')} description={ui.t('library.emptySub')} /><Button wide onclick={() => ui.nav.go({ name: 'search' }, true)}>{ui.t('state.findMusic')}</Button>{/if}<VirtualList items={tracks} itemKey={t => t.id}>{#snippet children(track, index)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(tracks.map(t => t.id), index)} />{/snippet}</VirtualList></div>
</section>
<style>
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) var(--space-6); }
  .spacer { width: var(--touch-size); }
  .count { color: var(--color-text-muted); font-size: calc(var(--font-size-m) * var(--font-scale)); margin: var(--space-3) 0 var(--space-6); }
  .tracks { margin-top: var(--space-5); }
  .album-cover { width: calc(var(--cover-card) * 1.5); aspect-ratio: 1; border-radius: var(--radius-m); overflow: hidden; margin-bottom: var(--space-5); box-shadow: var(--shadow-cover, none); }
  .link { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .albums-title { font-size: calc(var(--font-size-l) * var(--font-scale)); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-3); }
  .albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--cover-card), 1fr)); gap: var(--space-4); margin-bottom: var(--space-6); }
  .artist-cover { width: var(--cover-card); height: var(--cover-card); border-radius: var(--radius-full); margin-bottom: var(--space-5); }
</style>
