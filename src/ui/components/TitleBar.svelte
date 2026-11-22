<script lang="ts">
  import { onMount } from 'svelte';
  import { desktop } from '../../platform/desktop';
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  /* The desktop window is frameless: this strip moves it, its buttons minimise, maximise and close. */
  const ui = useModel();
  const controls = desktop?.window;
  let maximized = $state(controls?.maximized() ?? false);
  onMount(() => controls?.onMaximized(value => { maximized = value; }));
</script>
{#if controls}
  <header class="titlebar" data-testid="titlebar">
    <div class="buttons">
      <button aria-label={ui.t('window.minimize')} title={ui.t('window.minimize')} onclick={() => controls.minimize()}><Icon name="window-minimize" size="s" /></button>
      <button aria-label={ui.t(maximized ? 'window.restore' : 'window.maximize')} title={ui.t(maximized ? 'window.restore' : 'window.maximize')} onclick={() => controls.toggleMaximize()}><Icon name={maximized ? 'window-restore' : 'window-maximize'} size="s" /></button>
      <button class="close" aria-label={ui.t('window.close')} title={ui.t('window.close')} onclick={() => controls.close()}><Icon name="close" size="s" /></button>
    </div>
  </header>
{/if}
<style>
  .titlebar { position: absolute; z-index: calc(var(--z-toast) + 1); top: 0; left: 0; right: 0; height: var(--titlebar-height); display: flex; justify-content: flex-end; -webkit-app-region: drag; user-select: none; }
  .buttons { display: flex; height: 100%; -webkit-app-region: no-drag; }
  button { display: grid; place-items: center; width: calc(var(--titlebar-height) * 1.5); height: 100%; color: var(--color-text-muted); transition: background-color var(--motion-general-duration) var(--motion-general-easing), color var(--motion-general-duration) var(--motion-general-easing); }
  button:hover { background: color-mix(in srgb, var(--color-text) 10%, transparent); color: var(--color-text); }
  button.close:hover { background: var(--color-danger); color: var(--color-on-accent); }
</style>
