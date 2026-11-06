import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AccountSecrets } from '../core/accounts';
import { desktop } from './desktop';
interface NativeAccounts { read(options: { key: string }): Promise<{ value?: string | null }>; write(options: { key: string; value: string }): Promise<void>; remove(options: { key: string }): Promise<void>; openAuthorization(options: { url: string }): Promise<void> }
const native = registerPlugin<NativeAccounts>('Accounts');
export function accountPorts(): { secrets: AccountSecrets; open(url: string): Promise<void>; encrypted?: () => Promise<boolean> } {
  if (desktop) {
    const bridge = desktop;
    // desktop/secrets.mjs: system keyring when present, otherwise a 0600 file (no setup needed).
    return { secrets: { async read() { return (await bridge.secrets.read('yandex')).value ?? null; }, async write(value) { await bridge.secrets.write('yandex', value); }, remove: () => bridge.secrets.remove('yandex') },
      open: url => bridge.accounts.open(url), encrypted: () => bridge.secrets.encrypted() };
  }
  if (Capacitor.isNativePlatform()) return { secrets: { async read() { return (await native.read({ key: 'yandex' })).value ?? null; }, write: value => native.write({ key: 'yandex', value }), remove: () => native.remove({ key: 'yandex' }) }, open: url => native.openAuthorization({ url }) };
  // Browser previews keep a login for this session only.
  let value: string | null = null;
  return { secrets: { async read() { return value; }, async write(next) { value = next; }, async remove() { value = null; } }, async open(url) { window.open(url, '_blank', 'noopener,noreferrer'); } };
}
