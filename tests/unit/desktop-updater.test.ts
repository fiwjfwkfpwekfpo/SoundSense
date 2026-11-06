import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanEnv, createUpdater, validateArtifact } from '../../desktop/updater.mjs';

/** A stand-in for an AppImage: ELF magic and the AppImage type 2 marker, then filler. */
const image = (fill: string, size = 4096) => { const bytes = Buffer.alloc(size, fill); Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes, 0); Buffer.from([0x41, 0x49, 0x02]).copy(bytes, 8); return bytes; };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stream = (bytes: Buffer, chunk = 1000) => new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(new Uint8Array(bytes.subarray(i, i + chunk))); controller.close(); } });
const reply = (bytes: Buffer, status = 200) => ({ ok: status === 200, status, body: stream(bytes) }) as unknown as Response;

let root = '', cache = '', installed = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-updater-')); cache = join(root, 'cache'); mkdirSync(join(root, 'apps')); installed = join(root, 'apps', 'SoundSense.AppImage'); writeFileSync(installed, image('o')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const artifact = (bytes: Buffer, urls = ['https://example.test/SoundSense-1.5.0-stable-x86_64.AppImage']) => ({ filename: 'SoundSense-1.5.0-stable-x86_64.AppImage', size: bytes.length, sha256: sha(bytes), urls });

describe('desktop updater', () => {
  it('accepts only well-formed artifacts', () => {
    const good = artifact(image('n'));
    expect(validateArtifact(good).filename).toBe(good.filename);
    for (const bad of [{ ...good, filename: '../x.AppImage' }, { ...good, filename: 'x.apk' }, { ...good, size: 0 }, { ...good, size: 600 * 1024 * 1024 }, { ...good, sha256: 'zz' }, { ...good, urls: ['http://x.test/a'] }, { ...good, urls: ['https://u:p@x.test/a'] }, { ...good, urls: [] }, null])
      expect(() => validateArtifact(bad)).toThrow();
  });

  it('downloads, verifies, replaces the AppImage and starts the new one after this process exits', async () => {
    const next = image('n'), fetch = vi.fn(async () => reply(next)), progress = vi.fn(), quit = vi.fn(), spawnFile = vi.fn(() => ({ unref() {} }));
    const updater = createUpdater({ cache, appImage: installed, fetch: fetch as never, onProgress: progress, quit, spawnFile: spawnFile as never, pid: 4242, env: { PATH: '/usr/bin', APPDIR: '/tmp/.mount_x', LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib:/usr/lib', APPIMAGE: installed } });
    const token = await updater.download('job', artifact(next));
    expect(progress).toHaveBeenLastCalledWith({ id: 'job', bytes: next.length });
    expect(readdirSync(join(cache, 'updates'))).toEqual(['SoundSense-1.5.0-stable-x86_64.AppImage']);
    expect(await updater.install(token)).toBe('opened');
    expect(readFileSync(installed).equals(next)).toBe(true);
    expect(statSync(installed).mode & 0o111).toBe(0o111);
    expect(existsSync(`${installed}.update`)).toBe(false);
    expect(readdirSync(join(cache, 'updates'))).toEqual([]);
    const [file, args, options] = spawnFile.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; detached: boolean }];
    expect(file).toBe('/bin/sh'); expect(args.slice(-2)).toEqual(['4242', installed]); expect(options.detached).toBe(true);
    expect(options.env.APPIMAGE).toBeUndefined(); expect(options.env.LD_LIBRARY_PATH).toBe('/usr/lib');
    expect(quit).toHaveBeenCalledOnce();
  });

  it('refuses a file whose hash or size differs and leaves the installed app alone', async () => {
    const announced = image('n'), tampered = image('x');
    const updater = createUpdater({ cache, appImage: installed, fetch: (async () => reply(tampered)) as never });
    await expect(updater.download('a', artifact(announced))).rejects.toThrow(/hash/);
    const bigger = Buffer.concat([announced, Buffer.from('extra')]);
    await expect(createUpdater({ cache, appImage: installed, fetch: (async () => reply(bigger)) as never }).download('b', artifact(announced))).rejects.toThrow(/larger/);
    const shorter = announced.subarray(0, 100);
    await expect(createUpdater({ cache, appImage: installed, fetch: (async () => reply(shorter)) as never }).download('c', artifact(announced))).rejects.toThrow(/size/);
    expect(readFileSync(installed).equals(image('o'))).toBe(true);
    expect(readdirSync(join(cache, 'updates'))).toEqual([]);
  });

  it('falls back to the next address', async () => {
    const next = image('n'); const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => { calls.push(url); return url.includes('bad') ? reply(Buffer.alloc(0), 404) : reply(next); });
    const updater = createUpdater({ cache, appImage: installed, fetch: fetch as never });
    await updater.download('a', artifact(next, ['https://bad.test/a.AppImage', 'https://good.test/a.AppImage']));
    expect(calls).toEqual(['https://bad.test/a.AppImage', 'https://good.test/a.AppImage']);
  });

  it('never installs a file that is not an AppImage, even with a matching hash', async () => {
    const text = Buffer.from('#!/bin/sh\nrm -rf ~\n'.repeat(50));
    const updater = createUpdater({ cache, appImage: installed, fetch: (async () => reply(text)) as never, spawnFile: vi.fn() as never });
    const token = await updater.download('a', artifact(text));
    await expect(updater.install(token)).rejects.toThrow(/not an AppImage/);
    expect(readFileSync(installed).equals(image('o'))).toBe(true);
  });

  it('can be cancelled, and refuses to run outside an AppImage', async () => {
    const next = image('n');
    const slow = vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')))));
    const updater = createUpdater({ cache, appImage: installed, fetch: slow as never });
    const pending = updater.download('a', artifact(next)); await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    updater.cancel('a'); await expect(pending).rejects.toThrow();
    const dev = createUpdater({ cache, fetch: (async () => reply(next)) as never });
    expect(dev.available()).toBe(false); await expect(dev.download('b', artifact(next))).rejects.toThrow(/AppImage/);
  });

  it('cleanEnv removes the old mount from the environment', () => {
    expect(cleanEnv({ PATH: '/tmp/.mount_a/usr/bin:/usr/bin', APPDIR: '/tmp/.mount_a', ARGV0: 'x', OWD: '/', HOME: '/h' })).toEqual({ PATH: '/usr/bin', HOME: '/h' });
    expect(cleanEnv({ HOME: '/h' })).toEqual({ HOME: '/h' });
  });
});
