<script lang="ts">
  import { BETA_FEATURES } from '../../core/build';
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  /**
   * Apple Music motion artwork over the player cover. It fades in only once the
   * video really plays, so a slow or missing video never hides the static cover.
   * Muted, looping, paused while the app is in the background.
   */
  const ui = useModel();
  let url = $state<string>(), shown = $state(false), video = $state<HTMLVideoElement>();
  let enabled = $derived(BETA_FEATURES && ui.settings.values.liveCovers !== false && !!ui.api.liveCovers);
  let hls: import('hls.js').default | undefined;
  $effect(() => {
    const track = ui.track; url = undefined; shown = false;
    if (!track || !enabled) return;
    const controller = new AbortController();
    // Not during a quick skip through the queue.
    const timer = setTimeout(() => { void ui.api.liveCovers!.find(track, controller.signal).then(value => { if (!controller.signal.aborted) url = value; }); }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  });
  $effect(() => {
    const element = video, source = url; hls?.destroy(); hls = undefined;
    if (!element || !source) return;
    let cancelled = false;
    // hls.js first: it can cap the rendition to the cover's size (Apple's masters go up to 4K).
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { if (element.canPlayType('application/vnd.apple.mpegurl')) { element.src = source; void element.play().catch(() => {}); } return; }
      // Lowest rendition that is still sharp at cover size: the video is small on screen.
      hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 12, startLevel: -1 });
      hls.loadSource(source); hls.attachMedia(element); void element.play().catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; hls?.destroy(); hls = undefined; element.removeAttribute('src'); element.load(); };
  });
  onMount(() => {
    const visible = () => { if (!video || !url) return; if (document.hidden) video.pause(); else void video.play().catch(() => {}); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  });
</script>
{#if url}<video class="live" class:shown bind:this={video} muted loop playsinline autoplay disablepictureinpicture aria-hidden="true" onplaying={() => shown = true} onerror={() => { shown = false; url = undefined; }}></video>{/if}
<style>
  .live { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; opacity: 0; transition: opacity .6s ease; pointer-events: none; }
  .live.shown { opacity: 1; }
</style>
