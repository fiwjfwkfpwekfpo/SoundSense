<script lang="ts">
  import type { AlbumGroup } from '../library-groups';
  import { useModel } from '../context.svelte';
  import Cover from './Cover.svelte';
  const ui = useModel();
  let { album }: { album: AlbumGroup } = $props();
</script>
<button onclick={() => ui.nav.go({ name: 'album', id: album.id })} aria-label={`${album.title}, ${album.artist}`}><span class="art"><Cover artwork={album.artwork} /></span><strong>{album.title}</strong><span class="meta">{album.artist}{album.year ? ` · ${album.year}` : ''}</span></button>
<style>
  button { display: flex; flex-direction: column; min-width: 0; text-align: start; }
  .art { width: 100%; aspect-ratio: 1; border-radius: var(--radius-m); margin-bottom: var(--space-2); overflow: hidden; }
  strong { width: 100%; font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { width: 100%; font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
