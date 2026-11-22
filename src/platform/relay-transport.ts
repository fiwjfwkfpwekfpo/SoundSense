import type { OpenEndpoint, SyncConnection, SyncEndpoint } from '../core/sync/engine';
/*
 * WebRTC transport for device sync with public Nostr relays as the meeting point.
 * The relays only pass two short, encrypted notes per connection (offer and answer); the data
 * itself goes directly between the devices (or through a TURN relay behind strict NATs).
 * Several relays are used at once: one blocked or down relay does not stop the meeting.
 * Notes are ephemeral events (not stored by relays) addressed by a hash of the device id and
 * encrypted with a key derived from it: a relay sees neither the id nor the addresses inside.
 */
export const DEFAULT_RELAYS: readonly string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub'];
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const KIND = 29233, CHUNK = 16_000, GATHER = 4_000, ANSWER = 15_000, OPEN = 20_000;
type Note = { type: 'offer' | 'answer'; from: string; cid: string; sdp: string };

const encoder = new TextEncoder(), decoder = new TextDecoder();
const toHex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16));
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
const topic = async (id: string) => `ss1-${toHex(await sha256(`soundsense/sync/topic|${id}`)).slice(0, 40)}`;
async function key(id: string) { return crypto.subtle.importKey('raw', await sha256(`soundsense/sync/key|${id}`), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(id: string, note: Note) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(id), encoder.encode(JSON.stringify(note))));
  return `${toHex(iv)}.${btoa(String.fromCharCode(...data))}`;
}
async function open(id: string, content: string): Promise<Note | null> {
  try {
    const [iv, body] = content.split('.'); if (!iv || !body) return null;
    const data = Uint8Array.from(atob(body), value => value.charCodeAt(0));
    const note = JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(iv) }, await key(id), data))) as Note;
    return note && (note.type === 'offer' || note.type === 'answer') && typeof note.from === 'string' && typeof note.cid === 'string' && typeof note.sdp === 'string' ? note : null;
  } catch { return null; }
}

/** One signing key per endpoint; Nostr events need a valid Schnorr signature or relays drop them. */
async function signer() {
  const { schnorr } = await import('@noble/curves/secp256k1');
  const secret = schnorr.utils.randomPrivateKey(), pubkey = toHex(schnorr.getPublicKey(secret));
  return async (tag: string, content: string) => {
    const created_at = Math.floor(Date.now() / 1000), tags = [['t', tag]];
    const id = toHex(await sha256(JSON.stringify([0, pubkey, created_at, KIND, tags, content])));
    return { id, pubkey, created_at, kind: KIND, tags, content, sig: toHex(schnorr.sign(fromHex(id), secret)) };
  };
}

/** A set of relay sockets that reconnect by themselves and keep one subscription. */
function relays(urls: readonly string[], tag: string, onEvent: (event: { id: string; content: string }) => void) {
  const sockets = new Map<string, WebSocket>(), seen = new Set<string>(), ready = new Set<string>();
  let closed = false; const waiters: (() => void)[] = [];
  const connect = (url: string, delay = 0) => setTimeout(() => {
    if (closed) return;
    let socket: WebSocket; try { socket = new WebSocket(url); } catch { connect(url, Math.min(60_000, (delay || 2000) * 2)); return; }
    sockets.set(url, socket);
    socket.onopen = () => { socket.send(JSON.stringify(['REQ', 'ss', { kinds: [KIND], '#t': [tag], since: Math.floor(Date.now() / 1000) - 30 }])); ready.add(url); for (const done of waiters.splice(0)) done(); };
    socket.onmessage = message => {
      try {
        const data = JSON.parse(String(message.data));
        if (data[0] === 'EVENT' && data[2]?.kind === KIND && typeof data[2].content === 'string' && !seen.has(data[2].id)) { seen.add(data[2].id); if (seen.size > 500) seen.delete(seen.values().next().value!); onEvent(data[2]); }
      } catch { /* Not ours. */ }
    };
    socket.onclose = () => { ready.delete(url); if (sockets.get(url) === socket) sockets.delete(url); if (!closed) connect(url, Math.min(60_000, (delay || 1000) * 2)); };
    socket.onerror = () => { try { socket.close(); } catch { /* Closing anyway. */ } };
  }, delay);
  for (const url of urls) connect(url);
  return {
    /** Resolves once any relay listens; rejects when none answered in time. */
    ready: (ms: number) => new Promise<void>((resolve, reject) => { if (ready.size) { resolve(); return; } const timer = setTimeout(() => reject(new Error('server-timeout')), ms); waiters.push(() => { clearTimeout(timer); resolve(); }); }),
    publish(event: unknown) { const text = JSON.stringify(['EVENT', event]); for (const url of ready) try { sockets.get(url)?.send(text); } catch { /* Next relay. */ } },
    close() { closed = true; for (const socket of sockets.values()) try { socket.close(); } catch { /* Gone. */ } sockets.clear(); },
  };
}

/** Waits until ICE gathering is done (or a few seconds): one note carries every candidate. */
function gathered(pc: RTCPeerConnection) {
  return new Promise<void>(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const timer = setTimeout(resolve, GATHER);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
  });
}
/** Messages are JSON, cut into 16 KB pieces (data channels drop large messages on some stacks). */
function wrap(peer: string, pc: RTCPeerConnection, channel: RTCDataChannel): SyncConnection {
  const early: unknown[] = [], parts = new Map<string, string[]>(); let deliver: ((message: unknown) => void) | undefined, counter = 0;
  const closers: (() => void)[] = []; let ended = false;
  const end = () => { if (ended) return; ended = true; for (const listener of closers) listener(); try { channel.close(); } catch { /* Gone. */ } try { pc.close(); } catch { /* Gone. */ } };
  channel.onmessage = event => {
    const text = String(event.data), [head, ...rest] = text.split('\n'), body = rest.join('\n');
    const [id, index, count] = head!.split(':'), list = parts.get(id!) ?? Array<string>(Number(count));
    list[Number(index)] = body; parts.set(id!, list);
    if (list.filter(item => item !== undefined).length < Number(count)) return;
    parts.delete(id!);
    let message: unknown; try { message = JSON.parse(list.join('')); } catch { return; }
    if (deliver) deliver(message); else early.push(message);
  };
  channel.onclose = end; channel.onerror = end;
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end(); });
  return {
    peer,
    send(message) {
      if (channel.readyState !== 'open') return;
      const text = JSON.stringify(message), id = `${++counter}`, count = Math.max(1, Math.ceil(text.length / CHUNK));
      try { for (let index = 0; index < count; index++) channel.send(`${id}:${index}:${count}\n${text.slice(index * CHUNK, (index + 1) * CHUNK)}`); } catch { /* Closed. */ }
    },
    onMessage(listener) { const previous = deliver; deliver = previous ? message => { previous(message); listener(message); } : listener; for (const message of early.splice(0)) listener(message); },
    onClose(listener) { closers.push(listener); },
    close: end,
  };
}

export function relayTransport(urls: readonly string[] = DEFAULT_RELAYS, iceServers: RTCIceServer[] = ICE_SERVERS): OpenEndpoint {
  return async id => {
    if (typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') throw new Error('unsupported');
    const sign = await signer(), mine = await topic(id);
    const answers = new Map<string, (note: Note) => void>(), incoming: ((connection: SyncConnection) => void)[] = [], pending: SyncConnection[] = [];
    const accept = (connection: SyncConnection) => { if (incoming.length) for (const listener of incoming) listener(connection); else pending.push(connection); };
    // Notes to another device go out through our own relay sockets (a relay takes events on any socket).
    const note = async (target: string, value: Note) => hub.publish(await sign(await topic(target), await seal(target, value)));
    async function answer(offer: Note) {
      const pc = new RTCPeerConnection({ iceServers });
      pc.ondatachannel = event => { const channel = event.channel; const ready = () => accept(wrap(offer.from, pc, channel)); if (channel.readyState === 'open') ready(); else channel.onopen = ready; };
      setTimeout(() => { if (pc.connectionState !== 'connected') try { pc.close(); } catch { /* Gone. */ } }, OPEN + GATHER);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
      await note(offer.from, { type: 'answer', from: id, cid: offer.cid, sdp: pc.localDescription!.sdp });
    }
    const hub = relays(urls, mine, event => { void open(id, event.content).then(value => {
      if (!value || value.from === id) return;
      if (value.type === 'answer') answers.get(value.cid)?.(value);
      else void answer(value).catch(() => { /* A broken offer: the other side times out and redials. */ });
    }); });
    try { await hub.ready(12_000); } catch (error) { hub.close(); throw error; }
    const endpoint: SyncEndpoint = {
      connect: target => new Promise<SyncConnection>((resolve, reject) => {
        const pc = new RTCPeerConnection({ iceServers }), channel = pc.createDataChannel('ss', { ordered: true }), cid = crypto.randomUUID();
        let finished = false;
        const done = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); answers.delete(cid); if (error) { try { pc.close(); } catch { /* Gone. */ } reject(error); } else resolve(wrap(target, pc, channel)); };
        // No answer at all: the device is offline (same meaning as PeerJS "peer-unavailable").
        let timer = setTimeout(() => done(new Error('peer-unavailable')), ANSWER + GATHER);
        answers.set(cid, value => { clearTimeout(timer); timer = setTimeout(() => done(new Error('timeout')), OPEN); void pc.setRemoteDescription({ type: 'answer', sdp: value.sdp }).catch(error => done(error instanceof Error ? error : new Error(String(error)))); });
        channel.onopen = () => done();
        pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') done(new Error('ice-failed')); });
        void (async () => { await pc.setLocalDescription(await pc.createOffer()); await gathered(pc); if (!finished) await note(target, { type: 'offer', from: id, cid, sdp: pc.localDescription!.sdp }); })().catch(error => done(error instanceof Error ? error : new Error(String(error))));
      }),
      onConnection(listener) { incoming.push(listener); for (const connection of pending.splice(0)) listener(connection); },
      close() { hub.close(); },
    };
    return endpoint;
  };
}

/**
 * Several transports at once (relays first, PeerJS as the spare). The identity is ready as soon
 * as any of them opens; a slower one joins later. Incoming connections arrive from all of them,
 * and a dial tries each in order.
 */
export function combinedTransport(...transports: OpenEndpoint[]): OpenEndpoint {
  return id => new Promise<SyncEndpoint>((resolve, reject) => {
    const slots: (SyncEndpoint | undefined)[] = transports.map(() => undefined), alive = new Set<SyncEndpoint>();
    const incoming: ((connection: SyncConnection) => void)[] = [], closers: (() => void)[] = [];
    let failures = 0, settled = false, closed = false, firstError: unknown;
    const combined: SyncEndpoint = {
      async connect(target) {
        let last: unknown = new Error('peer-unavailable');
        for (const endpoint of slots) { if (!endpoint || !alive.has(endpoint)) continue; try { return await endpoint.connect(target); } catch (error) { last = error; } }
        throw last;
      },
      onConnection(listener) { incoming.push(listener); for (const endpoint of alive) endpoint.onConnection(listener); },
      onClose(listener) { closers.push(listener); },
      close() { closed = true; for (const endpoint of alive) endpoint.close(); alive.clear(); },
    };
    transports.forEach((transport, index) => {
      transport(id).then(endpoint => {
        if (closed) { endpoint.close(); return; }
        slots[index] = endpoint; alive.add(endpoint);
        for (const listener of incoming) endpoint.onConnection(listener);
        endpoint.onClose?.(() => { alive.delete(endpoint); if (!alive.size && !closed) for (const listener of closers) listener(); });
        if (!settled) { settled = true; resolve(combined); }
      }, error => {
        firstError ??= error;
        if (++failures === transports.length && !settled) { settled = true; reject(firstError); }
      });
    });
  });
}
