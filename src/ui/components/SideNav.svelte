<script lang="ts">
  import { useModel } from '../context.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  // Desktop: the tabs as a left column, icon + label; a narrow window keeps only the icons.
  const ui = useModel();
  const tabs: { name: 'home' | 'library' | 'search' | 'settings'; icon: IconName }[] = [
    { name: 'home', icon: 'home' }, { name: 'search', icon: 'search' }, { name: 'library', icon: 'library' }, { name: 'settings', icon: 'settings' },
  ];
</script>
<nav class="side-nav" aria-label={ui.t('app.name')} data-testid="side-nav">
  <div class="brand" aria-hidden="true"><img src="/SoundSense.png" alt="" /><span class="label">{ui.t('app.name')}</span></div>
  {#each tabs as tab}
    <button class:active={ui.nav.state.activeTab === tab.name} title={ui.t(`nav.${tab.name}`)} aria-label={ui.t(`nav.${tab.name}`)} aria-current={ui.nav.state.activeTab === tab.name ? 'page' : undefined} onclick={event => ui.nav.tab(tab.name, event)}>
      <Icon name={tab.icon} size="m" filled={tab.name === 'home' && ui.nav.state.activeTab === tab.name} /><span class="label">{ui.t(`nav.${tab.name}`)}</span>
    </button>
  {/each}
</nav>
<style>
  .side-nav { position: absolute; z-index: var(--z-dock); top: var(--inset-top); left: 0; bottom: var(--side-nav-bottom, var(--dock-height)); width: var(--side-nav-width); display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-3); overflow-y: auto; scrollbar-width: none; }
  .brand { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3) var(--space-5); font-weight: var(--font-weight-semibold); font-size: calc(var(--font-size-l) * var(--font-scale)); color: var(--color-text); }
  .brand img { width: calc(var(--touch-size) - var(--space-3)); height: calc(var(--touch-size) - var(--space-3)); border-radius: var(--radius-m); flex: none; }
  button { display: flex; align-items: center; gap: var(--space-4); min-height: var(--touch-size); padding: 0 var(--space-3); border-radius: var(--radius-m); color: var(--color-text-muted); font-size: calc(var(--font-size-m) * var(--font-scale)); text-align: start; transition: background var(--motion-general-duration) var(--motion-general-easing), color var(--motion-general-duration) var(--motion-general-easing); }
  button:hover { color: var(--color-text); background: var(--color-surface-2); }
  .active { color: var(--color-text); background: var(--color-surface-3); }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Narrow window: icons only, centred. */
  @media (max-width: 760px) {
    .side-nav { padding-inline: var(--space-2); }
    .label { display: none; }
    .brand, button { justify-content: center; padding-inline: 0; }
  }
</style>
