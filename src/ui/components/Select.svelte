<script lang="ts">
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  const uid = $props.id();
  let { id = uid, value, options, label, onchange, compact = false, icon = 'chevron-down', disabled = false }: {
    id?: string; value: string; options: readonly { value: string; label: string }[]; label: string;
    onchange: (value: string) => void; compact?: boolean; icon?: IconName; disabled?: boolean;
  } = $props();
  const ui = useModel();
  let open = $derived(ui.nav.state.sheet?.kind === 'select' && ui.nav.state.sheet.id === uid);
</script>
<button {id} class="picker" class:compact aria-label={label} aria-haspopup="dialog" aria-expanded={open} {disabled} onclick={() => ui.nav.sheet({ kind: 'select', id: uid, title: label, options, value, onselect: onchange })}>
  {#if !compact}<span>{options.find(option => option.value === value)?.label}</span>{/if}<Icon name={icon} size="s" />
</button>
<style>
  .picker { display: flex; align-items: center; justify-content: end; gap: var(--space-2); min-height: var(--touch-size); min-width: var(--touch-size); border-radius: var(--radius-s); color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .compact { width: var(--touch-size); height: var(--touch-size); justify-content: center; border-radius: var(--radius-full); background: var(--color-surface-1); }
</style>
