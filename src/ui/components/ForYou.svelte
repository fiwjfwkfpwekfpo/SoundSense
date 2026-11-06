<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import TrackRow from './TrackRow.svelte';
  import Icon from '../icons/Icon.svelte';
  /** "For you": Riff-style taste profile + Deezer/YouTube Music candidates, built on the device. */
  const ui = useModel();
  let tracks = $derived((ui.library?.recommendations ?? []).flatMap(id => { const track = ui.api.library.getTrack(id); return track ? [track] : []; }));
  let phase = $derived(ui.recommendationState?.phase ?? 'idle');
  // Wait until the screen has settled: the first build makes dozens of requests.
  onMount(() => { const timer = setTimeout(() => void ui.api.recommendations?.refresh(), 1500); return () => clearTimeout(timer); });
</script>
<section class="for-you" data-testid="for-you">
  <div class="heading"><div><h2>{ui.t('home.forYou')}</h2><p>{ui.t('home.forYouSub')}</p></div>
    {#if ui.api.recommendations}<button class="icon-button" aria-label={ui.t('common.refresh')} disabled={phase === 'loading'} onclick={() => void ui.api.recommendations?.refresh({ force: true })}><Icon name="repeat" size="s" /></button>{/if}</div>
  {#if tracks.length}
    {#each tracks.slice(0, 5) as track, index (track.id)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(tracks.map(item => item.id), index)} />{/each}
    <div class="actions"><button class="text-action" onclick={() => ui.play(tracks.map(item => item.id))}>{ui.t('home.playAll')}</button>{#if tracks.length > 5}<button class="text-action" onclick={() => ui.nav.go({ name: 'collection', id: 'recommendations' })}>{ui.t('home.showAll')}</button>{/if}</div>
  {:else if phase === 'loading'}<p class="status" role="status">{ui.t('home.forYouLoading')}</p><div class="skeleton" aria-hidden="true">{#each Array(3) as _}<i></i>{/each}</div>
  {:else if phase === 'error'}<p class="status">{ui.t('home.forYouError')}</p><button class="text-action" onclick={() => void ui.api.recommendations?.refresh({ force: true })}>{ui.t('common.retry')}</button>
  {:else}<p class="status">{ui.t('home.forYouEmpty')}</p>{/if}
</section>
<style>
  .for-you { margin-top: var(--space-6); }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  p { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); line-height: var(--line-height-body); }
  .heading p { margin-top: var(--space-1); }
  .actions { display: flex; justify-content: space-between; gap: var(--space-3); }
  .skeleton { display: grid; gap: var(--space-3); margin-top: var(--space-3); }
  .skeleton i { height: var(--cover-row); border-radius: var(--radius-s); background: var(--color-surface-1); }
</style>
