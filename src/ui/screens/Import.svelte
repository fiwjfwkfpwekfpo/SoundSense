<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import { parseMusicLink } from '../../core/links';
  import type { ImportCollection, ImportSource, ImportChoice } from '../../core/imports';
  import { ImportFailure, classifyImportError } from '../../core/imports';
  import { parseSpotifyArchive } from '../../core/spotify';
  import { parseAppleExport } from '../../core/apple-export';
  import ImportError from '../components/ImportError.svelte';
  import ImportResult from '../components/ImportResult.svelte';
  import Button from '../components/Button.svelte';
  import Select from '../components/Select.svelte';
  import Icon from '../icons/Icon.svelte';
  import LocalImport from '../components/LocalImport.svelte';
  import YandexAccount from '../components/YandexAccount.svelte';
  const ui = useModel();
  let { source: initialSource = 'sc', link: initialLink = '', destination: initialDestination = 'separate' }: { source?: string; link?: string; destination?: string } = $props();
  let source = $state<ImportSource>('sc'); let url = $state(''); let destination = $state('separate');
  let title = $state(''); let clipboard = $state(''); let collections = $state<readonly ImportCollection[]>([]); let checked = $state<string[]>([]);
  let choices = $state<readonly ImportChoice[]>([]); let controller: AbortController | undefined;
  let method = $state<'link' | 'file'>('link');
  let accountDetails = $state<HTMLDetailsElement>();
  let error = $state<ImportFailure | null>(null); let busy = $state(false); let showForm = $state(false); let archiveInput = $state<HTMLInputElement>()!;
  let parsed = $derived(parseMusicLink(url));
  let active = $derived(ui.importJob && !['done', 'cancelled'].includes(ui.importJob.phase));
  onMount(() => {
    source = ui.api.extensions.imports.get(initialSource) ? initialSource : 'sc'; url = initialLink; destination = (source === 'local' || !ui.api.imports.inspect) && initialDestination === 'separate' ? 'new' : initialDestination;
    if (!ui.importJob || initialLink) showForm = true;
    void ui.api.files.readClipboard().then(text => { if (parseMusicLink(text)) clipboard = text; }).catch(() => {});
    return () => controller?.abort();
  });
  function clearSelection() { controller?.abort(); busy = false; choices = []; collections = []; checked = []; error = null; }
  function select(value: ImportSource) { clearSelection(); source = value; url = ''; method = 'link'; if (value === 'local' && destination === 'separate') destination = 'new'; }
  async function inspect(account = false) {
    clearSelection(); const active = controller = new AbortController(); busy = true;
    try {
      const link = account ? undefined : parsed;
      if (!account && !link) throw new ImportFailure('invalid_link');
      const provider = account ? 'ya' : source === 'ytm' && link?.source === 'yt' ? 'ytm' : link!.source;
      source = provider;
      const found = await ui.api.imports.inspect!(provider, link ? { ...link, source: provider } : undefined, active.signal);
      active.signal.throwIfAborted(); choices = found; checked = choices.map(choice => choice.id);
      if (!choices.length) throw new ImportFailure('empty');
    } catch (value) { if (!active.signal.aborted) error = classifyImportError(value); }
    finally { if (controller === active) busy = false; }
  }
  async function login() {
    if (accountDetails) accountDetails.open = true;
    if (ui.api.account) { try { await ui.api.imports.authorize('ya'); await inspect(true); } catch (value) { if (!(value instanceof DOMException && value.name === 'AbortError')) error = classifyImportError(value); } return; }
    busy = true; error = null;
    try { collections = await ui.api.imports.loginYandex(); checked = collections.map(collection => collection.id); source = 'ya'; showForm = true; }
    catch (value) { error = classifyImportError(value); } finally { busy = false; }
  }
  async function authenticate() {
    if (!ui.importJob) { await login(); return; }
    busy = true;
    try { await ui.api.imports.authorize(ui.importJob.request.source); ui.api.imports.retry(); }
    catch (value) { error = classifyImportError(value); } finally { busy = false; }
  }
  async function archive(event: Event) {
    const files = [...(event.currentTarget as HTMLInputElement).files ?? []]; if (!files.length) return;
    clearSelection();
    const active = controller = new AbortController(), service = source;
    busy = true; error = null;
    try { const loaded: ImportCollection[] = []; for (const file of files) { if (file.size > 30 * 1024 * 1024) throw new ImportFailure('invalid_archive'); const data = service === 'spotify' ? await parseSpotifyArchive(new Uint8Array(await file.arrayBuffer()), true) : parseAppleExport(await file.text(), /\.json$/i.test(file.name) ? 'json' : 'csv', file.name); active.signal.throwIfAborted(); loaded.push(...data); } active.signal.throwIfAborted(); collections = loaded; checked = collections.map(collection => collection.id); }
    catch (value) { if (!active.signal.aborted) error = classifyImportError(value); } finally { if (controller === active) busy = false; if (archiveInput?.isConnected) archiveInput.value = ''; }
  }
  async function start() {
    error = null;
    const chosen = collections.filter(collection => checked.includes(collection.id));
    const selected = choices.filter(choice => checked.includes(choice.id));
    if (!collections.length && !choices.length && !parsed) { error = new ImportFailure('invalid_link'); return; }
    if (collections.length && !chosen.length) return;
    if (choices.length && !selected.length) return;
    if (parsed && ['track', 'short'].includes(parsed.kind) && !collections.length) { await ui.openLink(url); return; }
    if (!collections.length && !choices.length && ui.api.imports.inspect) { await inspect(); return; }
    ui.api.imports.start({ source: choices.length || collections.length ? source : parsed!.source, ...(selected.length ? { selections: selected } : parsed && !collections.length ? { link: parsed } : { collections: chosen }), destination: !ui.api.imports.inspect && destination === 'separate' ? 'new' : destination, title: title.trim() || chosen[0]?.title || selected[0]?.title || ui.t(`import.kind.${parsed?.kind ?? 'playlist'}`, { service: ui.t(`source.${parsed?.source ?? source}`), user: parsed?.user ?? '' }) });
    showForm = false;
  }
</script>
<section class="screen import-screen" aria-label={ui.t('import.title')}>
  <header class="screen-header"><button class="icon-button" aria-label={ui.t('nav.back')} onclick={() => ui.nav.back()}><Icon name="chevron-left" /></button><h1>{ui.t('import.title')}</h1><span></span></header>
  {#if !showForm && ui.importJob}
    {#if active}
      <div class="progress" role="status" data-testid="import-progress"><p class="eyebrow">{ui.t(`source.${ui.importJob.request.source}`)}</p><h2>{ui.t(`import.phase.${ui.importJob.phase}`)}</h2><p>{ui.t('import.progress', { count: ui.importJob.completed, total: ui.importJob.total })}</p><progress value={ui.importJob.completed} max={Math.max(1, ui.importJob.total)} aria-label={ui.t('import.title')}></progress><p class="muted">{ui.t('import.backgroundHint')}</p><button class="text-action" onclick={() => ui.api.imports.cancel()}>{ui.t('import.cancel')}</button></div>
      {#if ui.importJob.error}<ImportError error={ui.importJob.error} retry={() => ui.api.imports.retry()} edit={() => showForm = true} login={ui.importJob.request.source === 'ya' ? authenticate : undefined} retryIn={ui.importJob.retryIn} />{#if ui.importJob.request.source === 'ya' && ['auth', 'expired'].includes(ui.importJob.error.kind) && ui.api.account}<YandexAccount onconnected={() => ui.api.imports.retry()} />{/if}{/if}
    {:else if ui.importJob.phase === 'done'}<ImportResult /><button class="text-action" onclick={() => showForm = true}>{ui.t('import.again')}</button>
    {:else}<p>{ui.t('import.cancelled')}</p><Button onclick={() => showForm = true}>{ui.t('import.again')}</Button>{/if}
  {:else}
    {#if source !== 'local'}<p class="intro">{ui.t('import.intro')}</p>{/if}
    <div class="chips">{#each ui.api.extensions.imports.list() as provider}{@const value = provider.id}<button class="chip" class:active={source === value} onclick={() => select(value as ImportSource)}>{ui.t(`source.${value}`)}</button>{/each}</div>
    {#if clipboard}<div class="clipboard"><p>{ui.t('import.clipboard', { service: ui.t(`source.${parseMusicLink(clipboard)?.source}`), kind: ui.t(`import.type.${parseMusicLink(clipboard)?.kind}`) })}</p><button class="text-action" onclick={() => { clearSelection(); url = clipboard; source = parseMusicLink(clipboard)!.source; clipboard = ''; }}>{ui.t('import.useClipboard')}</button></div>{/if}
    {#if ['spotify', 'apple'].includes(source)}<div class="method" role="tablist" aria-label={ui.t('import.method')}><button role="tab" aria-selected={method === 'link'} class:active={method === 'link'} onclick={() => { clearSelection(); method = 'link'; }}>{ui.t('import.byLink')}</button><button role="tab" aria-selected={method === 'file'} class:active={method === 'file'} onclick={() => { clearSelection(); method = 'file'; }}>{ui.t('import.byExport')}</button></div>{/if}
    {#if source === 'spotify' && method === 'file'}
      <h2>{ui.t('import.spotifyTitle')}</h2><ol><li>{ui.t('import.spotify1')}</li><li>{ui.t('import.spotify2')}</li><li>{ui.t('import.spotify3')}</li></ol>
      <a class="text-action external" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">{ui.t('import.spotifyPage')}</a>
      <input class="sr-only" bind:this={archiveInput} type="file" accept=".zip,application/zip" aria-label={ui.t('import.chooseArchive')} onchange={archive} /><Button variant="secondary" wide onclick={() => archiveInput.click()} disabled={busy}>{ui.t('import.chooseArchive')}</Button>
    {:else if source === 'apple' && method === 'file'}<p class="muted">{ui.t('import.appleExportHint')}</p><input class="sr-only" bind:this={archiveInput} type="file" multiple accept=".json,.csv,.tsv,text/csv,application/json" aria-label={ui.t('import.chooseExport')} onchange={archive} /><Button variant="secondary" wide onclick={() => archiveInput.click()} disabled={busy}>{ui.t('import.chooseExport')}</Button>
    {:else if source === 'local'}<LocalImport onbusy={value => busy = value} onchange={(tracks, name) => { collections = [{ id: 'local-selection', title: name, tracks: tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist.name, duration: track.duration, track })) }]; checked = tracks.length ? ['local-selection'] : []; }} />
    {:else}
      <label class="field">{ui.t('import.link')}<input type="url" bind:value={url} oninput={clearSelection} placeholder={source === 'sc' ? 'soundcloud.com/user' : source === 'yt' || source === 'ytm' ? 'music.youtube.com/playlist?list=…' : source === 'spotify' ? 'open.spotify.com/playlist/…' : source === 'apple' ? 'music.apple.com/…/playlist/…' : source === 'deezer' ? 'deezer.com/playlist/…' : 'music.yandex.ru/playlists/…'} autocomplete="off" /></label>
      {#if url.trim()}<p class="recognized" aria-live="polite">{ui.t(parsed ? `import.kind.${parsed.kind}` : 'import.invalidFormat', { service: ui.t(`source.${parsed?.source ?? source}`), user: parsed?.user ?? '' })}</p>{/if}
      {#if source === 'ya'}<p class="muted">{ui.t('import.yandexPublicHint')}</p><details class="account-options" bind:this={accountDetails}><summary><span>{ui.t('import.optionalAccount')}</span><Icon name="chevron-down" size="s" /></summary>{#if ui.api.account}<YandexAccount onconnected={() => inspect(true)} />{:else}<Button wide variant="secondary" onclick={login} disabled={busy}>{ui.t('import.login')}</Button>{/if}</details>{/if}
    {/if}
    {#if busy && source !== 'local'}<p role="status">{ui.t('import.reading')}</p>{/if}
    {#if (collections.length || choices.length) && source !== 'local'}<div class="collections"><div class="collection-heading"><h2>{ui.t('import.chooseCollections')}</h2><button class="text-action" onclick={() => checked = checked.length ? [] : [...choices, ...collections].map(item => item.id)}>{ui.t(checked.length ? 'import.local.deselect' : 'import.local.selectAll')}</button></div><p class="muted">{ui.t('import.multiHint')}</p>{#each [...choices, ...collections] as collection}<label class:chosen={checked.includes(collection.id)}><input type="checkbox" checked={checked.includes(collection.id)} onchange={event => checked = event.currentTarget.checked ? [...checked, collection.id] : checked.filter(id => id !== collection.id)} /><span>{collection.liked ? ui.t('nav.liked') : collection.title}<small>{'tracks' in collection ? ui.count(collection.tracks.length) : collection.count === undefined ? ui.t('import.countOnImport') : ui.count(collection.count)}</small></span></label>{/each}</div>{/if}
    <div class="destination"><Select label={ui.t('import.destination')} value={destination} options={[...(source !== 'local' && !!ui.api.imports.inspect ? [{ value: 'separate', label: ui.t('import.keepCollections') }] : []), { value: 'new', label: ui.t('import.newPlaylist') }, { value: 'liked', label: ui.t('nav.liked') }, ...(ui.library?.playlists ?? []).filter(playlist => playlist.kind !== 'liked').map(playlist => ({ value: playlist.id, label: ui.playlistTitle(playlist) }))]} onchange={value => destination = value} /></div>
    {#if destination === 'new'}<label class="field">{ui.t('import.playlistName')}<input bind:value={title} placeholder={collections[0]?.title ?? ui.t('import.sourceName')} maxlength="160" /></label>{/if}
    {#if error}<ImportError {error} {source} retry={start} edit={() => { error = null; if (method === 'file') archiveInput.click(); }} login={source === 'ya' ? login : undefined} />{/if}
    <Button wide onclick={start} disabled={busy || (!!(collections.length || choices.length) && !checked.length) || (!collections.length && (source === 'local' || method === 'file'))}>{ui.t(source === 'local' ? 'import.local.start' : parsed?.kind === 'track' ? 'playlist.listen' : !collections.length && !choices.length && ui.api.imports.inspect ? 'import.inspect' : 'import.start', { count: collections.reduce((total, collection) => total + collection.tracks.length, 0) })}</Button>
    {#if ui.importJob?.phase === 'done'}<button class="text-action" onclick={() => showForm = false}>{ui.t('import.returnResult')}</button>{/if}
  {/if}
</section>
<style>
  h1 { font-size: calc(var(--font-size-xl) * var(--font-scale)); }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); margin: var(--space-5) 0 var(--space-3); }
  .screen-header { margin-left: calc(-1 * var(--space-3)); }
  .intro, .muted, .recognized, ol, .clipboard { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  .intro { margin-bottom: var(--space-5); }
  .chips { margin: 0 calc(-1 * var(--space-6)) var(--space-5); padding: 0 var(--space-6); }
  .clipboard { background: var(--color-surface-1); border-radius: var(--radius-m); padding: var(--space-4); }
  .recognized { margin: calc(-1 * var(--space-2)) 0 var(--space-4); }
  ol { padding-left: var(--space-5); } li { padding: var(--space-2) 0; }
  .external { display: flex; align-items: center; margin: var(--space-3) 0; }
  .collections { margin-top: var(--space-5); }
  .collection-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .collection-heading h2 { margin: 0; }
  .method { display: flex; gap: var(--space-3); margin-bottom: var(--space-5); }
  .method button { min-height: var(--touch-size); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); background: var(--color-surface-1); color: var(--color-text-muted); }
  .method .active { color: var(--color-on-accent); background: var(--color-accent); }
  .account-options { padding: var(--space-3) var(--space-4); margin: var(--space-4) 0; border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); background: var(--color-surface-1); }
  .account-options summary { min-height: var(--touch-size); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); cursor: pointer; font-size: calc(var(--font-size-sm) * var(--font-scale)); color: var(--color-text-muted); }
  .collections label { display: flex; align-items: center; min-height: var(--track-height); gap: var(--space-3); margin: var(--space-2) 0; padding: var(--space-3); background: var(--color-surface-1); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-m); cursor: pointer; }
  .collections label.chosen { border-color: var(--color-accent); }
  .collections input { flex-shrink: 0; width: var(--space-5); height: var(--space-5); accent-color: var(--color-accent); }
  .collections small { display: block; color: var(--color-text-muted); font-size: calc(var(--font-size-s) * var(--font-scale)); }
  .destination { margin-top: var(--space-6); display: flex; justify-content: space-between; align-items: center; }
  progress { width: 100%; height: var(--space-2); accent-color: var(--color-accent); margin: var(--space-5) 0; }
  progress::-webkit-progress-bar { background: var(--color-surface-2); border-radius: var(--radius-full); }
  progress::-webkit-progress-value { background: var(--color-accent); border-radius: var(--radius-full); }
</style>
