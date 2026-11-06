<script lang="ts">
  import { useModel } from '../context.svelte';
  import { audioPresets, normalAudio } from '../../core/audio-settings';
  import type { AudioProcessing } from '../../core/audio-settings';
  import Button from './Button.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let name = $state(''), saving = $state(false);
  let id = $derived(ui.track?.id);
  let only = $derived(!!id && !!ui.audioState && Object.hasOwn(ui.audioState.tracks, id));
  let values = $derived((only && id ? ui.audioState?.tracks[id] : ui.audioState?.global) ?? normalAudio);
  const sliders: { key: keyof AudioProcessing; min: number; max: number; step: number }[] = [
    { key: 'speed', min: .5, max: 2, step: .01 }, { key: 'speedPitch', min: .5, max: 2, step: .01 }, { key: 'pitch', min: -12, max: 12, step: 1 }, { key: 'volume', min: 0, max: 2, step: .01 },
  ];
  function formatted(key: keyof AudioProcessing, value: number) { return key === 'pitch' ? `${value > 0 ? '+' : ''}${value} ${ui.t('audio.semitones')}` : key === 'volume' ? `${Math.round(value * 100)}%` : `${value.toFixed(2)}×`; }
</script>
<div class="audio-settings" data-testid="audio-settings">
  <div class="top">
    <div class="scope" role="group" aria-label={ui.t('audio.scope')}>
      <button class:active={!only} aria-pressed={!only} onclick={() => { if (id) ui.api.audioSettings?.trackOnly(id, false); }}>{ui.t('audio.all')}</button>
      <button class:active={only} aria-pressed={only} disabled={!id} onclick={() => { if (id) ui.api.audioSettings?.trackOnly(id, true); }}>{ui.t('audio.track')}</button>
    </div>
    <button class="reset" onclick={() => ui.api.audioSettings?.reset(only ? id : undefined)}>{ui.t('audio.resetShort')}</button>
  </div>
  <div class="presets" role="group" aria-label={ui.t('audio.presets')}>
    {#each [...audioPresets, ...(ui.audioState?.presets ?? [])] as preset}
      <span class="chip" class:active={Object.entries(preset.values).every(([key, value]) => values[key as keyof AudioProcessing] === value)}><button onclick={() => ui.api.audioSettings?.preset(preset, only ? id : undefined)}>{preset.label ? ui.t(preset.label) : preset.name}</button>{#if !preset.label}<button class="remove" aria-label={ui.t('audio.deletePreset', { name: preset.name ?? '' })} onclick={() => ui.api.audioSettings?.removePreset(preset.id)}><Icon name="close" size="s" /></button>{/if}</span>
    {/each}
    {#if !saving}<span class="chip add"><button onclick={() => saving = true}><Icon name="plus" size="s" />{ui.t('audio.savePreset')}</button></span>{/if}
  </div>
  {#if saving}<form class="save" onsubmit={event => { event.preventDefault(); ui.api.audioSettings?.savePreset(name, only ? id : undefined); name = ''; saving = false; }}><input bind:value={name} maxlength="40" aria-label={ui.t('audio.presetName')} placeholder={ui.t('audio.presetName')} /><Button type="submit" variant="secondary" disabled={!name.trim()}>{ui.t('audio.save')}</Button></form>{/if}
  <div class="sliders">
  {#each sliders as slider}<label class="slider"><span class="name">{ui.t(`audio.${slider.key}`)}</span><output>{formatted(slider.key, values[slider.key])}</output><input type="range" min={slider.min} max={slider.max} step={slider.step} value={values[slider.key]} style:--fill={`${(values[slider.key] - slider.min) / (slider.max - slider.min) * 100}%`} aria-label={ui.t(`audio.${slider.key}`)} oninput={event => ui.api.audioSettings?.set(slider.key, Number(event.currentTarget.value), only ? id : undefined)} ondblclick={() => ui.api.audioSettings?.set(slider.key, normalAudio[slider.key], only ? id : undefined)} /></label>{/each}
  </div>
</div>
<style>
  .audio-settings { display: grid; gap: var(--space-4); padding-bottom: var(--space-2); }
  .top { display: flex; align-items: center; gap: var(--space-3); }
  .scope { flex: 1; display: flex; padding: calc(var(--space-1) / 2); border-radius: var(--radius-full); background: var(--color-surface-2); }
  .scope button { flex: 1; min-height: calc(var(--touch-size) - var(--space-3)); border-radius: inherit; font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .scope .active { background: var(--color-surface-3); color: var(--color-text); }
  .reset { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); padding: var(--space-2); }
  .presets { display: flex; gap: var(--space-2); overflow-x: auto; scrollbar-width: none; margin: 0 calc(-1 * var(--space-1)); padding: 0 var(--space-1); }
  .chip { display: inline-flex; align-items: center; flex-shrink: 0; border-radius: var(--radius-full); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); }
  .chip button { display: inline-flex; align-items: center; gap: var(--space-1); min-height: calc(var(--touch-size) - var(--space-3)); padding: 0 var(--space-3); white-space: nowrap; font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .chip .remove { padding: 0 var(--space-2) 0 0; color: var(--color-text-muted); }
  .chip.active { background: var(--color-accent); color: var(--color-on-accent); border-color: transparent; }
  .chip.add { color: var(--color-text-muted); border-style: dashed; background: none; }
  .save { display: flex; gap: var(--space-2); }
  .save input { flex: 1; min-width: 0; min-height: var(--touch-size); padding: 0 var(--space-3); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); }
  .sliders { display: grid; gap: var(--space-3); }
  .slider { display: grid; grid-template-columns: 1fr auto; row-gap: var(--space-1); align-items: center; }
  .name { font-size: calc(var(--font-size-s) * var(--font-scale)); }
  output { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); font-variant-numeric: tabular-nums; }
  input[type='range'] { grid-column: 1 / -1; width: 100%; height: var(--space-1); appearance: none; border-radius: var(--radius-full); background: linear-gradient(90deg, var(--color-accent) var(--fill), var(--color-surface-3) var(--fill)); margin: var(--space-2) 0; cursor: pointer; }
  input[type='range']::-webkit-slider-thumb { appearance: none; width: calc(var(--space-4) + 2px); height: calc(var(--space-4) + 2px); border-radius: var(--radius-full); background: var(--color-text); box-shadow: var(--shadow-nav); }
</style>
