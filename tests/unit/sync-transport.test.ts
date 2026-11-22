import { describe, expect, it } from 'vitest';
import { combinedTransport } from '../../src/platform/relay-transport';
import type { OpenEndpoint, SyncConnection, SyncEndpoint } from '../../src/core/sync/engine';

const connection = (peer: string): SyncConnection => ({ peer, send() {}, onMessage() {}, onClose() {}, close() {} });
function fake(options: { fail?: boolean; delay?: number; reach?: string[] } = {}) {
  const listeners: ((connection: SyncConnection) => void)[] = [];
  const open: OpenEndpoint = id => new Promise((resolve, reject) => setTimeout(() => options.fail ? reject(new Error('server-timeout')) : resolve({
    connect: async target => { if (!options.reach?.includes(target)) throw new Error('peer-unavailable'); return connection(`${id}->${target}`); },
    onConnection: listener => { listeners.push(listener); }, close() {},
  } satisfies SyncEndpoint), options.delay ?? 0));
  return { open, incoming: (peer: string) => { for (const listener of listeners) listener(connection(peer)); } };
}
describe('combined sync transport', () => {
  it('opens when one transport is blocked and dials through the one that reaches the device', async () => {
    const relays = fake({ reach: ['phone'] }), peerjs = fake({ fail: true });
    const endpoint = await combinedTransport(relays.open, peerjs.open)('pc');
    expect((await endpoint.connect('phone')).peer).toBe('pc->phone');
    await expect(endpoint.connect('tablet')).rejects.toThrow('peer-unavailable');
  });
  it('falls back to the spare transport and takes connections from a late one', async () => {
    const relays = fake(), peerjs = fake({ delay: 20, reach: ['old-phone'] });
    const endpoint = await combinedTransport(relays.open, peerjs.open)('pc');
    const seen: string[] = []; endpoint.onConnection(value => seen.push(value.peer));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect((await endpoint.connect('old-phone')).peer).toBe('pc->old-phone');
    peerjs.incoming('x'); relays.incoming('y'); expect(seen).toEqual(['x', 'y']);
  });
  it('fails only when every transport failed', async () => {
    await expect(combinedTransport(fake({ fail: true }).open, fake({ fail: true }).open)('pc')).rejects.toThrow('server-timeout');
  });
});
