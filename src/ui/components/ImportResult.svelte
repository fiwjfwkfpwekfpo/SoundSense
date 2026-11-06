<script lang="ts">
  import { useModel } from '../context.svelte';
  import { formatTime } from '../../core/format';
  import Button from './Button.svelte';
  import Cover from './Cover.svelte';
  const ui = useModel();
  let result = $derived(ui.importJob?.result);
  let variants = $state<number | null>(null);
  function manual(index: number, kind: 'missing' | 'uncertain') {
    const issue = result?.[kind][index]; if (!issue) return;
    ui.pendingMatch = { index, kind }; ui.nav.searchQuery = `${issue.original.artist} — ${issue.original.title}`;
    ui.nav.go({ name: 'search' }, true);
  }
</script>
{#if result}
  <section class="result" data-testid="import-result">
    <p class="eyebrow">{ui.t('import.result')}</p><h2>{ui.t('import.imported', { count: result.imported, total: result.total })}</h2>
    <p class="summary">{ui.t('import.duplicates', { added: result.added, existing: result.existing })}</p>
    <Button wide onclick={() => ui.nav.go(result!.playlistId === 'liked' ? { name: 'liked' } : { name: 'playlist', id: result!.playlistId })}>{ui.t('import.openResult')}</Button>
    {#if (result.collections?.length ?? 0) > 1}<div class="collections">{#each result.collections ?? [] as collection}<button onclick={() => ui.nav.go(collection.playlistId === 'liked' ? { name: 'liked' } : { name: 'playlist', id: collection.playlistId })}><strong>{collection.playlistId === 'liked' ? ui.t('nav.liked') : collection.title}</strong><span>{ui.count(collection.imported)}</span></button>{/each}</div>{/if}
    <section class="issues" data-testid="import-missing"><h3>{ui.t('import.missing', { count: result.missing.filter(issue => !issue.resolved).length })}</h3>
      {#each result.missing as issue, index}<div class="issue"><strong>{issue.original.title}</strong><p>{issue.original.artist}</p>{#if !issue.resolved}<button class="text-action" onclick={() => manual(index, 'missing')}>{ui.t('import.findManually')}</button>{:else}<p>{ui.t(`import.${issue.resolved}`)}</p>{/if}</div>{/each}
    </section>
    <section class="issues" data-testid="import-uncertain"><h3>{ui.t('import.uncertain', { count: result.uncertain.filter(issue => !issue.resolved).length })}</h3>
      {#if result.uncertain.some(issue => !issue.resolved)}<button class="text-action" onclick={() => result?.uncertain.forEach((issue, index) => { if (!issue.resolved) ui.api.imports.resolve(index, issue.candidateId ?? null); })}>{ui.t('import.acceptAll')}</button>{/if}
      {#each result.uncertain as issue, index}{@const candidate = ui.api.library.getTrack(issue.candidateId ?? '')}<div class="issue"><p class="eyebrow">{ui.t('import.original')}</p><strong>{issue.original.title}</strong><p>{issue.original.artist} · {issue.original.duration ? formatTime(issue.original.duration) : '—'}</p>
        {#if candidate}<div class="candidate"><span class="art"><Cover artwork={candidate.artwork} /></span><div><small>{ui.t('import.replacement')}</small><strong>{candidate.title}</strong><p>{candidate.artist.name} · {formatTime(candidate.duration)} · {ui.t(`source.${candidate.sources[0]?.kind ?? 'sc'}`)}</p></div></div>{/if}
        {#if !issue.resolved}<div class="decisions"><button class="text-action" onclick={() => ui.api.imports.resolve(index, issue.candidateId ?? null)}>{ui.t('import.correct')}</button><button class="text-action" onclick={() => variants = variants === index ? null : index}>{ui.t('import.other')}</button><button class="text-action" onclick={() => ui.api.imports.resolve(index, null)}>{ui.t('import.skip')}</button></div>
          {#if variants === index}<div class="variants">{#each issue.alternatives ?? [] as id}{@const alternative = ui.api.library.getTrack(id)}{#if alternative}<button class="text-action" onclick={() => { ui.api.imports.resolve(index, id); variants = null; }}>{alternative.artist.name} — {alternative.title}</button>{/if}{/each}<button class="text-action" onclick={() => manual(index, 'uncertain')}>{ui.t('import.findManually')}</button></div>{/if}
        {:else}<p>{ui.t(`import.${issue.resolved}`)}</p>{/if}
      </div>{/each}
    </section>
    <section class="issues" data-testid="import-unavailable"><h3>{ui.t('import.unavailable', { count: result.unavailable.length })}</h3>{#each result.unavailable as issue}<div class="issue"><strong>{issue.original.title}</strong><p>{issue.original.artist}</p><p>{ui.t(`import.reason.${issue.reason}`)}</p></div>{/each}</section>
  </section>
{/if}
<style>
  h2 { font-size: calc(var(--font-size-2xl) * var(--font-scale)); margin: var(--space-3) 0; }
  h3 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  .summary, p { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  .summary { margin-bottom: var(--space-5); }
  .issues { margin-top: var(--space-7); }
  .collections { display: grid; gap: var(--space-3); margin-top: var(--space-5); }
  .collections button { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); text-align: start; min-height: var(--touch-size); padding: var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); background: var(--color-surface-1); }
  .collections span { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .issue { padding: var(--space-4) 0; border-bottom: var(--border-width) solid var(--color-border); overflow-wrap: anywhere; }
  strong { display: block; font-size: calc(var(--font-size-m) * var(--font-scale)); }
  .candidate { display: flex; gap: var(--space-3); padding: var(--space-3); background: var(--color-surface-1); border-radius: var(--radius-m); margin-top: var(--space-3); }
  .candidate > div { min-width: 0; }
  .art { width: var(--cover-row); height: var(--cover-row); flex-shrink: 0; }
  small { font-size: calc(var(--font-size-xs) * var(--font-scale)); color: var(--color-text-muted); }
  .decisions { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  .variants { display: grid; }
</style>
