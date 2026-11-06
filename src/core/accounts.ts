import type { HttpClient } from './http';
import { HttpFailure } from './http';
import { ImportFailure, classifyImportError } from './imports';

export interface AccountState { phase: 'disconnected' | 'requesting' | 'waiting' | 'connected' | 'error'; userCode?: string; verificationUrl?: string; expiresAt?: number; name?: string; uid?: string; error?: ImportFailure }
export interface AccountApi {
  getSnapshot(): AccountState;
  subscribe(listener: (value: AccountState) => void): () => void;
  login(): Promise<void>; cancel(): void; logout(): Promise<void>; openAuthorization(): Promise<void>;
}
export interface AccountSecrets { read(): Promise<string | null>; write(value: string): Promise<void>; remove(): Promise<void> }
interface Credential { accessToken: string; refreshToken?: string; expiresAt: number; uid?: string; name?: string }
interface Token { access_token: string; refresh_token?: string; expires_in?: number }
// Public interoperability credentials of Yandex Music's Android OAuth client.
// User credentials are separate and live only in the injected system secret store.
const client = { client_id: '23cabbbdc6cd418abb4b39c32c41195d', client_secret: '53bc75238f0c4d08a118e51fe9203300' };
const oauth = 'https://oauth.yandex.ru';
const validPage = (input: string) => {
  const url = new URL(input);
  const allowed = ['oauth.yandex.ru', 'oauth.yandex.com'].includes(url.hostname) || url.hostname === 'ya.ru' && /^\/device\/?$/.test(url.pathname);
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port && url.port !== '443') throw new ImportFailure('auth');
  return url.href;
};
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
export function createYandexAccount(http: HttpClient, secrets: AccountSecrets, open: (url: string) => Promise<void>, delay = wait) {
  let state: AccountState = { phase: 'disconnected' }, credential: Credential | undefined, controller: AbortController | undefined, refresh: Promise<string | undefined> | undefined;
  let revision = 0, writes: Promise<void> = Promise.resolve();
  const persist = (operation: () => Promise<void>) => writes = writes.catch(() => {}).then(operation);
  const assertCurrent = (version: number) => { if (version !== revision) throw new DOMException('Account changed', 'AbortError'); };
  const listeners = new Set<(value: AccountState) => void>();
  const publish = (value: AccountState) => { state = value; for (const listener of listeners) listener(value); };
  const initialized = secrets.read().then(raw => { if (raw) { const value = JSON.parse(raw); if (typeof value.accessToken === 'string' && Number.isFinite(value.expiresAt)) { credential = value; publish({ phase: 'connected', name: value.name, uid: value.uid }); } } }).catch(() => { publish({ phase: 'error', error: new ImportFailure('auth') }); });
  async function post<T>(path: string, fields: Record<string, string>, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await http.text(oauth + path, signal, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));
  }
  async function save(token: Token, version: number) {
    assertCurrent(version);
    if (!token.access_token || !/^[A-Za-z\d_.~-]+$/.test(token.access_token)) throw new ImportFailure('auth');
    const next: Credential = { ...credential, accessToken: token.access_token, refreshToken: token.refresh_token ?? credential?.refreshToken, expiresAt: Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000 };
    await persist(async () => { assertCurrent(version); await secrets.write(JSON.stringify(next)); }); assertCurrent(version); credential = next;
  }
  async function getToken(): Promise<string | undefined> {
    await initialized; if (!credential) return;
    if (credential.expiresAt > Date.now() + 30000) return credential.accessToken;
    if (!credential.refreshToken) throw new ImportFailure('expired');
    if (!refresh) { const version = revision; refresh = post<Token>('/token', { ...client, grant_type: 'refresh_token', refresh_token: credential.refreshToken }).then(async token => { await save(token, version); return credential?.accessToken; }).finally(() => refresh = undefined); }
    return refresh;
  }
  const api: AccountApi = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async login() {
      await initialized;
      controller?.abort(); const active = controller = new AbortController(), signal = active.signal;
      const version = ++revision;
      publish({ phase: 'requesting' });
      try {
        const code = await post<{ device_code: string; user_code: string; verification_url?: string; verification_uri?: string; expires_in: number; interval?: number }>('/device/code', { client_id: client.client_id, device_id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), device_name: 'SoundSense' }, signal);
        if (!code.device_code || !code.user_code || !Number.isFinite(code.expires_in)) throw new ImportFailure('auth');
        const expiresAt = Date.now() + Math.max(30, Math.min(1800, code.expires_in)) * 1000;
        publish({ phase: 'waiting', userCode: code.user_code, verificationUrl: validPage(code.verification_url ?? code.verification_uri ?? ''), expiresAt });
        let interval = Math.max(1, code.interval ?? 5);
        while (!signal.aborted && Date.now() < expiresAt) {
          await delay(interval * 1000, signal);
          try { const token = await post<Token>('/token', { ...client, grant_type: 'device_code', code: code.device_code }, signal); signal.throwIfAborted(); await save(token, version); publish({ phase: 'connected' }); return; }
          catch (error) {
            signal.throwIfAborted();
            let kind = ''; if (error instanceof HttpFailure) { try { kind = JSON.parse(error.responseText).error ?? ''; } catch {} }
            if (kind === 'authorization_pending') continue;
            if (kind === 'slow_down') { interval += 5; continue; }
            if (kind === 'expired_token') throw new ImportFailure('expired');
            throw error;
          }
        }
        throw new ImportFailure('expired');
      } catch (error) { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); const failure = classifyImportError(error); publish({ phase: 'error', error: failure }); throw failure; }
    },
    cancel() { controller?.abort(); revision++; publish(credential ? { phase: 'connected', name: credential.name, uid: credential.uid } : { phase: 'disconnected' }); },
    async logout() { controller?.abort(); revision++; await initialized; await persist(() => secrets.remove()); credential = undefined; publish({ phase: 'disconnected' }); },
    async openAuthorization() { if (state.verificationUrl) await open(validPage(state.verificationUrl)); },
  };
  return { api, getToken, async identify(uid: string, name: string) { if (credential) { const version = revision, next = { ...credential, uid, name }; await persist(async () => { assertCurrent(version); await secrets.write(JSON.stringify(next)); }); assertCurrent(version); credential = next; publish({ phase: 'connected', uid, name }); } } };
}
