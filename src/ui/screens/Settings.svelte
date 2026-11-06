<script lang="ts">
  import { isNew, noteFeatures } from '../new-badges';
  import { useModel } from '../context.svelte';
  import { scenarios } from '../../core/environment';
  import Button from '../components/Button.svelte';
  import Select from '../components/Select.svelte';
  import AppearanceControl from '../appearance/AppearanceControl.svelte';
  import { APP_VERSION } from '../../core/version';
  import { APP_CHANNEL, DEBUG_TOOLS } from '../../core/build';
  import { onMount } from 'svelte';
  import type { PlaybackPowerState } from '../../core/api';
  import YandexAccount from '../components/YandexAccount.svelte';
  import SyncSection from '../components/SyncSection.svelte';
  import PluginSettings from '../components/PluginSettings.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  import type { PluginSettingTab } from '../../core/plugins/types';
  const ui = useModel();
  let developer = $state(false); let taps = 0;
  // Tabs: each built-in settings section belongs to one tab; plugins pick a tab for their settings.
  const tabs: { id: PluginSettingTab; icon: IconName }[] = [
    { id: 'appearance', icon: 'sun' }, { id: 'playback', icon: 'play' }, { id: 'sound', icon: 'sliders' }, { id: 'sources', icon: 'music' },
    { id: 'sync', icon: 'share' }, { id: 'storage', icon: 'download' }, { id: 'app', icon: 'settings' },
  ];
  const tabOf: Record<string, PluginSettingTab> = { appearance: 'appearance', home: 'appearance', playback: 'playback', sound: 'sound', sources: 'sources', offline: 'storage', sync: 'sync', updates: 'app' };
  let tab = $state<PluginSettingTab>((ui.nav.view.settingsTab as PluginSettingTab) ?? 'appearance');
  $effect(() => { ui.nav.view.settingsTab = tab; });
  let sections = $derived(ui.contributions('settingsSections').filter(section => ui.settingDefinitions.some(definition => definition.section === section.section && !definition.hidden)));
  let definitions = $derived(ui.settingDefinitions.filter(definition => (definition.key !== 'waveCacheLimit' || !!ui.api.waveCache) && (definition.section !== 'offline' || !!ui.api.offline)));
  // Items shown for the first time on this device are marked new (see new-badges.ts).
  $effect.pre(() => { noteFeatures([...definitions.filter(definition => !definition.hidden).map(definition => definition.key), ...(ui.api.plugins ? ['screen.plugins'] : []), ...(ui.api.releaseChannel ? ['screen.releaseChannel'] : [])]); });
  let waveStats = $state<{ bytes: number; count: number } | null>(null), clearingWaves = $state(false);
  let powerState = $state<PlaybackPowerState>();
  onMount(() => {
    const power = ui.api.playbackPower; if (!power) return;
    void power.getStatus().then(value => powerState = value).catch(() => {});
    return power.subscribe(value => powerState = value);
  });
  $effect(() => { if (ui.api.waveCache) void ui.api.waveCache.getStats().then(value => waveStats = value).catch(() => {}); });
  async function clearWaves() {
    if (!ui.api.waveCache || clearingWaves) return;
    clearingWaves = true;
    try { await ui.api.waveCache.clear(); waveStats = await ui.api.waveCache.getStats(); ui.notify('wave.cacheCleared'); }
    catch { ui.notify('wave.cacheError'); }
    finally { clearingWaves = false; }
  }

</script>
<section class="screen" aria-label={ui.t('nav.settings')}>
  <header class="screen-header"><h1 class="screen-title">{ui.t('nav.settings')}</h1></header>
  <div class="layout"><div class="tabs" role="tablist" aria-label={ui.t('nav.settings')}>{#each tabs as item}<button role="tab" aria-selected={tab === item.id} class:active={tab === item.id} onclick={() => tab = item.id}><Icon name={item.icon} size="s" /><span>{ui.t(`settings.tab.${item.id}`)}</span></button>{/each}</div>
  <div class="content"><div class="tab-hint">{ui.t(`settings.tab.${tab}.hint`)}</div>
  {#if tab === 'playback' && ui.api.playbackPower}<section class="settings-section"><div class="group"><div class="setting action"><div class="setting-label"><span class="label">{ui.t('background.title')}<small class="setting-hint">{ui.t(powerState?.unrestricted ? 'background.unrestricted' : 'background.restricted')}</small></span></div><Button variant="secondary" onclick={() => ui.nav.sheet({ kind: 'playbackPower' })}>{ui.t('background.configure')}</Button></div></div></section>{/if}
  {#if tab === 'sources' && ui.api.account}<section class="settings-section"><header><h2>{ui.t('source.ya')}</h2></header><YandexAccount onconnected={() => ui.nav.go({ name: 'import', source: 'ya' })} /></section>{/if}
  {#each sections.filter(item => (tabOf[item.section] ?? 'app') === tab && !definitions.filter(s => s.section === item.section && !s.hidden).every(s => s.disabled)) as contribution}{@const section = contribution.section}<section class="settings-section">{#if ui.t(contribution.titleKey) !== ui.t(`settings.tab.${tab}`)}<header><h2>{ui.t(contribution.titleKey)}</h2></header>{/if}<div class="group">
    {#each definitions.filter(s => s.section === section && !s.hidden) as definition}
      <div class="setting" class:disabled={definition.disabled} class:slider={definition.type === 'slider'}>
        <div class="setting-label"><label for={`setting-${definition.key}`}>{ui.t(definition.label)}{#if definition.beta}<span class="new-badge beta-badge">{ui.t('settings.beta')}</span>{/if}{#if isNew(definition.key)}<span class="new-badge">{ui.t('settings.new')}</span>{/if}{#if definition.hint}<small class="setting-hint">{ui.t(definition.hint)}</small>{/if}</label>{#if definition.type === 'slider'}<output for={`setting-${definition.key}`}>{definition.key === 'crossfade' && ui.settings.values.crossfade === 0 ? ui.t('appearance.motion.off') : `${ui.settings.values[definition.key]}${definition.unit ? ` ${ui.t(definition.unit)}` : ''}`}</output>{/if}</div>
        {#if definition.type === 'appearance' && definition.axis}<AppearanceControl axis={definition.axis} />{:else if definition.type === 'toggle'}<button id={`setting-${definition.key}`} class="switch-hit" role="switch" aria-checked={!!ui.settings.values[definition.key]} aria-label={ui.t(definition.label)} disabled={definition.disabled} onclick={() => ui.settings.set(definition.key, !ui.settings.values[definition.key])}><span class="switch" data-state={ui.settings.values[definition.key] ? "on" : "off"} class:on={!!ui.settings.values[definition.key]}><i></i></span></button>
        {:else if definition.type === 'select'}<Select id={`setting-${definition.key}`} label={ui.t(definition.label)} value={String(ui.settings.values[definition.key])} options={(definition.options ?? []).map(option => ({ value: option.value, label: ui.t(option.label) }))} disabled={definition.disabled} onchange={value => ui.settings.set(definition.key, value)} />
        {:else if definition.type === 'slider'}<input id={`setting-${definition.key}`} aria-label={ui.t(definition.label)} type="range" min={definition.min} max={definition.max} step={definition.step} value={Number(ui.settings.values[definition.key])} disabled={definition.disabled} oninput={event => ui.settings.set(definition.key, Number(event.currentTarget.value))} />
        {:else}<input id={`setting-${definition.key}`} aria-label={ui.t(definition.label)} type="text" value={String(ui.settings.values[definition.key])} placeholder={ui.t('settings.soon')} disabled={definition.disabled} onchange={event => ui.settings.set(definition.key, event.currentTarget.value)} />{/if}
      </div>
    {/each}
  </div></section>{/each}
  {#if tab === 'sound' && ui.api.capabilities?.soundProcessing !== false}<section class="settings-section"><div class="group"><div class="setting action"><div class="setting-label"><span class="label">{ui.t('settings.soundPresets')}<small class="setting-hint">{ui.t('settings.soundHint')}</small></span></div><Button variant="secondary" onclick={() => ui.nav.sheet({ kind: 'sound' })}>{ui.t('settings.open')}</Button></div></div></section>{/if}
  {#if tab === 'sync'}<SyncSection />{/if}
  <PluginSettings {tab} />
  {#if tab === 'storage' && ui.api.waveCache}<section class="settings-section"><div class="group"><div class="setting action"><div class="setting-label"><span class="label">{ui.t('wave.cache')}<small class="setting-hint">{ui.t('wave.cacheHint', { count: waveStats?.count ?? 0, size: ((waveStats?.bytes ?? 0) / 1024).toFixed(1) })}</small></span></div><Button variant="secondary" disabled={clearingWaves} onclick={clearWaves}>{ui.t('settings.clear')}</Button></div></div></section>{/if}
  {#if tab === 'storage' && ui.api.offline}<section class="settings-section"><div class="group"><div class="setting action"><div class="setting-label"><span class="label">{ui.t('offline.cache')}<small class="setting-hint">{ui.t('offline.cacheHint', { count: ui.offlineState?.entries.filter(entry => entry.state === 'complete').length ?? 0, size: ((ui.offlineState?.bytes ?? 0) / 1048576).toFixed(1) })}</small></span></div><Button variant="secondary" onclick={() => { void ui.api.offline?.clear(); }}>{ui.t('settings.clear')}</Button></div></div></section>{/if}
  {#if tab === 'app' && ui.api.releaseChannel}{@const channel = ui.api.releaseChannel}<section class="settings-section" data-testid="release-channel"><header><h2>{ui.t('settings.channel.title')}</h2></header><div class="group"><div class="setting"><div class="setting-label"><label for="setting-release-channel">{ui.t('settings.channel.label')}<small class="setting-hint">{ui.t('settings.channel.hint')}</small></label></div><Select id="setting-release-channel" label={ui.t('settings.channel.label')} value={channel.current} options={[{ value: 'stable', label: ui.t('settings.channel.stable') }, { value: 'beta', label: ui.t('settings.channel.beta') }]} onchange={value => { if (value === 'stable' || value === 'beta') { ui.notify('settings.channel.restarting'); channel.set(value); } }} /></div></div></section>{/if}
  {#if tab === 'app'}
  <p class="hint">{ui.t('settings.localHint')}</p>{#if !ui.api.settings.isPersistent()}<p class="hint">{ui.t('settings.storageUnavailable')}</p>{/if}
  <div class="group links">
    <button class="link-row" onclick={() => ui.nav.go({ name: 'updates' })}><Icon name="download" size="s" /><span>{ui.t(ui.updateState?.phase === 'available' ? 'update.availableMenu' : 'update.title')}</span><Icon name="chevron-right" size="s" /></button>
    <button class="link-row" onclick={() => ui.nav.go({ name: 'import' })}><Icon name="plus" size="s" /><span>{ui.t('import.title')}</span><Icon name="chevron-right" size="s" /></button>
    {#if ui.api.plugins}<button class="link-row" onclick={() => ui.nav.go({ name: 'plugins' })}><Icon name="sliders" size="s" /><span>{ui.t('plugins.title')}<span class="new-badge beta-badge">{ui.t('settings.beta')}</span>{#if isNew('screen.plugins')}<span class="new-badge">{ui.t('settings.new')}</span>{/if}</span><Icon name="chevron-right" size="s" /></button>{/if}
    {#if DEBUG_TOOLS && ui.api.diagnostics}<button class="link-row" onclick={() => ui.nav.go({ name: 'diagnostics' })}><Icon name="bell" size="s" /><span>{ui.t('diagnostics.title')}</span><Icon name="chevron-right" size="s" /></button>{/if}
    <button class="link-row danger" onclick={() => { ui.settings.reset(); ui.notify('settings.resetDone'); }}><Icon name="close" size="s" /><span>{ui.t('settings.reset')}</span></button>
  </div>
  {#if DEBUG_TOOLS && developer}<Select label={ui.t('dev.title')} value={ui.environment?.scenario ?? 'normal'} options={scenarios.map(value => ({ value, label: ui.t(value.startsWith('import-') ? `import.error.${value.slice(7)}.title` : `dev.${value}`) }))} onchange={value => ui.api.environment.setScenario(value)} />{/if}
  <footer><button onclick={() => { if (DEBUG_TOOLS && import.meta.env.DEV && ++taps >= 5) developer = !developer; }}>{ui.t('app.name')}</button><span>{APP_VERSION} · {APP_CHANNEL}</span></footer>
  {/if}
  </div></div>
</section>
<style>
  .layout { display: block; }
  .tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
  .tabs button { display: inline-flex; align-items: center; gap: var(--space-2); min-height: calc(var(--touch-size) - var(--space-3)); padding: 0 var(--space-3); border-radius: var(--radius-full); color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); font-weight: var(--font-weight-medium); white-space: nowrap; }
  .tabs button:hover { color: var(--color-text); background: var(--color-surface-1); }
  .tabs button.active { color: var(--color-text); background: var(--color-surface-2); box-shadow: inset 0 0 0 var(--border-width) var(--color-border); }
  .tabs button.active :global(svg) { color: var(--color-accent); }
  .tabs button:focus:not(:focus-visible) { outline: none; }
  /* Wide window: the tabs become a list on the left. */
  @container settings (min-width: 760px) {
    .layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: var(--space-6); align-items: start; }
    .tabs { position: sticky; top: var(--space-2); flex-direction: column; flex-wrap: nowrap; }
    .tabs button { min-height: var(--touch-size); border-radius: var(--radius-m); font-size: calc(var(--font-size-m) * var(--font-scale)); }
    .content { max-width: 760px; }
  }
  .screen { container: settings / inline-size; }
  .tab-hint { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); margin: 0 0 var(--space-4); line-height: var(--line-height-body); }
  .setting.action { gap: var(--space-4); padding: var(--space-3) 0; }
  .setting.action .label { display: block; }
  .links { padding: 0; overflow: hidden; }
  .link-row { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: calc(var(--touch-size) + var(--space-2)); padding: 0 var(--space-4); text-align: start; border-bottom: var(--border-width) solid var(--color-border); }
  .link-row:last-child { border-bottom: 0; }
  .link-row > span { flex: 1; }
  .link-row:hover { background: var(--color-surface-2); }
  .link-row.danger { color: var(--color-danger); }

  .setting-hint { display: block; margin-top: var(--space-1); font-size: calc(var(--font-size-xs) * var(--font-scale)); color: var(--color-text-muted); font-weight: normal; line-height: var(--line-height-body); }

  .new-badge { display: inline-block; margin-left: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); font-size: calc(var(--font-size-xs) * var(--font-scale)); font-weight: var(--font-weight-semibold); line-height: 1.6; vertical-align: middle; }
  .new-badge.beta-badge { background: var(--color-surface-3); color: var(--color-text); }
  .settings-section { margin-bottom: var(--space-6); }
  .settings-section header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  h2 { font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .group { background: var(--color-surface-1); border-radius: var(--radius-m); padding: 0 var(--space-4); }
  .setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: calc(var(--touch-size) + var(--space-4)); border-bottom: var(--border-width) solid var(--color-border); }
  .setting:last-child { border-bottom: 0; }
  .setting-label { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex: 1; }
  label { font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  .slider { flex-direction: column; align-items: stretch; padding: var(--space-4) 0 var(--space-2); gap: var(--space-1); }
  output { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); }
  input[type='range'] { width: 100%; min-height: var(--touch-size); margin: 0; }
  input[type='text'] { border: 0; background: var(--color-clear); width: 44%; min-height: var(--touch-size); font-size: calc(var(--font-size-s) * var(--font-scale)); text-align: end; }
  .switch-hit { min-height: var(--touch-size); min-width: var(--touch-size); display: flex; align-items: center; justify-content: end; }
  .switch { position: relative; width: var(--switch-width); height: var(--switch-height); background: var(--color-surface-3); border-radius: var(--radius-full); transition: opacity var(--motion-general-duration); }
  .switch i { position: absolute; left: var(--switch-inset); top: var(--switch-inset); width: var(--switch-knob); height: var(--switch-knob); border-radius: var(--radius-full); background: var(--color-text-muted); transform: translateX(0); transition: transform var(--motion-general-duration) var(--motion-general-easing); }
  .switch.on { background: var(--color-accent); }
  .switch.on i { background: var(--color-on-accent); transform: translateX(calc(var(--switch-width) - var(--switch-knob) - var(--switch-inset) * 2)); }
  .disabled label { opacity: var(--opacity-disabled); }
  .hint { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); line-height: var(--line-height-body); margin: var(--space-5) 0; }
  footer { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); margin-top: var(--space-8); color: var(--color-text-muted); }
  footer button { color: var(--color-text); font-size: calc(var(--font-size-m) * var(--font-scale)); }
  footer span { font-size: calc(var(--font-size-xs) * var(--font-scale)); }
</style>
