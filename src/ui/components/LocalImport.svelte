<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { LocalAudioMetadata, LocalScanProgress } from '../../core/local';
  import { localId, localTrack } from '../../core/local';
  import type { Track } from '../../core/types';
  import { formatTime } from '../../core/format';
  import { useModel } from '../context.svelte';
  import Button from './Button.svelte';
  import Cover from './Cover.svelte';
  import VirtualList from './VirtualList.svelte';
  import Icon from '../icons/Icon.svelte';
  const ui = useModel();
  let { onchange, onbusy }: { onchange: (tracks: readonly Track[], title: string) => void; onbusy: (busy: boolean) => void } = $props();
  let files = $state.raw<readonly LocalAudioMetadata[]>([]);
  let selected = $state.raw<ReadonlySet<string>>(new Set());
  let query = $state(''), name = $state(''), busy = $state(false), listing = $state(false), failure = $state(''), limited = $state(false);
  let progress = $state<LocalScanProgress>({ completed: 0, total: 0, name: '' });
  let controller: AbortController | undefined;
  let previewScroller = $state<HTMLElement>();
  let rows = $derived(files.map(file => ({ file, id: localId(file.uri), track: localTrack(file, ui.t('import.unknownArtist')) })));
  let visible = $derived(rows.filter(row => !query.trim() || `${row.file.name} ${row.track?.title ?? ''} ${row.track?.artist.name ?? ''} ${row.file.path ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  let chosen = $derived(rows.flatMap(row => row.track && selected.has(row.id) ? [row.track] : []));
  let duration = $derived(chosen.reduce((total, track) => total + track.duration, 0));
  let existing = $derived(chosen.filter(track => ui.library?.tracks.some(old => old.id === track.id)).length);
  let unreadable = $derived(rows.filter(row => !row.track).length);
  let allVisible = $derived(visible.some(row => row.track) && visible.every(row => !row.track || selected.has(row.id)));
  $effect(() => { onchange(chosen, name || ui.t('source.local')); });
  function toggle(id: string) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selected = next; }
  function toggleAll() { const next = new Set(selected); for (const row of visible) if (row.track) { if (allVisible) next.delete(row.id); else next.add(row.id); } selected = next; }
  async function pick(kind: 'files' | 'folder') {
    if (busy) return;
    busy = true; listing = true; onbusy(true); failure = ''; progress = { completed: 0, total: 0, name: '' }; controller = new AbortController();
    try {
      const selection = await ui.api.files.pickAudio(kind);
      if (!selection || controller.signal.aborted) return;
      limited = !!selection.limited; if (selection.name && !files.length) name = selection.name;
      const known = new Set(files.map(file => localId(file.uri)));
      const fresh = selection.files.filter(file => { const id = localId(file.uri); if (known.has(id)) return false; known.add(id); return true; });
      if (!fresh.length) { if (!selection.files.length) failure = 'import.local.empty'; else if (files.length) failure = 'import.local.alreadySelected'; return; }
      listing = false; progress = { completed: 0, total: fresh.length, name: '' };
      const metadata = await ui.api.files.readAudioMetadata(fresh, value => progress = value, controller.signal);
      if (controller.signal.aborted) return;
      files = [...files, ...metadata];
      selected = new Set([...selected, ...metadata.filter(file => localTrack(file, '')).map(file => localId(file.uri))]);
    } catch { if (!controller?.signal.aborted) failure = 'import.local.failed'; }
    finally { busy = false; listing = false; onbusy(false); }
  }
  function cancel() { controller?.abort(); }
  onDestroy(cancel);
</script>
<div class="local-import" data-testid="local-import">
  <div class="local-intro"><span class="local-symbol"><Icon name="folder" size="l" /></span><div><h2>{ui.t('import.local.title')}</h2><p>{ui.t('import.local.subtitle')}</p></div></div>
  <div class="pick-actions"><Button wide disabled={busy} onclick={() => pick('files')}><Icon name="music" size="s" />{ui.t('import.chooseFiles')}</Button><Button wide variant="secondary" disabled={busy} onclick={() => pick('folder')}><Icon name="folder" size="s" />{ui.t('import.chooseFolder')}</Button></div>
  <p class="formats">FLAC · MP3 · OGG · OPUS · M4A · WAV · AAC</p>
  {#if busy}<div class="scan" role="status" aria-live="polite" data-testid="local-scan"><strong>{ui.t(listing ? 'import.local.finding' : 'import.local.reading', { count: progress.completed, total: progress.total })}</strong><progress value={listing ? undefined : progress.completed} max={Math.max(1, progress.total)}></progress><span class="scan-file">{progress.name || ui.t('import.local.background')}</span>{#if !listing}<button class="text-action" onclick={cancel}>{ui.t('import.cancel')}</button>{/if}</div>{/if}
  {#if failure}<p class="feedback" role="status">{ui.t(failure)}</p>{/if}
  {#if limited}<p class="feedback">{ui.t('import.local.limit')}</p>{/if}
  {#if rows.length}
    <div class="selection-summary"><strong>{ui.t('import.local.selected', { count: chosen.length, total: rows.length })}</strong><span>{formatTime(duration)}{#if existing} · {ui.t('import.local.existing', { count: existing })}{/if}</span></div>
    <label class="search-field"><Icon name="search" size="s" /><input type="search" bind:value={query} placeholder={ui.t('import.local.filter')} aria-label={ui.t('import.local.filter')} /></label>
    <div class="selection-tools"><button class="text-action" disabled={busy} onclick={toggleAll}>{ui.t(allVisible ? 'import.local.deselect' : 'import.local.selectAll')}</button><span>{ui.count(visible.length)}</span></div>
    <div class="local-preview" bind:this={previewScroller} data-testid="local-preview"><VirtualList items={visible} itemKey={row => row.id} scroller={previewScroller}>{#snippet children(row)}
      <label class="file-row" class:unreadable={!row.track}>
        <input type="checkbox" checked={selected.has(row.id)} disabled={!row.track || busy} onchange={() => toggle(row.id)} aria-label={row.track?.title ?? row.file.name} />
        <span class="file-art">{#if row.track}<Cover artwork={row.track.artwork} animate={false} />{:else}<Icon name="music" />{/if}</span>
        <span class="file-info"><strong>{row.track?.title ?? row.file.name}</strong><span>{row.track?.artist.name ?? ui.t('import.local.unreadable')}</span></span>
        <span class="file-meta">{row.track ? formatTime(row.track.duration) : '—'}{#if row.track && ui.api.library.getTrack(row.id)}<small>{ui.t('import.local.inLibrary')}</small>{/if}</span>
      </label>
    {/snippet}</VirtualList></div>
    {#if unreadable}<p class="feedback">{ui.t('import.local.skipped', { count: unreadable })}</p>{/if}
    <p class="permission-hint">{ui.t('import.local.accessHint')}</p>
  {/if}
</div>
<style>
  .local-intro { display: flex; align-items: center; gap: var(--space-4); margin: var(--space-5) 0; }
  .local-symbol { display: grid; place-items: center; flex: 0 0 var(--touch-size); height: var(--touch-size); background: var(--color-surface-2); color: var(--color-accent); border-radius: var(--radius-m); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); margin-bottom: var(--space-2); }
  p, .formats, .file-meta, .selection-summary > span, .selection-tools > span { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); line-height: var(--line-height-body); }
  .pick-actions { display: grid; gap: var(--space-3); }
  .formats { margin: var(--space-3) 0 var(--space-5); text-align: center; }
  .scan { display: grid; gap: var(--space-3); background: var(--color-surface-1); padding: var(--space-4); border-radius: var(--radius-m); }
  progress { width: 100%; accent-color: var(--color-accent); height: var(--space-2); }
  .scan-file { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .selection-summary { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-5) 0 var(--space-4); }
  .search-field input { border: 0; background: transparent; min-width: 0; width: 100%; }
  .selection-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .file-row { display: flex; align-items: center; gap: var(--space-3); height: var(--track-height); min-width: 0; cursor: pointer; }
  .local-preview { max-height: min(42vh, 420px); overflow-y: auto; overscroll-behavior: contain; }
  input[type=checkbox] { width: var(--space-5); height: var(--space-5); flex-shrink: 0; accent-color: var(--color-accent); }
  .file-art { width: var(--cover-row); height: var(--cover-row); flex-shrink: 0; display: grid; place-items: center; border-radius: var(--radius-s); background: var(--color-surface-2); }
  .file-info { min-width: 0; flex: 1; display: grid; gap: var(--space-1); }
  .file-info strong, .file-info > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .file-info strong { font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  .file-info > span { color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .file-meta { text-align: end; font-variant-numeric: tabular-nums; }
  .file-meta small { display: block; font-size: calc(var(--font-size-xs) * var(--font-scale)); }
  .unreadable { opacity: var(--opacity-muted); }
  .feedback, .permission-hint { margin: var(--space-3) 0; }
</style>
