import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const directory = join(homedir(), '.local/share/SoundSense/signing');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const filename = join(directory, 'update-ed25519.pem');
if (!existsSync(filename)) {
  const key = generateKeyPairSync('ed25519');
  writeFileSync(filename, key.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
}
const publicDer = createPublicKey(readFileSync(filename)).export({ format: 'der', type: 'spki' });
const key = { schema: 1, algorithm: 'ed25519', publicKey: publicDer.subarray(-32).toString('hex') };
writeFileSync(new URL('../../src/core/update-key.json', import.meta.url), JSON.stringify(key, null, 2) + '\n');
console.log('The local signing key is ready; only its public key was written to the application.');
