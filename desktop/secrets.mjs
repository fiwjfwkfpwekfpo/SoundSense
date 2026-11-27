import { safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/*
 * Account tokens in data/account-secrets, never in app state.
 * With a system keyring (libsecret / KWallet on Linux, DPAPI on Windows) the record is
 * encrypted through Electron's safeStorage. Without one (a bare Hyprland, for example) it is
 * kept in a file only this user can read (0600) — the same protection browsers fall back to —
 * and the app says so next to the account. Nothing has to be installed for sign-in to work.
 * File: 1 byte format (1 = safeStorage, 0 = plain), then the record.
 */
const NAMES = new Set(['yandex']);
const ENCRYPTED = 1, PLAIN = 0;
export function createSecrets(paths) {
  const directory = join(paths.data, 'account-secrets');
  const file = name => { if (!NAMES.has(name)) throw new Error('Unknown account'); return join(directory, `${name}.bin`); };
  const keyring = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  const save = async (name, value) => {
    if (typeof value !== 'string' || value.length > 32000) throw new Error('Account record too large');
    const encrypted = keyring();
    if (!encrypted && process.platform === 'win32') throw new Error('Windows credential protection is unavailable');
    const target = file(name), temp = `${target}.tmp`;
    const body = encrypted ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temp, Buffer.concat([Buffer.from([encrypted ? ENCRYPTED : PLAIN]), body]), { mode: 0o600 });
    await rename(temp, target);
  };
  let pending = Promise.resolve();
  const serialize = action => { const result = pending.then(action); pending = result.catch(() => {}); return result; };
  return {
    /** Whether new records are encrypted by the system keyring. */
    encrypted: keyring,
    read: name => serialize(async () => {
      let bytes; try { bytes = await readFile(file(name)); } catch { return null; }
      if (bytes[0] === PLAIN) {
        const value = bytes.subarray(1).toString('utf8');
        if (process.platform === 'win32') await save(name, value);
        return value;
      }
      return bytes[0] === ENCRYPTED && keyring() ? safeStorage.decryptString(bytes.subarray(1)) : null;
    }),
    write: (name, value) => serialize(() => save(name, value)),
    remove: name => serialize(() => rm(file(name), { force: true })),
  };
}
