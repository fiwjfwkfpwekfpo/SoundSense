<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../ui/context.svelte';
  import type { DiagnosticEntry } from '../core/diagnostics';
  import { errorDetails } from '../core/diagnostics';
  import Button from '../ui/components/Button.svelte';
  import Icon from '../ui/icons/Icon.svelte';
  const ui = useModel();
  let entries = $state.raw<readonly DiagnosticEntry[]>(ui.api.diagnostics?.getSnapshot() ?? []), busy = $state(false);
  let errorsOnly = $state(false);
  const visible = $derived([...entries].reverse().filter(entry => !errorsOnly || entry.level !== 'info').slice(0, 100));
  onMount(() => ui.api.diagnostics?.subscribe(value => entries = value));
  async function exportLog() {
    if (!ui.api.diagnostics || busy) return; busy = true;
    try {
      ui.trace?.flush();
      const text = await ui.api.diagnostics.export();
      const result = await ui.api.files.saveJson(`SoundSense-diagnostics-${new Date().toISOString().slice(0,10)}.json`, text, 'diagnostics');
      if (result === 'saved') ui.notify('diagnostics.exportSaved');
    }
    catch (error) { ui.api.diagnostics.record('diagnostics', 'export.failed', errorDetails(error), 'error'); ui.notify('diagnostics.exportFailed'); }
    finally { busy = false; }
  }
</script>
<section class="screen" aria-label={ui.t('diagnostics.title')}>
  <header class="screen-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{ui.t('diagnostics.title')}</h1></header>
  <p class="hint">{ui.t('diagnostics.hint')}</p>
  <section class="profile" data-profiler><h2>{ui.t('profile.title')}</h2><p class="hint">{ui.t('profile.hint')}</p>
    {#if ui.profiler?.recording}<Button wide onclick={() => { const summary = ui.profiler?.stop(); if (summary) ui.notify('profile.saved', { p95: summary.p95, janky: summary.janky }); }}>{ui.t('profile.stop')}</Button>
    {:else}<Button wide onclick={() => { ui.profiler?.start(); ui.notify('profile.started'); ui.nav.back(); }}>{ui.t('profile.start')}</Button>{/if}</section>
  {#if ui.trace}{@const trace = ui.trace}<section class="profile" data-trace><h2>{ui.t('trace.title')}</h2><p class="hint">{ui.t('trace.hint')}</p>
    <label class="filter"><input type="checkbox" checked={trace.clock} onchange={event => trace.set('clock', event.currentTarget.checked)} />{ui.t('trace.clock')}</label>
    <label class="filter"><input type="checkbox" checked={trace.beat} onchange={event => trace.set('beat', event.currentTarget.checked)} />{ui.t('trace.beat')}</label>
    <label class="filter"><input type="checkbox" checked={trace.hud} onchange={event => trace.set('hud', event.currentTarget.checked)} />{ui.t('trace.hud')}</label></section>{/if}
  <div class="actions"><Button wide disabled={busy} onclick={exportLog}>{ui.t(busy ? 'diagnostics.exporting' : 'diagnostics.export')}</Button><Button wide variant="secondary" onclick={() => ui.api.diagnostics?.clear()}>{ui.t('diagnostics.clear')}</Button></div>
  <label class="filter"><input type="checkbox" bind:checked={errorsOnly} />{ui.t('diagnostics.errorsOnly')}</label>
  <p class="count">{ui.t('diagnostics.count', { count: entries.length })}</p>
  <div class="entries">{#each visible as entry (entry.id)}<article data-level={entry.level}><header><strong>{entry.scope} · {entry.event}</strong><time>{new Date(entry.at).toLocaleTimeString(ui.locale)}</time></header><pre>{JSON.stringify(entry.data, null, 2)}</pre></article>{/each}</div>
  {#if !visible.length}<p class="hint">{ui.t('diagnostics.empty')}</p>{/if}
</section>
<style>
  .profile { margin: var(--space-4) 0 var(--space-6); padding: var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); background: var(--color-surface-1); }
  .profile h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); }
  .hint, .count { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin: var(--space-4) 0; }
  .actions { display: grid; gap: var(--space-3); }
  .filter { display: flex; align-items: center; gap: var(--space-3); min-height: var(--touch-size); margin-top: var(--space-4); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .filter input { accent-color: var(--color-accent); }
  .entries { display: grid; gap: var(--space-3); }
  article { padding: var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); background: var(--color-surface-1); }
  article[data-level='error'] { border-color: var(--color-danger); }
  article header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  time { color: var(--color-text-muted); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: calc(var(--font-size-xs) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-2); }
</style>
