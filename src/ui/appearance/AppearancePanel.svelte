<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { useModel } from '../context.svelte';
  import Button from '../components/Button.svelte';
  import Select from '../components/Select.svelte';
  import Icon from '../icons/Icon.svelte';
  import AppearancePreview from './AppearancePreview.svelte';
  import { colors, motions, styles } from './presets';
  import { baseKey, choiceKey, customKey, groupKey } from './loader';
  import { appearanceSchema, motionGroups, motionRegistry, paletteRoles, styleTokens } from './schema';
  import type { AppearanceAxis, AppearancePacks, MotionGroup, StyleToken } from './schema';
  import { parsePack, parseEasing } from './validate';
  import { runPreview } from './motion/runtime';
  let { axis: requestedAxis }: { axis: AppearanceAxis } = $props();
  // Select callbacks outlive this panel while its nested sheet is mounted.
  const axis = untrack(() => requestedAxis);
  const ui = useModel();
  const registries = { style: styles, colors, motion: motions };
  let editor = $derived(ui.appearanceEditors[axis]);
  let fileInput: HTMLInputElement; let panel: HTMLDivElement;
  const previewNodes: Partial<Record<MotionGroup, HTMLElement>> = {};
  let selection = $derived(axis === 'style' ? ui.appearance.selection.style : axis === 'colors' ? ui.appearance.selection.colors.id : ui.appearance.selection.motion.common.id);
  let pack = $derived(ui.appearance[axis]);
  let base = $derived(String(ui.settings.values[baseKey(axis)]));
  const editableStyle: StyleToken[] = ['radiusS', 'radiusM', 'radiusL', 'radiusXl', 'radiusFull', 'fontBody', 'fontDisplay', 'fontMono', 'fontBodySize', 'fontM', 'fontSm', 'fontHero', 'borderWidth', 'blurNav', 'listDensity', 'shadowStrength'];
  $effect(() => { const current = pack; if (!editor.editing) editor.draft = JSON.stringify(current, null, 2); });
  onMount(() => {
    const host = panel.closest<HTMLElement>('.sheet-body'); if (!host) return;
    host.scrollTop = editor.scrollTop;
    const remember = () => { editor.scrollTop = host.scrollTop; };
    host.addEventListener('scroll', remember, { passive: true });
    return () => host.removeEventListener('scroll', remember);
  });
  function choose(id: string) {
    if (id === 'custom') { edit(); return; }
    ui.settings.set(choiceKey(axis), id); editor.editing = false; editor.error = '';
  }
  function edit() {
    if (selection !== 'custom') ui.settings.setMany({ [baseKey(axis)]: selection, [customKey(axis)]: JSON.stringify(pack), [choiceKey(axis)]: 'custom' });
    editor.editing = true; editor.error = ''; editor.draft = JSON.stringify(pack, null, 2);
    editor.scrollTop = 0; const host = panel.closest<HTMLElement>('.sheet-body'); if (host) host.scrollTop = 0;
  }
  function apply(input: unknown, keepText = false) {
    try {
      const next = parsePack(axis, input);
      ui.settings.setMany({ ...(selection !== 'custom' ? { [baseKey(axis)]: selection } : {}), [customKey(axis)]: JSON.stringify(next), [choiceKey(axis)]: 'custom' });
      editor.error = ''; if (!keepText) editor.draft = JSON.stringify(next, null, 2);
    } catch (cause) { editor.error = `${ui.t('appearance.invalid')} ${cause instanceof Error ? cause.message : ''}`; }
  }
  function change(section: 'palette' | 'tokens' | 'groups', key: string, value: unknown) {
    const data = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
    data[section] = { ...(data[section] as Record<string, unknown>), [key]: value }; apply(data);
  }
  function reset() { const data = registries[axis][base] ?? Object.values(registries[axis])[0]!; apply(data); }
  async function importFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
    try { if (file.size > 100000) throw new Error('file too large'); const text = await file.text(); editor.draft = text; apply(JSON.parse(text)); editor.editing = true; }
    catch (cause) { editor.error = `${ui.t('appearance.invalid')} ${cause instanceof Error ? cause.message : ''}`; }
    fileInput.value = '';
  }
  async function exportPack() {
    try { const result = await ui.api.files.saveJson(`${axis}.json`, JSON.stringify(pack, null, 2)); if (result === 'saved') ui.notify('appearance.exported'); }
    catch { editor.error = ui.t('appearance.exportFailed'); }
  }
  function preview(node: HTMLElement, group: MotionGroup) { previewNodes[group] = node; return { destroy() { delete previewNodes[group]; } }; }
  function motionEdit(group: MotionGroup, field: string, value: unknown) { const current = ui.appearance.motion.groups[group]; change('groups', group, { ...current, [field]: value }); }
  function editEasing(group: MotionGroup, text: string) {
    try { motionEdit(group, 'easing', parseEasing(text.startsWith('[') ? JSON.parse(text) : text)); } catch { editor.error = ui.t('appearance.invalidEasing'); }
  }
  function cardKey(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + items.length) % items.length;
    items[target]?.focus();
  }
</script>
<div bind:this={panel} class="appearance-panel" data-testid={`appearance-${axis}`}>
  {#if !editor.editing}
    <div class:cards={axis !== 'motion'} class="presets" role="listbox" aria-label={ui.t(`appearance.axis.${axis}`)} tabindex="0" onkeydown={cardKey}>
      {#each Object.entries(registries[axis]) as [id]}
        <button class="preset" class:selected={selection === id} role="option" aria-selected={selection === id} aria-label={ui.t(`appearance.${axis}.${id}`)} onclick={() => choose(id)}>
          {#if axis === 'style'}<AppearancePreview locale={ui.locale} style={styles[id]!} colors={ui.appearance.colors} />{:else if axis === 'colors'}<AppearancePreview locale={ui.locale} style={ui.appearance.style} colors={colors[id]!} /><div class="swatches" aria-hidden="true">{#each ['mainBg', 'cardHover', 'accent', 'textMuted'] as role}<i style:background={colors[id]!.palette[role as keyof typeof colors[string]['palette']]}></i>{/each}</div>{/if}
          <span>{ui.t(`appearance.${axis}.${id}`)}{#if selection === id}<Icon name="check" size="s" />{/if}</span>
        </button>
      {/each}
      <button class="preset custom" class:selected={selection === 'custom'} role="option" aria-selected={selection === 'custom'} onclick={() => choose('custom')}><span>{ui.t('appearance.custom')}<Icon name="sliders" size="s" /></span></button>
    </div>
    {#if axis !== 'style'}<div class="provenance"><span>{ui.t(`appearance.source.${axis === 'colors' ? ui.appearance.selection.colors.source : ui.appearance.selection.motion.common.source}`)}</span><button onclick={() => ui.settings.set(choiceKey(axis), 'auto')}>{ui.t('appearance.restore')}</button></div>{/if}
    {#if axis === 'motion'}
      <label class="speed" for="motion-speed"><span>{ui.t('appearance.speed')}<output>{Number(ui.settings.values.motionSpeed).toFixed(1)}×</output></span><input id="motion-speed" type="range" min={appearanceSchema.speed.min} max={appearanceSchema.speed.max} step={appearanceSchema.speed.step} value={Number(ui.settings.values.motionSpeed)} oninput={event => ui.settings.set('motionSpeed', Number(event.currentTarget.value))} /></label>
      {#each motionGroups as group}<section class="motion-group"><div class="group-heading"><h3>{ui.t(`appearance.group.${group}`)}</h3><button class="play-preview icon-button" aria-label={ui.t('appearance.previewGroup', { group: ui.t(`appearance.group.${group}`) })} onclick={() => { const node = previewNodes[group]; if (node) runPreview(node, group); }}><Icon name="play" size="s" /></button></div><Select label={ui.t('appearance.groupPreset', { group: ui.t(`appearance.group.${group}`) })} value={String(ui.settings.values[groupKey(group)])} options={[{ value: 'auto', label: ui.t('appearance.inherit') }, ...Object.keys(motions).map(id => ({ value: id, label: ui.t(`appearance.motion.${id}`) }))]} onchange={value => ui.settings.set(groupKey(group), value)} /><small>{ui.t(`appearance.source.${ui.appearance.selection.motion.groups[group].source}`)} · {ui.t(`appearance.effectName.${ui.appearance.groups[group].effect}`)}</small>{#if ui.settings.values[groupKey(group)] !== 'auto'}<button class="restore-group" aria-label={ui.t('appearance.restoreGroup', { group: ui.t(`appearance.group.${group}`) })} onclick={() => ui.settings.set(groupKey(group), 'auto')}>{ui.t('appearance.inherit')}</button>{/if}<div class="preview-stage"><div class="motion-sample" data-motion-group={group} use:preview={group}>{#if group === 'waveform'}<div class="sample-wave">{#each [12, 22, 34, 18, 42, 28, 44, 20, 30, 38, 16, 24] as size}<i style:height={`${size}px`}></i>{/each}</div>{:else if group === 'cover'}<div class="sample-cover"></div>{:else if group === 'lyrics'}<strong>{ui.t('appearance.sampleLyrics')}</strong>{:else if group === 'player'}<div class="sample-player"><i></i><span>▶</span></div>{:else}<strong>{ui.track?.title ?? ui.t('appearance.sampleTitle')}</strong>{/if}</div></div></section>{/each}
    {/if}
    <div class="tools"><Button variant="secondary" onclick={edit}>{ui.t('appearance.edit')}</Button><Button variant="secondary" onclick={exportPack}>{ui.t('appearance.export')}</Button></div>
  {:else}
    <button class="back" onclick={() => { editor.editing = false; editor.error = ''; }}><Icon name="chevron-left" size="s" />{ui.t('appearance.presets')}</button>
    <p class="hint">{ui.t('appearance.base', { name: ui.t(`appearance.${axis}.${base}`) })}</p>
    {#if axis === 'colors'}
      <div class="palette-editor">{#each paletteRoles as role}<div class="palette-role"><label for={`hex-${role}`}>{role}</label><input class="swatch" type="color" aria-label={ui.t('appearance.pickColor', { role })} value={ui.appearance.colors.palette[role].slice(0, 7)} oninput={event => change('palette', role, event.currentTarget.value)} /><input id={`hex-${role}`} class="hex" aria-label={ui.t('appearance.hex', { role })} spellcheck="false" value={ui.appearance.colors.palette[role]} onchange={event => change('palette', role, event.currentTarget.value)} /></div>{/each}</div>
      <div class="scheme"><span>{ui.t('appearance.scheme')}</span><Select label={ui.t('appearance.scheme')} value={ui.appearance.colors.scheme} options={['dark', 'light'].map(value => ({ value, label: ui.t(`appearance.scheme.${value}`) }))} onchange={value => apply({ ...pack, scheme: value })} /></div>
    {:else if axis === 'style'}
      {#each editableStyle as key}{@const definition = styleTokens[key]}<label class="token" for={`token-${key}`}><span>{ui.t(`appearance.token.${key}`)}{#if definition.type === 'number'}<output>{ui.appearance.style.tokens[key]}</output>{/if}</span>{#if definition.type === 'font'}<input id={`token-${key}`} type="text" value={String(ui.appearance.style.tokens[key])} onchange={event => change('tokens', key, event.currentTarget.value)} />{:else}<input id={`token-${key}`} type="range" min={definition.min} max={definition.max} step={definition.step ?? (definition.max <= 2 ? .01 : 1)} value={Number(ui.appearance.style.tokens[key])} oninput={event => change('tokens', key, Number(event.currentTarget.value))} />{/if}</label>{/each}
    {:else}
      {#each motionGroups as group}{@const current = ui.appearance.motion.groups[group]}<section class="motion-edit"><h3>{ui.t(`appearance.group.${group}`)}</h3><Select label={ui.t('appearance.effect', { group: ui.t(`appearance.group.${group}`) })} value={current.effect} options={motionRegistry[group].effects.map(value => ({ value, label: ui.t(`appearance.effectName.${value}`) }))} onchange={value => motionEdit(group, 'effect', value)} /><label class="token" for={`duration-${group}`}><span>{ui.t('appearance.duration')}<output>{current.duration} {ui.t('appearance.ms')}</output></span><input id={`duration-${group}`} type="range" min="0" max={motionRegistry[group].maxDuration} step="10" value={current.duration} oninput={event => motionEdit(group, 'duration', Number(event.currentTarget.value))} /></label><label class="token" for={`easing-${group}`}><span>{ui.t('appearance.easing')}</span><input id={`easing-${group}`} value={typeof current.easing === 'string' ? current.easing : JSON.stringify(current.easing)} onchange={event => editEasing(group, event.currentTarget.value)} /></label>{#if group === 'waveform'}<Select label={ui.t('appearance.progress')} value={current.progress ?? 'smooth'} options={['smooth', 'stepped'].map(value => ({ value, label: ui.t(`appearance.progress.${value}`) }))} onchange={value => motionEdit(group, 'progress', value)} />{/if}</section>{/each}
    {/if}
    <div class="tools"><Button variant="secondary" onclick={reset}>{ui.t('appearance.reset')}</Button><Button variant="secondary" onclick={exportPack}>{ui.t('appearance.export')}</Button></div>
    <label class="json-label" for={`json-${axis}`}>{ui.t('appearance.json')}</label><textarea id={`json-${axis}`} class="json" spellcheck="false" value={editor.draft} oninput={event => { editor.draft = event.currentTarget.value; try { apply(JSON.parse(editor.draft), true); } catch { editor.error = ui.t('appearance.invalid'); } }}></textarea>
  {/if}
  {#if editor.error}<p class="error" role="alert">{editor.error}</p>{/if}
  <input class="sr-only" bind:this={fileInput} type="file" accept=".json,application/json" aria-label={ui.t('appearance.import')} onchange={importFile} /><Button variant="secondary" wide onclick={() => fileInput.click()}>{ui.t('appearance.import')}</Button>
</div>
<style>
  .appearance-panel { padding-bottom: var(--space-1); }
  .presets { display: flex; flex-direction: column; gap: var(--space-2); }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .preset { border: var(--border-width) solid var(--color-border); background: var(--color-surface-2); border-radius: var(--radius-m); padding: var(--space-2); text-align: start; overflow: hidden; }
  .preset.selected { outline: var(--focus-width) solid var(--color-accent); outline-offset: calc(var(--focus-width) * -1); }
  .preset > span { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); min-height: var(--touch-size); font-size: var(--font-size-sm); }
  .swatches { display: flex; gap: var(--space-1); padding: var(--space-2) 0; } .swatches i { height: var(--space-3); flex: 1; border-radius: var(--radius-full); border: var(--border-width) solid var(--color-border); }
  .custom { grid-column: 1 / -1; }
  .provenance { display: flex; gap: var(--space-2); align-items: center; justify-content: space-between; color: var(--color-text-muted); font-size: var(--font-size-xs); margin-top: var(--space-3); }
  .provenance button { color: inherit; text-decoration: underline; border-radius: var(--radius-s); }
  .tools { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block: var(--space-4); }
  .tools :global(button) { flex: 1; }
  .back { display: flex; gap: var(--space-2); align-items: center; font-size: var(--font-size-sm); }
  .hint { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-block: var(--space-2) var(--space-4); }
  .palette-role { display: grid; grid-template-columns: 1fr var(--touch-size) 108px; align-items: center; gap: var(--space-2); min-height: calc(var(--touch-size) + var(--space-2)); border-bottom: var(--border-width) solid var(--color-border); }
  .palette-role label { font-family: var(--font-mono); font-size: var(--font-size-xs); overflow-wrap: anywhere; }
  input, textarea { background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-s); padding: var(--space-2); min-height: var(--touch-size); }
  .hex { width: 100%; font-family: var(--font-mono); font-size: var(--font-size-xs); }
  .swatch { width: var(--touch-size); height: var(--touch-size); padding: var(--space-1); }
  .scheme, .group-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
  .scheme { padding-top: var(--space-3); font-size: var(--font-size-sm); }
  .token, .speed { display: flex; flex-direction: column; gap: var(--space-1); padding-block: var(--space-3); }
  .token > span, .speed > span { display: flex; justify-content: space-between; gap: var(--space-2); font-size: var(--font-size-sm); }
  .token output, .speed output { color: var(--color-text-muted); }
  .token input { width: 100%; font-size: var(--font-size-xs); }
  input[type='range'] { width: 100%; margin: 0; padding: 0; }
  .motion-group, .motion-edit { border-top: var(--border-width) solid var(--color-border); padding-block: var(--space-3); }
  h3 { font-size: var(--font-size-m); }
  .restore-group { display: block; color: var(--color-text-muted); text-decoration: underline; font-size: var(--font-size-xs); border-radius: var(--radius-s); }
  .motion-group small { color: var(--color-text-muted); font-size: var(--font-size-xs); }
  .preview-stage { display: flex; justify-content: center; align-items: center; height: 76px; margin-top: var(--space-2); border-radius: var(--radius-s); background: var(--color-surface-2); overflow: hidden; }
  .motion-sample { display: grid; place-items: center; max-width: 100%; font-size: var(--font-size-sm); }
  .sample-cover { width: 56px; height: 56px; border-radius: var(--radius-s); background: linear-gradient(135deg, var(--palette-cardBg), var(--palette-accent), var(--palette-cardHover)); }
  .sample-wave { height: 48px; display: flex; align-items: center; gap: 3px; }
  .sample-wave i { width: 3px; background: var(--palette-accent); }
  .sample-player { display: flex; width: 150px; height: 54px; background: var(--palette-cardBg); border: var(--border-width) solid var(--palette-border); border-radius: var(--radius-m); padding: var(--space-2); gap: var(--space-2); align-items: center; }
  .sample-player i { width: 34px; height: 34px; background: var(--palette-cardHover); border-radius: var(--radius-s); }
  .sample-player span { margin-left: auto; color: var(--palette-accent); }
  .json-label { display: block; font-size: var(--font-size-sm); margin-bottom: var(--space-2); }
  .json { width: 100%; min-height: 180px; resize: vertical; font-family: var(--font-mono); font-size: var(--font-size-xs); line-height: var(--line-height-body); user-select: text; }
  .error { color: var(--palette-danger); border: var(--border-width) solid var(--palette-danger); border-radius: var(--radius-s); padding: var(--space-3); margin-block: var(--space-3); font-size: var(--font-size-xs); overflow-wrap: anywhere; }
</style>
