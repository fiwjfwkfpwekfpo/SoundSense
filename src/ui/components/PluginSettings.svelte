<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import type { PluginSettingTab, PluginState } from '../../core/plugins/types';
  import Select from './Select.svelte';
  // Settings that enabled plugins place into a settings tab, marked with the plugin's icon and a "Plugin" badge.
  const ui = useModel();
  let { tab }: { tab: PluginSettingTab } = $props();
  let plugins = $state.raw<readonly PluginState[]>(ui.api.plugins?.getSnapshot() ?? []), version = $state(0);
  onMount(() => ui.api.plugins?.subscribe(value => { plugins = value; version++; }));
  let groups = $derived(plugins.filter(plugin => plugin.enabled).map(plugin => ({ plugin, settings: (plugin.manifest.settings ?? []).filter(setting => setting.tab === tab) })).filter(group => group.settings.length));
  const icon = (id: string) => { const svg = ui.api.plugins?.getIcon(id); return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''; };
  const values = (id: string) => { void version; return ui.api.plugins?.getSettings(id) ?? {}; };
</script>
{#each groups as { plugin, settings } (plugin.manifest.id)}{@const id = plugin.manifest.id}{@const current = values(id)}
<section class="settings-section" data-testid={`plugin-settings-${id}`}>
  <header><h2>{#if icon(id)}<img class="plugin-icon" src={icon(id)} alt="" />{/if}{plugin.manifest.name}<span class="badge">{ui.t('settings.plugin')}</span></h2></header>
  <div class="group">
    {#each settings as setting}
      <div class="setting">
        <label for={`plugin-${id}-${setting.key}`}>{setting.label}</label>
        {#if setting.type === 'toggle'}<button id={`plugin-${id}-${setting.key}`} class="switch-hit" role="switch" aria-label={setting.label} aria-checked={current[setting.key] === true} onclick={() => { ui.api.plugins?.setSetting(id, setting.key, current[setting.key] !== true); version++; }}><span class="switch" class:on={current[setting.key] === true}></span></button>
        {:else if setting.type === 'select'}<Select id={`plugin-${id}-${setting.key}`} compact label={setting.label} value={String(current[setting.key])} options={setting.options} onchange={value => { ui.api.plugins?.setSetting(id, setting.key, value); version++; }} />
        {:else}<input id={`plugin-${id}-${setting.key}`} type={setting.secret ? 'password' : 'text'} value={String(current[setting.key] ?? '')} onchange={event => { ui.api.plugins?.setSetting(id, setting.key, event.currentTarget.value); version++; }} />{/if}
      </div>
    {/each}
  </div>
</section>
{/each}
<style>
  .settings-section { margin-bottom: var(--space-6); }
  header { margin-bottom: var(--space-3); }
  h2 { display: flex; align-items: center; gap: var(--space-2); font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .plugin-icon { width: var(--space-6); height: var(--space-6); border-radius: var(--radius-s, var(--radius-m)); }
  .badge { padding: 0 var(--space-2); border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-text); font-size: calc(var(--font-size-xs) * var(--font-scale)); font-weight: var(--font-weight-semibold); line-height: 1.6; }
  .group { background: var(--color-surface-1); border-radius: var(--radius-m); padding: 0 var(--space-4); }
  .setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: calc(var(--touch-size) + var(--space-4)); border-bottom: var(--border-width) solid var(--color-border); }
  .setting:last-child { border-bottom: 0; }
  input { min-height: var(--touch-size); padding: 0 var(--space-3); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); max-width: 55%; }
  .switch-hit { min-width: var(--touch-size); min-height: var(--touch-size); display: grid; place-items: center; }
  .switch { position: relative; width: calc(var(--space-7) + var(--space-3)); height: var(--space-6); border-radius: var(--radius-full); background: var(--color-surface-3); transition: background var(--motion-general-duration); }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: calc(var(--space-6) - 6px); height: calc(var(--space-6) - 6px); border-radius: var(--radius-full); background: var(--color-text); transition: transform var(--motion-general-duration); }
  .switch.on { background: var(--color-accent); }
  .switch.on::after { transform: translateX(var(--space-3)); background: var(--color-on-accent); }
</style>
