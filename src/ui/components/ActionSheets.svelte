<script lang="ts">
  import { layout } from '../layout.svelte';
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  import AppearancePanel from '../appearance/AppearancePanel.svelte';
  import Sheet from './Sheet.svelte';
  import Cover from './Cover.svelte';
  import Button from './Button.svelte';
  import AudioSettings from './AudioSettings.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/Icon.svelte';
  const ui = useModel();
  let newName = $state('');
  function createAndAdd() { if (!newName.trim() || !track) return; const id = ui.api.library.createPlaylist(newName); ui.api.library.addToPlaylist(id, track.id); newName = ''; ui.notify('track.addedPlaylist'); ui.nav.dismissSheet(); }
  let sheet = $derived(ui.nav.state.sheet);
  let track = $derived(sheet && 'trackId' in sheet ? ui.api.library.getTrack(sheet.trackId) : ui.track);
  let trackActions = $derived(ui.contributions('trackMenu').filter(item => item.command !== 'download' || ui.api.capabilities?.downloads !== false && !track?.sources.some(source => source.kind === 'local')));
  function action(name: string) {
    if (!track) return;
    if (!['next','enqueue','playlist','like','download','artist','share'].includes(name)) { ui.api.extensions.events.emit('ui:command', { command: name, slot: 'trackMenu', trackId: track.id }); ui.nav.dismissSheet(); return; }
    if (name === 'playlist') { ui.nav.replaceSheet({ kind: 'addPlaylist', trackId: track.id }); return; }
    if (name === 'share') { ui.nav.replaceSheet({ kind: 'share', trackId: track.id }); return; }
    if (name === 'artist') { ui.nav.go({ name: 'artist', id: track.artist.id }); return; }
    if (name === 'like') ui.like(track);
    if (name === 'next' || name === 'enqueue') { ui.api.player.enqueue(track.id, name === 'next'); ui.notify(name === 'next' ? 'track.willPlayNext' : 'track.enqueued'); }
    if (name === 'download') { if (ui.api.offline) { void (track.downloaded ? ui.api.offline.remove(track.id) : ui.api.offline.download(track)).then(() => ui.notify(track!.downloaded ? 'track.removeDownload' : 'offline.queued')).catch(() => ui.notify('offline.failed')); } else { ui.api.library.setDownloaded(track.id, !track.downloaded); if (!track.downloaded) ui.notify('track.downloaded'); } }
    ui.nav.dismissSheet();
  }
  async function copyTrack() {
    if (!track) return;
    const text = ui.t('track.shareText', { title: track.title, artist: track.artist.name });
    try { await navigator.clipboard.writeText(text); ui.notify('track.shared'); ui.nav.dismissSheet(); }
    catch { const input = document.querySelector<HTMLTextAreaElement>('[data-share-text]'); input?.select(); }
  }
  function optionKey(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    options[target]?.focus();
  }
</script>
{#if sheet}
  <Sheet dialog={sheet.kind === 'select'} panel={sheet.kind === 'sound' && layout.wide} title={sheet.kind === 'select' ? sheet.title : sheet.kind === 'update' ? ui.t('update.phase.available', { version: ui.updateState?.manifest?.version ?? '' }) : ui.t(sheet.kind === 'playbackPower' ? 'background.title' : sheet.kind === 'appearance' ? `appearance.axis.${sheet.axis}` : sheet.kind === 'sleepTimer' ? 'sleep.title' : sheet.kind === 'deletePlaylist' ? 'playlist.delete' : sheet.kind === 'sound' ? 'player.sound' : sheet.kind === 'addPlaylist' ? 'common.selectPlaylist' : sheet.kind === 'share' ? 'track.shareTitle' : sheet.kind === 'playlistMenu' ? 'playlist.menu' : sheet.kind === 'playerMenu' ? 'player.menu' : 'common.menu')}>
    {#if (sheet.kind === 'track' || sheet.kind === 'playerMenu') && track}<div class="track-summary"><span class="art"><Cover artwork={track.artwork} /></span><div><strong>{track.title}</strong><p>{track.artist.name}</p></div><span class="source">{ui.t(`source.${track.sources[0]?.kind ?? 'local'}`)}</span></div>{/if}
    {#if sheet.kind === 'select'}
      {@const selection = sheet}<div class="selection" role="listbox" tabindex="0" aria-label={selection.title} onkeydown={optionKey}>{#each selection.options as option}<button class="action" role="option" aria-selected={selection.value === option.value} onclick={() => { selection.onselect(option.value); ui.nav.dismissSheet(); }}><span>{option.label}</span>{#if selection.value === option.value}<Icon name="check" size="s" />{/if}</button>{/each}</div>
    {:else if sheet.kind === 'track'}
      {#each trackActions as item}<button class="action" onclick={() => action(item.command)}><Icon name={item.icon as IconName} filled={item.command === 'like' && !!track?.liked} /><span>{ui.t(item.command === 'like' && track?.liked ? 'track.unlike' : item.command === 'download' && track?.downloaded ? 'track.removeDownload' : item.titleKey)}</span>{#if item.command === 'download'}{#if !ui.api.offline}<small>{ui.t('common.mock')}</small>{/if}{/if}</button>{/each}
      {#if ui.nav.state.route.name === 'playlist' && track}<button class="action" onclick={() => { const route = ui.nav.state.route; if (route.name === 'playlist' && track) ui.api.library.removeFromPlaylist(route.id, track.id); ui.nav.dismissSheet(); }}><Icon name="close" /><span>{ui.t('playlist.removeTrack')}</span></button>{/if}
    {:else if sheet.kind === 'playerMenu'}
      <button class="action" onclick={() => ui.nav.replaceSheet({ kind: 'sleepTimer' })}><Icon name="clock" /><span>{ui.t('sleep.title')}</span>{#if ui.clock.sleepTimer}<small>{formatTime(Math.ceil(ui.clock.sleepTimer.remaining))}</small>{/if}</button><button class="action" onclick={() => ui.nav.open('queue')}><Icon name="queue" /><span>{ui.t('queue.title')}</span><Icon name="chevron-right" size="s" /></button>{#if ui.api.capabilities?.soundProcessing !== false}<button class="action" onclick={() => ui.nav.replaceSheet({ kind: 'sound' })}><Icon name="sliders" /><span>{ui.t('player.sound')}</span></button>{/if}{#if ui.api.capabilities?.downloads !== false}<button class="action" onclick={() => action('download')}><Icon name="download" /><span>{ui.t('track.download')}</span>{#if !ui.api.offline}<small>{ui.t('common.mock')}</small>{/if}</button>{/if}<button class="action" onclick={() => action('artist')}><Icon name="artist" /><span>{ui.t('track.artist')}</span></button>
    {:else if sheet.kind === 'sleepTimer'}
      {#if ui.clock.sleepTimer}<p class="hint">{ui.t('sleep.remaining', { time: formatTime(Math.ceil(ui.clock.sleepTimer.remaining)) })}</p>{/if}
      {#each [15, 30, 45, 60] as minutes}<button class="action" onclick={() => { ui.api.player.setSleepTimer(minutes); ui.nav.dismissSheet(); }}><Icon name="clock" /><span>{ui.t('sleep.minutes', { count: minutes })}</span></button>{/each}
      <button class="action" onclick={() => { ui.api.player.setSleepTimer('track'); ui.nav.dismissSheet(); }}><Icon name="music" /><span>{ui.t('sleep.track')}</span></button>
      {#if ui.player?.sleepTimer}<button class="action" onclick={() => { ui.api.player.setSleepTimer(null); ui.nav.dismissSheet(); }}><Icon name="close" /><span>{ui.t('sleep.off')}</span></button>{/if}
    {:else if sheet.kind === 'addPlaylist' && track}
      <form onsubmit={event => { event.preventDefault(); createAndAdd(); }}><label class="field">{ui.t('playlist.create')}<input bind:value={newName} placeholder={ui.t('playlist.name')} maxlength="160" /></label><Button wide disabled={!newName.trim()}>{ui.t('playlist.createAndAdd')}</Button></form>
      {#each ui.library?.playlists ?? [] as playlist}<button class="action playlist-action" onclick={() => { if (track) ui.api.library.addToPlaylist(playlist.id, track.id); ui.notify('track.addedPlaylist'); ui.nav.dismissSheet(); }}><span class="art"><Cover artwork={playlist.artwork} heart={playlist.kind === 'liked'} /></span><span>{ui.playlistTitle(playlist)}<small>{ui.count(playlist.trackIds.length)}</small></span><Icon name="plus" size="s" /></button>{/each}
    {:else if sheet.kind === 'playbackPower'}<p class="hint">{ui.t('background.hint')}</p><Button wide onclick={() => { ui.nav.dismissSheet(); void ui.api.playbackPower?.request().catch(() => ui.notify('background.failed')); }}>{ui.t('background.configure')}</Button><Button variant="ghost" wide onclick={() => ui.nav.dismissSheet()}>{ui.t('background.later')}</Button>
    {:else if sheet.kind === 'update'}{@const manifest = ui.updateState?.manifest}{#if manifest}<ul class="notes">{#each manifest.notes[ui.locale === 'en' ? 'en' : 'ru'].slice(0, 6) as line}<li>{line}</li>{/each}</ul>{#if ui.updateState?.total}<p class="hint">{ui.t('update.downloadSize', { size: (ui.updateState.total / 1024 / 1024).toFixed(1) })}</p>{/if}{/if}
      {#if ui.api.updates?.supported}<Button wide onclick={() => { ui.nav.dismissSheet(); ui.installUpdate(); }}>{ui.t('update.now')}</Button>{:else}<Button wide onclick={() => { ui.nav.dismissSheet(); ui.nav.go({ name: 'updates' }); }}>{ui.t('update.open')}</Button>{/if}<Button variant="ghost" wide onclick={() => ui.nav.dismissSheet()}>{ui.t('update.later')}</Button>
    {:else if sheet.kind === 'sound'}<AudioSettings />
    {:else if sheet.kind === 'appearance'}{#key sheet.axis}<AppearancePanel axis={sheet.axis} />{/key}
    {:else if sheet.kind === 'share' && track}<p class="hint">{ui.t('track.shareHint')}</p><textarea class="share-text" data-share-text readonly aria-label={ui.t('track.shareTitle')}>{ui.t('track.shareText', { title: track.title, artist: track.artist.name })}</textarea><Button wide onclick={copyTrack}>{ui.t('track.copy')}</Button>
    {:else if sheet.kind === 'deletePlaylist'}{@const playlistId = sheet.playlistId}<p class="hint">{ui.t('playlist.deleteConfirm')}</p><Button wide onclick={() => { ui.api.library.deletePlaylist(playlistId); ui.nav.dismissSheet(); ui.nav.back(); }}>{ui.t('playlist.delete')}</Button><Button variant="ghost" wide onclick={() => ui.nav.dismissSheet()}>{ui.t('common.cancel')}</Button>
    {:else if sheet.kind === 'playlistMenu'}{@const playlistId = sheet.playlistId}<button class="action" onclick={() => ui.nav.go({ name: 'import', destination: playlistId })}><Icon name="plus" /><span>{ui.t('playlist.importLink')}</span></button>{#if playlistId !== 'liked'}<button class="action" onclick={() => ui.nav.replaceSheet({ kind: 'deletePlaylist', playlistId })}><Icon name="close" /><span>{ui.t('playlist.delete')}</span></button>{/if}<button class="action" onclick={() => { ui.play(ui.api.library.getPlaylistTracks(playlistId).map(t => t.id)); ui.api.player.setShuffle(true); ui.nav.dismissSheet(); }}><Icon name="shuffle" /><span>{ui.t('playlist.shuffle')}</span></button><button class="action" onclick={() => ui.nav.go({ name: 'library', tab: 'playlists' })}><Icon name="library" /><span>{ui.t('nav.library')}</span><Icon name="chevron-right" size="s" /></button>{/if}
  </Sheet>
{/if}
<style>
  .track-summary { display: flex; align-items: center; gap: var(--space-3); padding: 0 0 var(--space-4); margin-bottom: var(--space-2); border-bottom: var(--border-width) solid var(--color-border); }
  .art { display: block; width: var(--cover-row); height: var(--cover-row); border-radius: var(--radius-s); flex-shrink: 0; }
  .track-summary > div { min-width: 0; flex: 1; }
  .track-summary strong { font-size: calc(var(--font-size-m) * var(--font-scale)); }
  .track-summary p { font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); margin-top: var(--space-1); }
  .source { color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .selection { display: grid; gap: var(--space-1); }
  .selection .action { padding: 0 var(--space-3); border-radius: var(--radius-m); min-height: calc(var(--touch-size) + var(--space-1)); }
  .selection .action[aria-selected='true'] { background: var(--color-surface-2); color: var(--color-text); font-weight: var(--font-weight-semibold); }
  .selection .action[aria-selected='true'] > :global(svg) { color: var(--color-accent); }
  .action { display: flex; align-items: center; gap: var(--space-4); width: 100%; min-height: calc(var(--touch-size) + var(--space-2)); text-align: start; font-size: calc(var(--font-size-m) * var(--font-scale)); }
  .action > span:not(.art) { flex: 1; }
  .action > :global(svg) { color: var(--color-text-muted); }
  .action small { color: var(--color-text-muted); font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .playlist-action { min-height: var(--track-height); }
  .playlist-action small { display: block; margin-top: var(--space-1); }
  .notes { padding-left: var(--space-5); margin-bottom: var(--space-4); color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  .notes li { margin: var(--space-2) 0; }
  .hint { font-size: calc(var(--font-size-sm) * var(--font-scale)); color: var(--color-text-muted); line-height: var(--line-height-body); margin-bottom: var(--space-5); }
  .share-text { width: 100%; min-height: var(--cover-row); background: var(--color-surface-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-s); padding: var(--space-3); margin-bottom: var(--space-4); font-size: calc(var(--font-size-m) * var(--font-scale)); resize: none; }
</style>
