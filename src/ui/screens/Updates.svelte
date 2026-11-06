<script lang="ts">
  import { useModel } from '../context.svelte';
  import { APP_VERSION } from '../../core/version';
  import { APP_CHANNEL } from '../../core/build';
  import releaseNotes from '../../core/release-notes.json';
  import Button from '../components/Button.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let release = $derived(ui.updateState);
  let notes = $derived(release?.manifest?.notes[ui.locale === 'en' ? 'en' : 'ru'] ?? releaseNotes[ui.locale === 'en' ? 'en' : 'ru']);
</script>
<section class="screen updates-screen" aria-label={ui.t('update.title')}>
  <header class="screen-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{ui.t('update.title')}</h1><span></span></header>
  <div class="brand"><img src="/SoundSense.png" alt="" /><div><h2>SoundSense</h2><p>{ui.t('update.installed', { version: ui.api.updates?.installed.version ?? APP_VERSION })}</p><p>{ui.t('update.channel', { channel: APP_CHANNEL })}</p></div></div>
  {#if release && ui.api.updates}
    <div class="update-card" aria-live="polite"><h2>{ui.t(`update.phase.${release.phase}`, { version: release.manifest?.version ?? '' })}</h2>
      {#if release.phase === 'error'}<p role="alert">{ui.t(`update.error.${release.error ?? 'network'}`)}</p>{/if}
      {#if release.phase === 'permission'}<p>{ui.t('update.permissionHint')}</p>{/if}
      {#if (release.phase === 'available' || release.phase === 'downloading') && release.total > 0}<p>{ui.t('update.downloadSize', { size: (release.total / 1024 / 1024).toFixed(1) })}</p>{/if}
      {#if release.phase === 'downloading'}<progress value={release.downloaded} max={Math.max(1, release.total)} aria-label={ui.t('update.downloading')}></progress><p>{Math.round(release.downloaded / Math.max(1, release.total) * 100)}%</p><Button variant="secondary" wide onclick={() => ui.api.updates?.cancel()}>{ui.t('common.cancel')}</Button>
      {:else if ['ready','permission'].includes(release.phase)}<Button wide onclick={() => ui.api.updates?.install()}>{ui.t('update.install')}</Button>
      {:else if release.phase === 'available' && ui.api.updates.supported}<Button wide onclick={() => ui.api.updates?.download()}>{ui.t('update.download')}</Button>
      {:else if !['checking','installing'].includes(release.phase)}<Button wide onclick={() => ui.api.updates?.check()}>{ui.t('update.check')}</Button>{/if}
      {#if ['checking','installing'].includes(release.phase)}<div role="status" class="busy">{ui.t('common.loading')}</div>{/if}
      <p class="small">{ui.t('update.signedHint')}</p>
    </div>
  {/if}
  <section class="notes"><h2>{ui.t('update.changelog', { version: release?.manifest?.version ?? APP_VERSION })}</h2><ul>{#each notes as line}<li>{line}</li>{/each}</ul></section>
</section>
<style>
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); line-height: var(--line-height-body); }
  .brand { display: flex; align-items: center; gap: var(--space-4); margin: var(--space-4) 0 var(--space-6); }
  .brand img { width: var(--cover-card); max-width: 80px; aspect-ratio: 1; border-radius: var(--radius-m); }
  p { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin: var(--space-3) 0; }
  .update-card { padding: var(--space-4); background: var(--color-surface-1); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); }
  .update-card :global(button) { margin-top: var(--space-3); }
  .small { font-size: calc(var(--font-size-xs) * var(--font-scale)); margin-bottom: 0; }
  .notes { margin-top: var(--space-7); }
  ul { padding-left: var(--space-5); color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  li { margin: var(--space-3) 0; }
  progress { width: 100%; accent-color: var(--color-accent); }
  .busy { min-height: var(--touch-size); display: grid; place-items: center; color: var(--color-text-muted); }
</style>
