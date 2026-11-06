<script lang="ts">
  import type { Playlist } from '../../core/types';
  import { useModel } from '../context.svelte';
  import Cover from './Cover.svelte';
  const ui = useModel();
  let { playlist }: { playlist: Playlist } = $props();
</script>
<button onclick={() => ui.nav.go({ name: 'playlist', id: playlist.id })} aria-label={`${ui.playlistTitle(playlist)}, ${ui.count(playlist.trackIds.length)}`}><span class="art"><Cover artwork={playlist.artwork} heart={playlist.kind === 'liked'} /></span><strong>{ui.playlistTitle(playlist)}</strong><span class="count">{ui.count(playlist.trackIds.length)}</span></button>
<style>
  button { display: flex; flex-direction: column; width: var(--cover-card); min-width: var(--cover-card); text-align: start; }
  .art { width: var(--cover-card); height: var(--cover-card); border-radius: var(--radius-m); margin-bottom: var(--space-2); }
  strong { width: 100%; font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-1); }
</style>
