<script lang="ts">
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  const ui = useModel();
  const tabs: { name: 'home' | 'library' | 'search' | 'settings'; icon: IconName }[] = [
    { name: 'home', icon: 'home' }, { name: 'library', icon: 'library' }, { name: 'search', icon: 'search' }, { name: 'settings', icon: 'settings' },
  ];
</script>
<nav class:liquid={ui.appearance.groups.general.effect === 'fluid' || ui.appearance.groups.general.effect === 'liquid-tabs'} style:--tab-index={tabs.findIndex(tab => tab.name === ui.nav.state.activeTab)} aria-label={ui.t('app.name')}>
  <span class="liquid-head" aria-hidden="true"></span><span class="liquid-tail" aria-hidden="true"></span>
  {#each tabs as tab}
    <button class:active={ui.nav.state.activeTab === tab.name} aria-label={ui.t(`nav.${tab.name}`)} aria-current={ui.nav.state.activeTab === tab.name ? 'page' : undefined} onclick={event => ui.nav.tab(tab.name, event)}><Icon name={tab.icon} size="l" filled={tab.name === 'home' && ui.nav.state.activeTab === tab.name} /><span class="dot"></span></button>
  {/each}
</nav>
<style>
  nav { position: relative; isolation: isolate; display: flex; align-items: center; justify-content: space-around; width: 100%; height: var(--nav-height); padding: var(--space-2) var(--space-3); border: var(--border-width) solid var(--color-border); background: var(--color-nav); border-radius: var(--radius-full); box-shadow: var(--shadow-nav); backdrop-filter: blur(var(--blur-nav)); }
  .liquid-head, .liquid-tail { display: none; }
  .liquid .liquid-head, .liquid .liquid-tail { display: block; position: absolute; width: var(--touch-size); height: var(--touch-size); border-radius: var(--radius-full); background: var(--color-surface-3); left: calc(var(--space-3) + (100% - var(--space-3) * 2) * (var(--tab-index) + .5) / 4 - var(--touch-size) / 2); transition: left var(--motion-general-duration) var(--motion-general-easing); z-index: 0; }
  .liquid .liquid-tail { transition-duration: calc(var(--motion-general-duration) * 1.45); opacity: var(--opacity-muted); }
  button { z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); position: relative; min-width: var(--touch-size); height: var(--touch-size); color: var(--color-text-muted); }
  .active { color: var(--color-text); }
  .dot { position: absolute; bottom: calc(-1 * var(--space-1)); height: calc(var(--space-1) / 2); width: calc(var(--space-1) / 2); border-radius: var(--radius-full); background: var(--color-clear); }
  .active .dot { background: var(--color-text); }
</style>
