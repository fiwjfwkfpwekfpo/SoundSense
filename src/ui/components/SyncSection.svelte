<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import type { SyncState } from '../../core/sync/engine';
  import { showCode } from '../../core/sync/merge';
  import Button from './Button.svelte';
  // Settings → device sync: pairing by code, the linked devices, "continue here".
  const ui = useModel();
  let current = $state<SyncState | undefined>(ui.api.sync?.getSnapshot());
  let entering = $state(false), code = $state(''), clock = $state(Date.now());
  onMount(() => {
    const sync = ui.api.sync; if (!sync) return;
    const unsubscribe = sync.subscribe(value => { current = value; if (value.linked && !value.joining) entering = false; });
    const timer = setInterval(() => clock = Date.now(), 1000);
    return () => { unsubscribe(); clearInterval(timer); sync.stopCode(); };
  });
  const remaining = (until: number) => { const seconds = Math.max(0, Math.round((until - clock) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
  const when = (time: number) => new Date(time).toLocaleString(String(ui.settings.values.language) === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>
{#if ui.api.sync && current}{@const sync = ui.api.sync}
<section class="settings-section" data-testid="sync">
  <header><h2>{ui.t('sync.title')}</h2></header>
  <p class="hint">{ui.t('sync.hint')}</p>
  {#if current.linked}
    <div class="group">
      <div class="device"><div><strong>{current.device.name}</strong><small>{ui.t('sync.thisDevice')}</small></div></div>
      {#each current.devices as device (device.id)}
        <div class="device">
          <div>
            <strong><span class="dot" class:online={device.online}></span>{device.name}</strong>
            <small>{device.online ? ui.t('sync.online') : ui.t('sync.offline')}</small>
            {#if device.playing}<small class="playing">{ui.t('sync.playing', { title: device.playing.track.title, artist: device.playing.track.artist.name })}</small>{/if}
          </div>
          <div class="actions">
            {#if device.playing}<Button variant="secondary" onclick={() => sync.continueFrom(device.id)}>{ui.t('sync.continue')}</Button>{/if}
            <Button variant="ghost" onclick={() => sync.unlink(device.id)}>{ui.t('sync.unlink')}</Button>
          </div>
        </div>
      {:else}<p class="hint empty">{ui.t('sync.empty')}</p>{/each}
    </div>
    {#if current.lastSync}<p class="hint">{ui.t('sync.lastSync', { time: when(current.lastSync) })}</p>{/if}
    {#if current.connecting}<p class="hint">{ui.t('sync.connecting')}</p>{/if}
  {/if}
  {#if current.linking && 'code' in current.linking}
    <div class="pairing" role="status"><p>{ui.t('sync.codeHint')}</p><output aria-label={ui.t('sync.showCode')}>{showCode(current.linking.code)}</output><small>{remaining(current.linking.until)}</small>
      <Button variant="ghost" wide onclick={() => sync.stopCode()}>{ui.t('common.cancel')}</Button></div>
  {:else if entering}
    <form class="pairing" onsubmit={event => { event.preventDefault(); void sync.join(code); }}>
      <label for="sync-code">{ui.t('sync.codeInput')}</label>
      <input id="sync-code" autocomplete="off" spellcheck="false" maxlength="9" placeholder="K7M2-9QXP" bind:value={code} />
      {#if current.joining && 'error' in current.joining}<p role="alert">{ui.t(current.joining.error)}</p>{/if}
      <Button wide type="submit" disabled={!!current.joining && 'busy' in current.joining}>{ui.t(current.joining && 'busy' in current.joining ? 'sync.joining' : 'sync.join')}</Button>
      <Button variant="ghost" wide onclick={() => entering = false}>{ui.t('common.cancel')}</Button>
    </form>
  {:else}
    {#if current.linking && 'error' in current.linking}<p role="alert">{ui.t(current.linking.error)}</p>{/if}
    <div class="buttons">
      <Button variant="secondary" wide onclick={() => { void sync.showCode(); }}>{ui.t(current.linked ? 'sync.addDevice' : 'sync.showCode')}</Button>
      {#if !current.linked}<Button variant="secondary" wide onclick={() => { entering = true; code = ''; }}>{ui.t('sync.enterCode')}</Button>
      {:else}<Button variant="ghost" wide onclick={() => sync.leave()}>{ui.t('sync.leave')}</Button>{/if}
    </div>
  {/if}
</section>
{/if}
<style>
  .settings-section { margin-bottom: var(--space-6); }
  header { margin-bottom: var(--space-3); }
  h2 { font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .hint { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin-bottom: var(--space-3); }
  .group { background: var(--color-surface-1); border-radius: var(--radius-m); padding: 0 var(--space-4); margin-bottom: var(--space-3); }
  .device { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: calc(var(--touch-size) + var(--space-4)); padding: var(--space-2) 0; border-bottom: var(--border-width) solid var(--color-border); }
  .device:last-child { border-bottom: 0; }
  .device strong { display: flex; align-items: center; gap: var(--space-2); }
  .device small { display: block; color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .device .playing { color: var(--color-text); }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }
  .dot { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); background: var(--color-text-muted); }
  .dot.online { background: var(--color-accent); }
  .empty { padding: var(--space-3) 0; margin: 0; }
  .pairing { display: grid; gap: var(--space-3); margin-bottom: var(--space-3); }
  .pairing p, .pairing label, .pairing small { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .pairing small { text-align: center; }
  output { display: block; padding: var(--space-4); text-align: center; font-size: calc(var(--font-size-xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); font-family: var(--font-family-mono, ui-monospace, monospace); background: var(--color-surface-2); border-radius: var(--radius-m); user-select: all; }
  input { min-height: var(--touch-size); padding: 0 var(--space-3); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); font-size: calc(var(--font-size-l) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); text-transform: uppercase; }
  [role='alert'] { color: var(--color-danger); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .buttons { display: grid; gap: var(--space-3); }
</style>
