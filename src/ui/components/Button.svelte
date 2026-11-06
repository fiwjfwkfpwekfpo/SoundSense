<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, onclick, variant = 'primary', disabled = false, label, wide = false, type }: {
    children: Snippet; onclick?: (event: MouseEvent) => void; variant?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; label?: string; wide?: boolean; type?: 'button' | 'submit' | 'reset';
  } = $props();
</script>
<button class={variant} class:wide {onclick} {disabled} {type} aria-label={label}>{@render children()}</button>
<style>
  button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--touch-size); padding: var(--space-3) var(--space-5); border-radius: var(--radius-full); font-size: calc(var(--font-size-body) * var(--font-scale)); font-weight: var(--font-weight-semibold); }
  .primary { color: var(--color-on-accent); background: var(--color-accent); }
  .secondary { background: var(--color-surface-2); }
  .ghost { color: var(--color-text-muted); }
  .wide { width: 100%; }
</style>
