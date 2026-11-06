import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { ProxyOptions } from 'vite';
import channels from './channels.json';
import manifest from '../package.json';
import { fileURLToPath } from 'node:url';
const proxy: Record<string, ProxyOptions> = {};
for (const [prefix, target] of Object.entries({ '/public/sc-api': 'https://api-v2.soundcloud.com', '/public/sc-assets': 'https://a-v2.sndcdn.com', '/public/sc-wave': 'https://wave.sndcdn.com', '/public/sc': 'https://soundcloud.com', '/public/spotify-api': 'https://api-partner.spotify.com', '/public/spotify': 'https://open.spotify.com', '/public/yandex-oauth': 'https://oauth.yandex.ru', '/public/yandex': 'https://api.music.yandex.net', '/public/deezer': 'https://api.deezer.com', '/public/genius': 'https://genius.com', '/public/musixmatch': 'https://apic-desktop.musixmatch.com', '/public/apple-music': 'https://music.apple.com', '/public/apple': 'https://itunes.apple.com', '/public/youtube-music': 'https://music.youtube.com', '/public/youtube-api': 'https://youtubei.googleapis.com', '/public/youtube': 'https://www.youtube.com', '/public/lyrics': 'https://lrclib.net' })) {
  proxy[prefix] = { target, changeOrigin: true, rewrite: path => path.slice(prefix.length), configure(server) { server.on('proxyReq', request => { request.removeHeader('cookie'); if (!['/public/yandex', '/public/spotify-api'].includes(prefix)) request.removeHeader('authorization'); }); } };
}
export default defineConfig(() => {
  const name = process.env.SS_CHANNEL ?? 'stable';
  if (name !== 'stable' && name !== 'beta') throw new Error(`Unknown release channel: ${name}`);
  const channel = channels[name];
  return {
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [svelte(), {
      name: 'release-channel',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ channel: name, ...channel, version: manifest.version, versionCode: manifest.versionCode * 10 + (name === 'stable' ? 5 : 0) }) + '\n' });
      },
    }],
    define: { __APP_CHANNEL__: JSON.stringify(name), __DEBUG_TOOLS__: JSON.stringify(channel.debugTools) },
    server: { port: 5173, strictPort: true, proxy },
    worker: { format: 'es' },
    optimizeDeps: { include: ['music-metadata'] },
    build: { target: 'es2022', outDir: `dist/${name}` },
    test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  };
});
