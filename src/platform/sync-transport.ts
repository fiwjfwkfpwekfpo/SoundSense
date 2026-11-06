import type { OpenEndpoint, SyncConnection, SyncEndpoint } from '../core/sync/engine';
/*
 * WebRTC transport for device sync (PeerJS, MIT). The public PeerJS server only introduces the
 * devices (it sees peer ids, never the data); data then goes directly between them, or through
 * PeerJS's TURN relay when both sit behind strict NATs. The same code runs in the Android
 * WebView and in the desktop window. A custom signalling server can be set later (options).
 */
type PeerModule = typeof import('peerjs');
let module: Promise<PeerModule> | undefined;
const load = () => module ??= import('peerjs');

export function peerTransport(options: { host?: string; port?: number; path?: string; secure?: boolean } = {}): OpenEndpoint {
  return async id => {
    const { Peer } = await load();
    const peer = new Peer(id, { debug: 0, ...options });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server-timeout')), 15_000);
      peer.once('open', () => { clearTimeout(timer); resolve(); });
      peer.once('error', error => { clearTimeout(timer); reject(new Error((error as { type?: string }).type ?? String(error))); });
    });
    // Signalling may drop (sleep, network change); established data channels keep working.
    // Reconnecting is retried (3 s, 6 s … 30 s) until the server takes the identity back.
    let healTimer: ReturnType<typeof setTimeout> | undefined, healDelay = 3000;
    const heal = () => {
      if (peer.destroyed || !peer.disconnected) return;
      try { peer.reconnect(); } catch { /* Next round. */ }
      healTimer = setTimeout(heal, healDelay); healDelay = Math.min(30_000, healDelay * 2);
    };
    peer.on('disconnected', () => { clearTimeout(healTimer); healDelay = 3000; healTimer = setTimeout(heal, healDelay); });
    peer.on('open', () => { clearTimeout(healTimer); healDelay = 3000; });
    // A destroyed peer (fatal server error) cannot recover: the engine opens a new identity.
    const closers: (() => void)[] = [];
    peer.on('close', () => { clearTimeout(healTimer); for (const listener of closers) listener(); });
    const failures = new Map<string, (error: Error) => void>();
    peer.on('error', error => {
      const type = (error as { type?: string }).type;
      if (type === 'peer-unavailable') for (const [target, fail] of failures) if (String(error.message).includes(target)) fail(new Error('peer-unavailable'));
    });
    /** Messages that arrive before the engine listens are kept, so a "hello" is never lost. */
    const wrap = (connection: import('peerjs').DataConnection): SyncConnection => {
      const early: unknown[] = []; let deliver: ((message: unknown) => void) | undefined;
      connection.on('data', message => { if (deliver) deliver(message); else early.push(message); });
      // A failed ICE state never comes back; a merely 'disconnected' one may, and the engine's keep-alive judges it.
      connection.on('iceStateChanged', state => { if (state === 'failed' || state === 'closed') try { connection.close(); } catch { /* Gone. */ } });
      return {
      peer: connection.peer,
      send: message => { try { connection.send(message); } catch { /* Closed. */ } },
      onMessage: listener => { const previous = deliver; deliver = previous ? message => { previous(message); listener(message); } : listener; for (const message of early.splice(0)) listener(message); },
      onClose: listener => { connection.on('close', listener); connection.on('error', listener); },
      close: () => connection.close(),
      };
    };
    const endpoint: SyncEndpoint = {
      connect: target => new Promise((resolve, reject) => {
        // 'binary' (BinaryPack) splits large messages into 16 KB chunks; 'json' refuses anything bigger.
        const connection = peer.connect(target, { reliable: true, serialization: 'binary' });
        const done = (error?: Error) => { clearTimeout(timer); failures.delete(target); if (error) { try { connection.close(); } catch { /* Never opened. */ } reject(error); } else resolve(wrap(connection)); };
        const timer = setTimeout(() => done(new Error('timeout')), 20_000);
        failures.set(target, done);
        connection.once('open', () => done());
        connection.once('error', error => done(error instanceof Error ? error : new Error(String(error))));
      }),
      onClose: listener => { closers.push(listener); },
      onConnection: listener => { peer.on('connection', connection => connection.once('open', () => listener(wrap(connection)))); },
      close: () => { clearTimeout(healTimer); try { peer.destroy(); } catch { /* Already gone. */ } },
    };
    return endpoint;
  };
}
