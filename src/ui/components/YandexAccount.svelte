<script lang="ts">
  import { onMount } from 'svelte';
  import { useModel } from '../context.svelte';
  import type { AccountState } from '../../core/accounts';
  import Button from './Button.svelte';
  const ui = useModel();
  let { onconnected }: { onconnected?: () => void | Promise<void> } = $props();
  let current = $state<AccountState>({ phase: 'disconnected' });
  let attached = false;
  let plain = $state(false);
  // Desktop without a keyring: say where the token is kept.
  $effect(() => { if (current.phase === 'connected') void ui.api.accountEncrypted?.().then(value => plain = !value).catch(() => {}); });
  onMount(() => { attached = true; const account = ui.api.account; if (!account) return; current = account.getSnapshot(); const unsubscribe = account.subscribe(value => current = value); return () => { attached = false; unsubscribe(); }; });
  async function login() { try { await ui.api.imports.authorize('ya'); if (attached) await onconnected?.(); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) ui.api.diagnostics?.record('accounts', 'yandex.login.failed', { phase: current.phase }, 'warn'); } }
</script>
{#if ui.api.account}<div class="account" data-testid="yandex-account">
  {#if current.phase === 'requesting'}<p role="status">{ui.t('account.requesting')}</p><Button variant="ghost" wide onclick={() => ui.api.account?.cancel()}>{ui.t('common.cancel')}</Button>
  {:else if current.phase === 'waiting'}<p>{ui.t('account.codeHint')}</p><output aria-label={ui.t('account.code')}>{current.userCode}</output><Button wide onclick={() => { void ui.api.account?.openAuthorization().catch(() => ui.notify('account.openFailed')); }}>{ui.t('account.open')}</Button><p class="muted">{ui.t('account.waiting')}</p><Button variant="ghost" wide onclick={() => ui.api.account?.cancel()}>{ui.t('common.cancel')}</Button>
  {:else if current.phase === 'connected'}<p class="connected">{ui.t('account.connected', { name: current.name ?? 'Яндекс' })}</p>{#if plain}<p class="muted">{ui.t('account.plainStorage')}</p>{/if}<div class="actions">{#if onconnected}<Button variant="secondary" wide onclick={() => { void onconnected?.(); }}>{ui.t('account.collections')}</Button>{/if}<Button variant="ghost" onclick={() => { void ui.api.account?.logout().catch(() => ui.notify('account.logoutFailed')); }}>{ui.t('account.logout')}</Button></div>
  {:else}<p>{ui.t('account.hint')}</p>{#if current.phase === 'error'}<p role="alert">{ui.t(`import.error.${current.error?.kind ?? 'auth'}.title`, { service: ui.t('source.ya') })}</p>{/if}<Button variant="secondary" wide onclick={() => { void login(); }}>{ui.t('import.login')}</Button>{/if}
</div>{/if}
<style>
  .account { display: grid; gap: var(--space-3); }
  p { color: var(--color-text-muted); font-size: calc(var(--font-size-sm) * var(--font-scale)); line-height: var(--line-height-body); }
  .connected { color: var(--color-text); }
  output { display: block; padding: var(--space-4); text-align: center; font-size: calc(var(--font-size-xl) * var(--font-scale)); letter-spacing: var(--letter-spacing-heading); background: var(--color-surface-2); border-radius: var(--radius-m); user-select: all; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
</style>
