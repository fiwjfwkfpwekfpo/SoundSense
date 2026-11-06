<script lang="ts">
  import type { Chart, ChartSource } from '../../core/charts';
  import { useModel } from '../context.svelte';
  import TrackRow from './TrackRow.svelte';
  import Icon from '../icons/Icon.svelte';
  import VirtualList from './VirtualList.svelte';
  const ui = useModel();
  let enabled = $derived((['ya', 'spotify', 'sc'] as const).filter(id => ui.settings.values[id === 'ya' ? 'chartYa' : id === 'spotify' ? 'chartSpotify' : 'chartSc'] !== false));
  let picked = $state<ChartSource>();
  let source = $derived<ChartSource>(picked && enabled.includes(picked as never) ? picked : enabled.includes(ui.settings.values.chartDefault as never) ? ui.settings.values.chartDefault as ChartSource : enabled[0] ?? 'ya');
  let chart = $state.raw<Chart>(), loading = $state(false), failed = $state(false), expanded = $state(false), refresh = $state(0);
  $effect(() => {
    const active = source, force = refresh > 0; void refresh;
    if (!ui.api.charts) return;
    const controller = new AbortController(); loading = true; failed = false; chart = undefined; expanded = false;
    void ui.api.charts.get(active, controller.signal, force).then(value => { if (!controller.signal.aborted) { chart = value; loading = false; } }).catch(() => { if (!controller.signal.aborted) { loading = false; failed = true; } });
    return () => controller.abort();
  });
</script>
<section class="charts" data-testid="charts">
  <div class="chart-heading"><div><h2>{ui.t('home.charts')}</h2><p>{ui.t('home.chartsSub')}</p></div><button class="icon-button" aria-label={ui.t('common.refresh')} disabled={loading} onclick={() => refresh++}><Icon name="repeat" size="s" /></button></div>
  <div class="chips" aria-label={ui.t('home.charts')}>{#each enabled as service}<button class="chip" class:active={source === service} onclick={() => picked = service}>{ui.t(`source.${service}`)}</button>{/each}</div>
  {#if loading}<p class="chart-status" role="status">{ui.t('home.chartLoading')}</p><div class="chart-skeleton" aria-hidden="true">{#each Array(3) as _}<i></i>{/each}</div>
  {:else if failed}<p class="chart-status">{ui.t('home.chartError')}</p><button class="text-action" onclick={() => refresh++}>{ui.t('common.retry')}</button>
  {:else if chart}<div class="chart-caption"><span>{ui.t(source === 'ya' ? 'chart.yandex' : source === 'sc' ? 'chart.sc' : 'chart.spotify')}</span>{#if chart.stale}<small>{ui.t('chart.cached')}</small>{/if}</div>
    {#if expanded}<VirtualList items={chart.tracks} itemKey={track => track.id}>{#snippet children(track, index)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(chart!.tracks.map(track => track.id), index)} />{/snippet}</VirtualList>
    {:else}{#each chart.tracks.slice(0, 5) as track, index (track.id)}<TrackRow {track} active={ui.player?.trackId === track.id} onplay={() => ui.play(chart!.tracks.map(track => track.id), index)} />{/each}{/if}
    <button class="text-action" onclick={() => expanded = !expanded}>{ui.t(expanded ? 'chart.collapse' : 'chart.showAll', { count: chart.tracks.length })}</button>
  {/if}
</section>
<style>
  .charts { margin-top: var(--space-6); }
  .chart-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  p, .chart-caption { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); line-height: var(--line-height-body); }
  .chart-heading p { margin-top: var(--space-1); }
  .chips { margin: 0 calc(-1 * var(--space-6)); padding: 0 var(--space-6); }
  .chart-status, .chart-caption { margin-top: var(--space-4); }
  .chart-caption { display: flex; justify-content: space-between; }
  .chart-skeleton { display: grid; gap: var(--space-3); margin-top: var(--space-3); }
  .chart-skeleton i { height: var(--cover-row); border-radius: var(--radius-s); background: var(--color-surface-1); }
</style>
