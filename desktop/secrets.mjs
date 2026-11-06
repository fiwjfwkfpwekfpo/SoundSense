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
  return {
    /** Whether new records are encrypted by the system keyring. */
    encrypted: keyring,
    async read(name) {
      let bytes; try { bytes = await readFile(file(name)); } catch { return null; }
      if (bytes[0] === PLAIN) return bytes.subarray(1).toString('utf8');
      if (bytes[0] === ENCRYPTED && keyring()) return safeStorage.decryptString(bytes.subarray(1));
      return null; // Encrypted by a keyring that is no longer available: sign in again.
    },
    async write(name, value) {
      if (typeof value !== 'string' || value.length > 32000) throw new Error('Account record too large');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const body = keyring() ? Buffer.concat([Buffer.from([ENCRYPTED]), safeStorage.encryptString(value)]) : Buffer.concat([Buffer.from([PLAIN]), Buffer.from(value, 'utf8')]);
      const target = file(name), temp = `${target}.tmp`;
      await writeFile(temp, body, { mode: 0o600 }); await rename(temp, target);
    },
    remove: name => rm(file(name), { force: true }),
  };
}
