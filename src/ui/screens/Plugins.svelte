<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import Button from '../components/Button.svelte';
  import Select from '../components/Select.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { PluginPermission, PluginState } from '../../core/plugins/types';
  import type { CatalogEntry } from '../../core/plugins/catalog';
  /** Beta: installed plugins, their permissions and settings. Enabling a plugin is the consent to its permissions. */
  const ui = useModel();
  let plugins = $state.raw<readonly PluginState[]>(ui.api.plugins?.getSnapshot() ?? []);
  let input = $state<HTMLInputElement>(), busy = $state(false), error = $state(''), open = $state('');
  let screens = $state(0);
  let catalog = $state.raw<readonly CatalogEntry[]>([]), catalogState = $state<'idle' | 'loading' | 'error'>('idle'), getting = $state('');
  async function loadCatalog() {
    if (!ui.api.pluginCatalog) return;
    catalogState = 'loading';
    try { catalog = await ui.api.pluginCatalog.list(); catalogState = 'idle'; } catch { catalogState = 'error'; }
  }
  const installedVersion = (id: string) => plugins.find(plugin => plugin.manifest.id === id)?.manifest.version;
  const newer = (a: string, b: string) => { const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  async function getFromCatalog(entry: CatalogEntry) {
    if (!ui.api.pluginCatalog || !ui.api.plugins) return;
    getting = entry.id; error = '';
    try { const plugin = await ui.api.plugins.install(await ui.api.pluginCatalog.download(entry)); open = plugin.manifest.id; ui.notify('plugins.installed', { name: plugin.manifest.name }); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    finally { getting = ''; }
  }
  onMount(() => { void loadCatalog(); const a = ui.api.plugins?.subscribe(value => plugins = value), b = ui.api.plugins?.subscribeScreens(() => screens++); return () => { a?.(); b?.(); }; });
  const hasScreen = (id: string) => { void screens; return !!ui.api.plugins?.getScreen(id); };
  function permissionLabel(permission: PluginPermission) {
    return permission.startsWith('network:') ? ui.t('plugins.permission.network', { host: permission.slice(8) }) : ui.t(`plugins.permission.${permission}`);
  }
  async function install(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file || !ui.api.plugins) return;
    busy = true; error = '';
    try { const plugin = await ui.api.plugins.install(new Uint8Array(await file.arrayBuffer())); open = plugin.manifest.id; ui.notify('plugins.installed', { name: plugin.manifest.name }); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    finally { busy = false; }
  }
  const icon = (id: string) => { const svg = ui.api.plugins?.getIcon(id); return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''; };
</script>
<section class="screen" aria-label={ui.t('plugins.title')} data-testid="plugins">
  <header class="screen-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{ui.t('plugins.title')}</h1><span></span></header>
  <p class="hint">{ui.t('plugins.hint')}</p>
  <input class="sr-only" type="file" accept=".ssplugin,.zip,application/zip" bind:this={input} onchange={install} aria-label={ui.t('plugins.install')} />
  <Button wide disabled={busy} onclick={() => input?.click()}>{ui.t(busy ? 'plugins.installing' : 'plugins.install')}</Button>
  {#if error}<p class="error" role="alert">{ui.t('plugins.installFailed', { error })}</p>{/if}
  {#if !plugins.length}<p class="hint">{ui.t('plugins.empty')}</p>{/if}
  <h2>{ui.t('plugins.catalog')}</h2>
  <p class="hint">{ui.t('plugins.catalogHint')}</p>
  {#if catalogState === 'loading'}<p class="hint" role="status">{ui.t('common.loading')}</p>{/if}
  {#if catalogState === 'error'}<p class="error" role="alert">{ui.t('plugins.catalogError')}</p><Button variant="secondary" wide onclick={loadCatalog}>{ui.t('plugins.catalogRetry')}</Button>{/if}
  <div class="list" data-testid="plugin-catalog">
    {#each catalog as entry (entry.id)}{@const have = installedVersion(entry.id)}
      <article data-catalog={entry.id}>
        <header><span class="title"><strong>{entry.name}</strong><small>{entry.version}{entry.author ? ` · ${entry.author}` : ''}</small></span>
          {#if have && !newer(entry.version, have)}<span class="done"><Icon name="check" /> {ui.t('plugins.catalogInstalled')}</span>
          {:else}<Button variant="secondary" disabled={!!getting} onclick={() => getFromCatalog(entry)}>{ui.t(getting === entry.id ? 'plugins.installing' : have ? 'plugins.catalogUpdate' : 'plugins.catalogGet')}</Button>{/if}
        </header>
        <p class="description">{entry.description}</p>
        <p class="meta">{entry.permissions.length ? entry.permissions.map(permission => permissionLabel(permission as PluginPermission)).join(' · ') : ui.t('plugins.noPermissions')}</p>
      </article>
    {/each}
  </div>
  {#if plugins.length}<h2>{ui.t('plugins.installedTitle')}</h2>{/if}
  <div class="list">
    {#each plugins as plugin (plugin.manifest.id)}{@const id = plugin.manifest.id}{@const values = ui.api.plugins?.getSettings(id) ?? {}}
      <article class:open={open === id} data-plugin={id}>
        <header>
          <button class="summary" onclick={() => open = open === id ? '' : id} aria-expanded={open === id}>
            {#if icon(id)}<img src={icon(id)} alt="" />{:else}<span class="placeholder"><Icon name="sliders" /></span>{/if}
            <span class="title"><strong>{plugin.manifest.name}</strong><small>{plugin.manifest.version}{plugin.manifest.author ? ` · ${plugin.manifest.author}` : ''} · <span data-status={plugin.status}>{ui.t(`plugins.status.${plugin.status}`)}</span></small></span>
          </button>
          <button class="switch-hit" role="switch" aria-checked={plugin.enabled} aria-label={ui.t('plugins.enable', { name: plugin.manifest.name })} onclick={() => ui.api.plugins?.setEnabled(id, !plugin.enabled)}><span class="switch" class:on={plugin.enabled}><i></i></span></button>
        </header>
        {#if plugin.status === 'running' && hasScreen(id)}<Button variant="secondary" wide onclick={() => ui.nav.go({ name: 'plugin', id })}>{ui.t('plugins.open')}</Button>{/if}
        {#if plugin.status === 'crashed' && plugin.error}<p class="error" role="alert">{ui.t('plugins.crashed', { error: plugin.error })}</p>{/if}
        {#if open === id}
          {#if plugin.manifest.description}<p class="description">{plugin.manifest.description}</p>{/if}
          <h3>{ui.t('plugins.permissions')}</h3>
          {#if !plugin.manifest.permissions.length}<p class="hint">{ui.t('plugins.noPermissions')}</p>{/if}
          {#each plugin.manifest.permissions as permission}
            <label class="row"><span>{permissionLabel(permission)}</span><input type="checkbox" checked={plugin.granted.includes(permission)} onchange={event => ui.api.plugins?.setPermission(id, permission, event.currentTarget.checked)} /></label>
          {/each}
          {#if plugin.manifest.settings?.length}<h3>{ui.t('plugins.settings')}</h3>
            {#each plugin.manifest.settings as setting}
              {#if setting.type === 'toggle'}<label class="row"><span>{setting.label}</span><input type="checkbox" checked={values[setting.key] === true} onchange={event => ui.api.plugins?.setSetting(id, setting.key, event.currentTarget.checked)} /></label>
              {:else if setting.type === 'select'}<div class="row"><span>{setting.label}</span><Select compact label={setting.label} value={String(values[setting.key])} options={setting.options} onchange={value => ui.api.plugins?.setSetting(id, setting.key, value)} /></div>
              {:else}<label class="field"><span>{setting.label}</span><input type={setting.secret ? 'password' : 'text'} value={String(values[setting.key] ?? '')} onchange={event => ui.api.plugins?.setSetting(id, setting.key, event.currentTarget.value)} /></label>{/if}
            {/each}
          {/if}
          <p class="meta">{id}</p>
          <Button variant="ghost" wide onclick={() => { ui.api.plugins?.remove(id); open = ''; }}>{ui.t('plugins.remove')}</Button>
        {/if}
      </article>
    {/each}
  </div>
</section>
<style>
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); }
  h2 { margin: var(--space-6) 0 var(--space-2); font-size: calc(var(--font-size-l) * var(--font-scale)); }
  .done { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-accent); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .hint, .meta { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin: var(--space-4) 0; }
  .meta { font-size: calc(var(--font-size-xs) * var(--font-scale)); word-break: break-all; }
  .error { color: var(--color-danger); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin: var(--space-3) 0; }
  .list { display: grid; gap: var(--space-3); margin-top: var(--space-5); }
  article { padding: var(--space-3) var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); background: var(--color-surface-1); }
  article > header { display: flex; align-items: center; gap: var(--space-3); }
  .summary { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); text-align: start; min-height: var(--touch-size); }
  .summary img, .placeholder { width: var(--space-8); height: var(--space-8); border-radius: var(--radius-s); flex-shrink: 0; display: grid; place-items: center; background: var(--color-surface-2); }
  .title { display: flex; flex-direction: column; min-width: 0; }
  .title strong { font-size: calc(var(--font-size-m) * var(--font-scale)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title small { color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); margin-top: var(--space-1); }
  [data-status='crashed'] { color: var(--color-danger); }
  [data-status='running'] { color: var(--color-accent); }
  .description { margin: var(--space-3) 0; font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  h3 { margin: var(--space-4) 0 var(--space-2); font-size: calc(var(--font-size-sm) * var(--font-scale)); color: var(--color-text-muted); font-weight: var(--font-weight-semibold); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--touch-size); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .row input { accent-color: var(--color-accent); width: var(--space-5); height: var(--space-5); flex-shrink: 0; }
  .field { display: grid; gap: var(--space-1); margin: var(--space-2) 0; font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .field input { min-height: var(--touch-size); padding: 0 var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-s); background: var(--color-bg); color: var(--color-text); }
  .switch-hit { min-height: var(--touch-size); min-width: var(--touch-size); display: flex; align-items: center; justify-content: end; }
  .switch { position: relative; width: var(--switch-width); height: var(--switch-height); background: var(--color-surface-3); border-radius: var(--radius-full); }
  .switch i { position: absolute; left: var(--switch-inset); top: var(--switch-inset); width: var(--switch-knob); height: var(--switch-knob); border-radius: var(--radius-full); background: var(--color-text-muted); transition: transform var(--motion-general-duration) var(--motion-general-easing); }
  .switch.on { background: var(--color-accent); }
  .switch.on i { background: var(--color-on-accent); transform: translateX(calc(var(--switch-width) - var(--switch-knob) - var(--switch-inset) * 2)); }
</style>
