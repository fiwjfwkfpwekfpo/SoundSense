<script lang="ts">
  import type { ImportFailure } from '../../core/imports';
  import { useModel } from '../context.svelte';
  import Button from './Button.svelte';
  let { error, retry, edit, login, retryIn, source }: { error: ImportFailure; retry: () => void; edit: () => void; login?: () => void; retryIn?: number; source?: string } = $props();
  const ui = useModel();
  let help = $state(false);
  let service = $derived(source ?? ui.importJob?.request.source ?? 'sc');
  let needsAuthorization = $derived(['auth', 'expired'].includes(error.kind));
  let action = $derived(['invalid_link', 'not_found', 'invalid_archive', 'incomplete'].includes(error.kind) ? edit : needsAuthorization ? login ?? edit : error.kind === 'rate_limit' ? () => ui.api.imports.cancel() : error.kind === 'private' ? () => help = !help : retry);
</script>
<section class="import-error" role="alert" data-error-kind={error.kind}>
  <h2>{ui.t(`import.error.${error.kind}.title`, { service: ui.t(`source.${service}`) })}</h2>
  <p>{ui.t(needsAuthorization && !login ? 'import.publicAccessHint' : `import.error.${error.kind}.body`, { service: ui.t(`source.${service}`), seconds: retryIn ?? error.retryAfter })}</p>
  <Button variant="secondary" wide onclick={action}>{ui.t(needsAuthorization && !login ? 'import.chooseMethod' : `import.error.${error.kind}.action`)}</Button>
  {#if help}<p>{ui.t(`import.privacy.${service}`)}</p>{#if service === 'ya' && login}<Button wide onclick={login}>{ui.t('import.login')}</Button>{/if}{/if}
  {#if error.kind === 'invalid_link'}<p class="examples">soundcloud.com/user/likes<br />music.youtube.com/playlist?list=…<br />music.yandex.ru/users/user/playlists/123</p>{/if}
  <details><summary>{ui.t('import.details')}</summary><code>{error.kind}{error.detail ? ` · ${error.detail}` : ''}</code></details>
</section>
<style>
  .import-error { padding: var(--space-5); border-radius: var(--radius-m); border: var(--border-width) solid var(--color-border); background: var(--color-surface-1); margin: var(--space-5) 0; }
  h2 { font-size: calc(var(--font-size-l) * var(--font-scale)); }
  p { color: var(--color-text-muted); line-height: var(--line-height-body); margin: var(--space-3) 0 var(--space-5); overflow-wrap: anywhere; font-size: calc(var(--font-size-sm) * var(--font-scale)); }
  details { margin-top: var(--space-4); font-size: calc(var(--font-size-s) * var(--font-scale)); color: var(--color-text-muted); }
  summary { cursor: pointer; min-height: var(--touch-size); display: flex; align-items: center; }
  code { overflow-wrap: anywhere; }
  .examples { font-family: var(--font-mono); }
</style>
