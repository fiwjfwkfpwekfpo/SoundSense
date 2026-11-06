<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useModel } from '../context.svelte';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';
  let { children }: { children: Snippet } = $props();
  const ui = useModel(); let delayed = $state(false);
  let route = $derived(ui.nav.state.route.name);
  let covered = $derived(!['settings', 'import'].includes(route));
  $effect(() => { if (!ui.environment?.loading) { delayed = false; return; } const timer = setTimeout(() => delayed = true, 150); return () => clearTimeout(timer); });
</script>
{#if covered && ui.environment?.error}<section class="screen"><EmptyState title={ui.t('state.error')} description={ui.t('state.errorHint')} /><Button wide onclick={() => ui.api.environment.retry()}>{ui.t('state.retry')}</Button></section>
{:else if covered && delayed}<section class="screen skeleton" aria-label={ui.t('state.loading')} aria-busy="true" data-testid="skeleton"><div class="heading"></div>{#if ['home', 'playlist', 'liked', 'artist'].includes(route)}<div class="hero"></div>{/if}{#each Array(7) as _}<div class="row"><i></i><span><b></b><b></b></span></div>{/each}</section>
{:else}{@render children()}{/if}
<style>
  .skeleton .heading, .skeleton .hero, .skeleton i, .skeleton b { display: block; background: var(--color-surface-2); border-radius: var(--radius-s); animation: breathe 1.2s ease-in-out infinite alternate; }
  .heading { height: var(--space-8); width: 60%; margin-bottom: var(--space-6); }
  .hero { height: var(--hero-height); margin-bottom: var(--space-5); }
  .row { display: flex; align-items: center; gap: var(--space-3); height: var(--track-height); }
  i { width: var(--cover-row); height: var(--cover-row); }
  span { flex: 1; display: grid; gap: var(--space-2); }
  b { width: 85%; height: var(--space-3); } b:last-child { width: 55%; }
  @keyframes breathe { to { opacity: var(--opacity-muted); } }
</style>
