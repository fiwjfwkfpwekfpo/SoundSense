<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import Button from '../components/Button.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { PluginNode, PluginScreen } from '../../core/plugins/types';
  /** A plugin's own screen: its data drawn with the app's components, style and colours. */
  let { id }: { id: string } = $props();
  const ui = useModel();
  let revision = $state(0);
  let screen = $derived.by((): PluginScreen | undefined => { void revision; return ui.api.plugins?.getScreen(id); });
  let plugin = $derived.by(() => { void revision; return ui.api.plugins?.getSnapshot().find(item => item.manifest.id === id); });
  let busy = $state(false);
  onMount(() => { const a = ui.api.plugins?.subscribeScreens(() => revision++), b = ui.api.plugins?.subscribe(() => revision++); return () => { a?.(); b?.(); }; });
  async function act(action: string, value?: string | boolean) {
    if (!ui.api.plugins || busy) return;
    busy = true;
    try { await ui.api.plugins.act(id, action, value); }
    catch (error) { ui.notify('plugins.actionFailed', { error: error instanceof Error ? error.message : String(error) }); }
    finally { busy = false; }
  }
</script>
{#snippet nodes(list: readonly PluginNode[])}
  {#each list as node}
    {#if node.type === 'section'}<section class="section">{#if node.title}<h2>{node.title}</h2>{/if}<div class="group">{@render nodes(node.children)}</div></section>
    {:else if node.type === 'text'}<p class:muted={node.muted}>{node.text}</p>
    {:else if node.type === 'row'}{#if node.action}<button class="row" disabled={busy} onclick={() => act(node.action!)}><span><strong>{node.title}</strong>{#if node.subtitle}<small>{node.subtitle}</small>{/if}</span><Icon name="chevron-right" size="s" /></button>{:else}<div class="row"><span><strong>{node.title}</strong>{#if node.subtitle}<small>{node.subtitle}</small>{/if}</span></div>{/if}
    {:else if node.type === 'button'}<div class="button"><Button wide variant={node.variant === 'secondary' ? 'secondary' : undefined} disabled={busy} onclick={() => act(node.action)}>{node.title}</Button></div>
    {:else if node.type === 'toggle'}<button class="row" role="switch" aria-checked={node.value} disabled={busy} onclick={() => act(node.action, !node.value)}><span><strong>{node.label}</strong></span><span class="switch" class:on={node.value}><i></i></span></button>
    {:else if node.type === 'input'}<label class="field"><span>{node.label}</span><input value={node.value} placeholder={node.placeholder} disabled={busy} onchange={event => act(node.action, event.currentTarget.value)} /></label>
    {:else if node.type === 'empty'}<p class="muted center">{node.text}</p>{/if}
  {/each}
{/snippet}
<section class="screen" aria-label={screen?.title ?? plugin?.manifest.name ?? ''} data-plugin-screen={id}>
  <header class="screen-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{screen?.title ?? plugin?.manifest.name ?? ''}</h1><span></span></header>
  {#if screen}{@render nodes(screen.content)}
  {:else}<EmptyState title={ui.t(plugin?.status === 'running' ? 'plugins.noScreen' : 'plugins.notRunning')} description={plugin?.manifest.name ?? id} />{/if}
</section>
<style>
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); }
  p { font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); margin: var(--space-3) 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .muted { color: var(--color-text-muted); }
  .center { text-align: center; margin: var(--space-8) 0; }
  .section { margin: var(--space-5) 0; }
  h2 { font-size: calc(var(--font-size-m) * var(--font-scale)); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-3); }
  .group { background: var(--color-surface-1); border-radius: var(--radius-m); padding: 0 var(--space-4); }
  .group > p { padding: var(--space-1) 0; }
  .row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: calc(var(--touch-size) + var(--space-2)); text-align: start; border-bottom: var(--border-width) solid var(--color-border); }
  .group > :last-child { border-bottom: 0; }
  .row span:first-child { display: flex; flex-direction: column; min-width: 0; }
  .row strong { font-size: calc(var(--font-size-sm) * var(--font-scale)); font-weight: var(--font-weight-semibold); overflow-wrap: anywhere; }
  .row small { margin-top: var(--space-1); color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .button { margin: var(--space-3) 0; }
  .field { display: grid; gap: var(--space-1); margin: var(--space-3) 0; font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .field input { min-height: var(--touch-size); padding: 0 var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-s); background: var(--color-bg); color: var(--color-text); }
  .switch { position: relative; flex-shrink: 0; width: var(--switch-width); height: var(--switch-height); background: var(--color-surface-3); border-radius: var(--radius-full); }
  .switch i { position: absolute; left: var(--switch-inset); top: var(--switch-inset); width: var(--switch-knob); height: var(--switch-knob); border-radius: var(--radius-full); background: var(--color-text-muted); transition: transform var(--motion-general-duration) var(--motion-general-easing); }
  .switch.on { background: var(--color-accent); }
  .switch.on i { background: var(--color-on-accent); transform: translateX(calc(var(--switch-width) - var(--switch-knob) - var(--switch-inset) * 2)); }
</style>
