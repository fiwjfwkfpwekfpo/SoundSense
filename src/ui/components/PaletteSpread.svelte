<script lang="ts">
  import { useModel } from '../context.svelte';
  const ui = useModel();
  let element: HTMLDivElement;
  $effect(() => {
    const change = ui.colorTransition;
    if (!change?.duration || !element) return;
    element.style.background = change.from.palette.mainBg;
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: change.duration, easing: 'linear', fill: 'forwards' });
    void animation.finished.then(() => element.style.background = '').catch(() => {});
    return () => { animation.cancel(); element.style.background = ''; };
  });
</script>
<div bind:this={element} class="palette-spread" aria-hidden="true"></div>
<style>.palette-spread { position: absolute; inset: 0; z-index: 0; pointer-events: none; }</style>
