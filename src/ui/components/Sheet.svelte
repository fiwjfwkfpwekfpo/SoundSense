<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { useModel } from '../context.svelte';
  import { motionTransition } from '../appearance/motion/runtime';
  import Icon from '../icons/Icon.svelte';
  /** `dialog`: a centred card (short choice lists) instead of a bottom sheet. */
  let { title, children, dialog = false, panel = false }: { title: string; children: Snippet; dialog?: boolean; panel?: boolean } = $props();
  const ui = useModel();
  let element: HTMLElement;
  let startY: number | null = null;
  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  });
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); ui.nav.dismissSheet(); }
    if (event.key === 'Tab') {
      const targets = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
</script>
<div class="sheet-layer" class:dialog class:panel><button class="scrim" data-motion-group="general" transition:motionTransition|global={{ group: 'general', effect: 'fade' }} aria-label={ui.t('nav.close')} tabindex="-1" onclick={() => ui.nav.dismissSheet()}></button><div bind:this={element} class="sheet" data-motion-group="general" transition:motionTransition|global={{ group: 'general', effect: dialog ? 'scale' : undefined }} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={key}>{#if !dialog}<button class="handle-area" aria-label={ui.t("sheet.dismiss")} onclick={() => ui.nav.dismissSheet()} onpointerdown={event => { startY = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onpointerup={event => { if (startY !== null && event.clientY - startY > 45) ui.nav.dismissSheet(); startY = null; }}><span></span></button>{/if}<header><h2>{title}</h2><button class="icon-button" aria-label={ui.t('nav.close')} onclick={() => ui.nav.dismissSheet()}><Icon name="close" size="s" /></button></header><div class="sheet-body">{@render children()}</div></div></div>
<style>
  .sheet-layer { position: absolute; inset: 0; z-index: var(--z-overlay); display: flex; align-items: end; }
  .scrim { position: absolute; inset: 0; background: var(--color-scrim); }
  .sheet { position: relative; width: 100%; max-height: min(var(--sheet-max-height), calc(100% - var(--inset-top) - var(--space-5))); display: flex; flex-direction: column; background: var(--color-surface-1); border: var(--border-width) solid var(--color-border); border-bottom: 0; border-radius: var(--radius-xl) var(--radius-xl) 0 0; box-shadow: var(--shadow-sheet); padding: 0 calc(var(--space-6) + var(--inset-right)) calc(var(--space-6) + var(--inset-bottom)) calc(var(--space-6) + var(--inset-left)); }
  .dialog { align-items: center; justify-content: center; padding: calc(var(--inset-top) + var(--space-6)) calc(var(--space-5) + var(--inset-right)) calc(var(--inset-bottom) + var(--space-6)) calc(var(--space-5) + var(--inset-left)); }
  .dialog .sheet { width: min(100%, 420px); max-height: min(70vh, 560px); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-xl); padding: var(--space-5) var(--space-5) var(--space-4); }
  /* Wide desktop window: a floating panel above the player bar instead of a full-width sheet. */
  .panel { align-items: end; justify-content: end; padding: 0 var(--space-5) calc(var(--dock-height) + var(--space-2)); }
  .panel .scrim { background: transparent; }
  .panel .sheet { width: min(100%, 400px); max-height: min(78vh, 640px); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-xl); padding-top: var(--space-4); }
  .panel .handle-area { display: none; }
  .handle-area { width: 100%; min-height: var(--touch-size); display: flex; justify-content: center; align-items: center; touch-action: none; }
  .handle-area span { width: var(--sheet-handle-width); height: var(--sheet-handle-height); border-radius: var(--radius-full); background: var(--color-surface-3); }
  header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin: 0 calc(-1 * var(--space-2)) var(--space-3) 0; }
  h2 { font-size: calc(var(--font-size-xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); }
  .sheet-body { overflow-y: auto; overscroll-behavior: contain; padding: var(--space-1); margin: calc(-1 * var(--space-1)); }
</style>
