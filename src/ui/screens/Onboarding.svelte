<script lang="ts">
  import { useModel } from '../context.svelte';
  import { colors } from '../appearance/presets';
  import AppearancePreview from '../appearance/AppearancePreview.svelte';
  import Button from '../components/Button.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let step = $state<'colors' | 'home' | 'import' | 'sync'>('colors');
  // Another device already has a SoundSense profile: link to it by code and take its library and settings.
  let code = $state(''), sync = $state(ui.api.sync?.getSnapshot());
  $effect(() => { const api = ui.api.sync; if (!api) return; return api.subscribe(value => { sync = value; if (step === 'sync' && value.linked && !value.joining) choose(); }); });
  const charts = [['chartYa', 'source.ya'], ['chartSpotify', 'source.spotify'], ['chartSc', 'source.sc']] as const;
  let selection = $derived(ui.appearance.selection.colors.id);
  function next() { step = step === 'colors' ? 'home' : 'import'; }
  function choose(source?: string) { ui.settings.set('onboardingDone', true); if (source) ui.nav.go({ name: 'import', source }); }
</script>
<section class="onboarding" aria-label={ui.t(step === 'colors' ? 'onboarding.colors' : step === 'home' ? 'onboarding.home' : step === 'sync' ? 'onboarding.syncProfile' : 'onboarding.import')} data-testid={`onboarding-${step}`}>
  {#if step === 'colors'}
  <div class="intro"><span class="eyebrow">{ui.t('app.name')} · 1 / 3</span><h1>{ui.t('onboarding.colors')}</h1><p>{ui.t('onboarding.colorsHint')}</p></div>
  <div class="live-preview" aria-label={ui.t('onboarding.preview')}><AppearancePreview locale={ui.locale} style={ui.appearance.style} colors={ui.appearance.colors} title={ui.t('nav.home')} trackLabel={ui.track?.title ?? ''} /></div>
  <div class="palette-grid" role="listbox" aria-label={ui.t('onboarding.colors')}>{#each Object.entries(colors) as [id, pack]}<button role="option" aria-selected={selection === id} aria-label={ui.t(`appearance.colors.${id}`)} class:selected={selection === id} onclick={() => ui.settings.set('appearanceColors', id)}><span class="palette-swatches" style:background={pack.palette.mainBg}><i style:background={pack.palette.cardHover}></i><b style:background={pack.palette.accent}></b></span><span>{ui.t(`appearance.colors.${id}`)}</span></button>{/each}</div>
  <div class="onboarding-actions"><Button wide onclick={next}>{ui.t('onboarding.next')}</Button><Button variant="ghost" wide onclick={next}>{ui.t('onboarding.skip')}</Button></div>
  {:else if step === 'home'}
  <div class="intro"><span class="eyebrow">{ui.t('app.name')} · 2 / 3</span><h1>{ui.t('onboarding.home')}</h1><p>{ui.t('onboarding.homeHint')}</p></div>
  <div class="home-options">
    <label class="option"><span>{ui.t('onboarding.recommendationsTitle')}</span><input type="checkbox" role="switch" checked={ui.settings.values.recommendations !== false} onchange={event => ui.settings.set('recommendations', event.currentTarget.checked)} /></label>
    <label class="option"><span>{ui.t('onboarding.chartsTitle')}</span><input type="checkbox" role="switch" checked={ui.settings.values.charts !== false} onchange={event => ui.settings.set('charts', event.currentTarget.checked)} /></label>
    {#if ui.settings.values.charts !== false}<div class="chips" role="group" aria-label={ui.t('onboarding.chartsTitle')}>{#each charts as [key, label]}<button class="chip" class:active={ui.settings.values[key] !== false} aria-pressed={ui.settings.values[key] !== false} onclick={() => ui.settings.set(key, ui.settings.values[key] === false)}>{ui.t(label)}</button>{/each}</div>{/if}
  </div>
  <div class="onboarding-actions"><Button wide onclick={next}>{ui.t('onboarding.next')}</Button><Button variant="ghost" wide onclick={next}>{ui.t('onboarding.skip')}</Button></div>
  {:else if step === 'import'}
  <div class="intro"><span class="eyebrow">{ui.t('app.name')} · 3 / 3</span><h1>{ui.t('onboarding.import')}</h1><p>{ui.t('onboarding.importHint')}</p></div>
  <div class="sources">{#if ui.api.sync}<button class="profile" onclick={() => { step = 'sync'; code = ''; }}><Icon name="share" /><span>{ui.t('onboarding.syncProfile')}<small>{ui.t('onboarding.syncProfileHint')}</small></span><Icon name="chevron-right" size="s" /></button>{/if}{#each ui.api.extensions.imports.list() as provider}{@const source = provider.id}<button onclick={() => choose(source)}><Icon name={source === 'local' ? 'folder' : 'music'} /><span>{ui.t(`source.${source}`)}</span><Icon name="chevron-right" size="s" /></button>{/each}</div>
  <Button variant="ghost" wide onclick={() => choose()}>{ui.t('onboarding.skip')}</Button>
  {:else}
  <div class="intro"><span class="eyebrow">{ui.t('app.name')} · 3 / 3</span><h1>{ui.t('onboarding.syncProfile')}</h1><p>{ui.t('onboarding.syncSteps')}</p></div>
  <form class="join" onsubmit={event => { event.preventDefault(); void ui.api.sync?.join(code); }}>
    <label for="onboarding-code">{ui.t('sync.codeInput')}</label>
    <input id="onboarding-code" autocomplete="off" spellcheck="false" maxlength="9" placeholder="K7M2-9QXP" bind:value={code} />
    {#if sync?.joining && 'error' in sync.joining}<p role="alert">{ui.t(sync.joining.error)}</p>{/if}
    <Button wide type="submit" disabled={!!sync?.joining && 'busy' in sync.joining}>{ui.t(sync?.joining && 'busy' in sync.joining ? 'sync.joining' : 'sync.join')}</Button>
    <Button variant="ghost" wide onclick={() => step = 'import'}>{ui.t('nav.back')}</Button>
  </form>
  {/if}
</section>
<style>
  .onboarding { position: absolute; inset: 0; z-index: var(--z-overlay); padding: calc(var(--space-8) + var(--inset-top)) calc(var(--space-6) + var(--inset-right)) calc(var(--space-6) + var(--inset-bottom)) calc(var(--space-6) + var(--inset-left)); background: var(--color-bg); overflow-y: auto; display: flex; flex-direction: column; }
  .live-preview { margin-top: var(--space-5); }
  .profile span { display: grid; gap: var(--space-1); }
  .profile small { color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); line-height: var(--line-height-body); }
  .join { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
  .join label { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .join input { min-height: var(--touch-size); padding: 0 var(--space-3); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); font-size: calc(var(--font-size-l) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); text-transform: uppercase; }
  .join [role='alert'] { color: var(--color-danger); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .live-preview :global(.preview) { height: 210px; transition: background var(--motion-general-duration), color var(--motion-general-duration); }
  .palette-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin: var(--space-5) 0; }
  .palette-grid button { display: grid; gap: var(--space-2); text-align: start; background: var(--color-surface-1); padding: var(--space-3); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .palette-grid button.selected { outline: var(--focus-width) solid var(--color-accent); }
  .palette-swatches { height: var(--cover-row); display: flex; align-items: end; justify-content: space-between; border-radius: var(--radius-s); padding: var(--space-2); }
  .palette-swatches i { width: 55%; height: 70%; border-radius: var(--radius-s); } .palette-swatches b { width: var(--space-5); height: var(--space-5); border-radius: var(--radius-full); }
  .onboarding-actions { margin-top: auto; }
  h1 { font-size: calc(var(--font-size-hero) * var(--font-scale)); line-height: var(--line-height-tight); margin: var(--space-5) 0 var(--space-4); }
  p { color: var(--color-text-muted); font-size: calc(var(--font-size-m) * var(--font-scale)); line-height: var(--line-height-body); }
  .home-options { display: grid; gap: var(--space-3); margin: var(--space-7) 0; }
  .option { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4); background: var(--color-surface-1); border-radius: var(--radius-m); min-height: var(--track-height); font-size: calc(var(--font-size-m) * var(--font-scale)); }
  .option input { width: var(--space-6); height: var(--space-6); accent-color: var(--color-accent); }
  .sources { display: grid; gap: var(--space-3); margin: var(--space-7) 0; flex: 1; align-content: start; }
  .sources button { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4); background: var(--color-surface-1); border-radius: var(--radius-m); min-height: var(--track-height); text-align: start; }
  .sources span { flex: 1; }
</style>
