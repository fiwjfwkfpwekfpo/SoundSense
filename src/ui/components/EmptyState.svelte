<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  let { title, description, icon = 'music' }: { title: string; description: string; icon?: IconName } = $props();
</script>
<div class="empty"><span class="symbol"><Icon name={icon} size="l" /></span><h2>{title}</h2><p>{description}</p></div>
<style>
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: var(--empty-min-height); padding: var(--space-8) var(--space-4); text-align: center; }
  .symbol { display: grid; place-items: center; width: var(--empty-icon-size); height: var(--empty-icon-size); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-l); color: var(--color-text-muted); margin-bottom: var(--space-5); }
  h2 { font-size: calc(var(--font-size-xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); }
  p { font-size: calc(var(--font-size-m) * var(--font-scale)); color: var(--color-text-muted); line-height: var(--line-height-body); margin-top: var(--space-3); }
</style>
