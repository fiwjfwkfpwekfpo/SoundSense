<script lang="ts">
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  import { choiceKey } from './loader';
  import type { AppearanceAxis } from './schema';
  let { axis }: { axis: AppearanceAxis } = $props();
  const ui = useModel();
  let selection = $derived(axis === 'style' ? { id: ui.appearance.selection.style, source: 'manual' } : axis === 'colors' ? ui.appearance.selection.colors : ui.appearance.selection.motion.common);
</script>
<div class="appearance-control">
  <button aria-label={ui.t(`appearance.axis.${axis}`)} aria-haspopup="dialog" onclick={() => ui.nav.sheet({ kind: 'appearance', axis })}><span>{ui.t(selection.id === 'custom' ? 'appearance.custom' : `appearance.${axis}.${selection.id}`)}</span><Icon name="chevron-right" size="s" /></button>
  {#if axis !== 'style'}<div class="source"><small>{ui.t(`appearance.source.${selection.source}`)}</small>{#if selection.source === 'manual'}<button class="restore" aria-label={ui.t('appearance.restoreAxis', { axis: ui.t(`appearance.axis.${axis}`) })} onclick={() => ui.settings.set(choiceKey(axis), 'auto')}>{ui.t('appearance.restore')}</button>{/if}</div>{/if}
</div>
<style>
  .appearance-control { min-width: 0; max-width: 72%; padding: var(--space-2) 0; }
  button { display: flex; gap: var(--space-2); align-items: center; justify-content: end; width: 100%; border-radius: var(--radius-s); color: var(--color-text); font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .source { display: flex; gap: var(--space-2); align-items: center; justify-content: end; flex-wrap: wrap; }
  small { font-size: var(--font-size-xs); color: var(--color-text-muted); }
  .restore { min-height: var(--touch-size); width: auto; font-size: var(--font-size-xs); color: var(--color-text-muted); text-decoration: underline; }
</style>
