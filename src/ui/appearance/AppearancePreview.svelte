<script lang="ts">
  import type { ColorPack, StylePack } from './schema';
  import { colorVariables, styleVariables } from './loader';
  import { translate } from '../i18n';
  import Cover from '../components/Cover.svelte';
  import Icon from '../icons/Icon.svelte';
  let { style, colors, title = 'SoundSense', trackLabel = '', locale = 'ru' }: { style: StylePack; colors: ColorPack; title?: string; trackLabel?: string; locale?: string } = $props();
  let variables = $derived(Object.entries({ ...styleVariables(style), ...colorVariables(colors) }).map(([key, value]) => `${key}:${value}`).join(';'));
  let t = $derived((key: string) => translate(locale, key));
</script>
<div class="preview" style={variables} aria-hidden="true">
  <div class="heading"><strong>{title}</strong><span>{t('onboarding.preview')}</span></div>
  <div class="featured"><span class="featured-art"><Cover artwork={{ seed: 24, variant: 'terrain' }} animate={false} /></span><div><small>{t('preview.collection')}</small><strong>{t('preview.title')}</strong><span>SoundSense</span></div><b class="play"><Icon name="play" size="s" /></b></div>
  <div class="preview-bottom"><div class="mini"><span class="mini-art"><Cover artwork={{ seed: 43, variant: 'ribbon' }} animate={false} /></span><span class="mini-text"><strong>{trackLabel || t('preview.track')}</strong><span>SoundSense</span></span><Icon name="pause" size="s" /><Icon name="heart" size="s" /></div><div class="progress"><i></i></div>
  <div class="nav"><span class="selected"><Icon name="home" filled size="s" /></span><Icon name="heart" size="s" /><Icon name="search" size="s" /><Icon name="settings" size="s" /></div></div>
</div>
<style>
  .preview { --font-scale: 1; --color-art-base: var(--palette-cardBg); --color-art-mid: var(--palette-cardHover); --color-art-light: var(--palette-textMuted); --color-art-shine: var(--palette-text); --icon-size-s: 16px; display: flex; flex-direction: column; gap: 10px; position: relative; overflow: hidden; width: 100%; height: 210px; padding: 12px; background: var(--palette-mainBg); color: var(--palette-text); font-family: var(--font-family); border-radius: calc(var(--radius-l) / 1.5); border: var(--border-width) solid var(--palette-border); }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .heading strong { font-size: 16px; font-family: var(--font-display); line-height: 1.2; }
  .heading > span { color: var(--palette-textMuted); font-size: 9px; }
  .featured { display: flex; align-items: center; gap: 10px; min-height: 66px; padding: 8px; background: var(--palette-cardHover); border-radius: calc(var(--radius-m) / 1.5); }
  .featured-art { width: 50px; height: 50px; border-radius: calc(var(--radius-s) / 1.5); overflow: hidden; flex-shrink: 0; }
  .featured > div { min-width: 0; display: grid; gap: 3px; flex: 1; }
  .featured strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .featured small { font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: var(--palette-textMuted); }
  .featured > div > span { font-size: 9px; color: var(--palette-textMuted); }
  .play { width: 27px; height: 27px; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--palette-accent); color: var(--palette-textOnAccent); flex-shrink: 0; }
  .preview-bottom { margin-top: auto; }
  .mini { display: flex; align-items: center; gap: 9px; padding: 7px; background: var(--palette-cardBg); border-radius: calc(var(--radius-m) / 1.5); }
  .mini-art { width: 28px; height: 28px; border-radius: calc(var(--radius-s) / 1.5); flex-shrink: 0; overflow: hidden; }
  .mini-text { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .mini-text strong { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini-text > span { font-size: 8px; color: var(--palette-textMuted); }
  .progress { height: 2px; margin: 0 8px 7px; background: var(--palette-border); overflow: hidden; }
  .progress i { display: block; width: 38%; height: 100%; background: var(--palette-accent); }
  .nav { height: 27px; display: flex; justify-content: space-around; align-items: center; color: var(--palette-textMuted); background: var(--palette-barBg); border: var(--border-width) solid var(--palette-border); border-radius: var(--radius-full); }
  .selected { color: var(--palette-accent); display: grid; place-items: center; }
</style>
