#!/usr/bin/env node
/**
 * Watches the repository (raw.githubusercontent.com, no API token needed) and posts to the channel and the forum:
 *  - a new version in the `releases` branch (stable.json / beta.json, signed manifest read as plain JSON);
 *  - new or updated plugins in plugins/catalog.json.
 * TG_TOKEN=… node tools/telegram/watch.mjs        (runs until stopped; see soundsense-bot.service)
 */
import { send, loadState, saveState, config, fetchText, links, sleep } from './lib.mjs';
import { releaseMessage, pluginsMessage } from './content.mjs';

const INTERVAL = Number(process.env.POLL_SECONDS ?? 300) * 1000;
const log = (...args) => console.log(new Date().toISOString(), ...args);

async function toBoth(text, topicKey) {
  const state = loadState();
  await send(config.channel, text);
  const thread = state.topics?.[topicKey];
  if (thread) await send(config.group, text, { message_thread_id: thread });
}

async function checkReleases() {
  for (const channel of ['stable', 'beta']) {
    const text = await fetchText(`${links.raw}/releases/${channel}.json`);
    if (!text) continue;
    let manifest;
    try { manifest = JSON.parse(Buffer.from(JSON.parse(text).payload, 'base64').toString('utf8')); } catch { log(`${channel}.json is not readable`); continue; }
    const state = loadState(); state.releases ??= {};
    if (!(manifest.versionCode > (state.releases[channel] ?? 0))) continue;
    if (manifest.channel && manifest.channel !== channel) continue;
    const platforms = Object.keys(manifest.artifacts ?? {}), first = Object.values(manifest.artifacts ?? {})[0];
    await toBoth(releaseMessage({
      version: manifest.version, channel, notes: manifest.notes ?? { ru: [], en: [] }, platforms,
      links: [...new Set(Object.values(manifest.artifacts ?? {}).map(artifact => artifact.urls?.[0]).filter(Boolean))],
      size: first ? (first.size / 1024 / 1024).toFixed(1) : '',
    }), 'releases');
    state.releases[channel] = manifest.versionCode; saveState(state);
    log(`announced ${manifest.version} ${channel}`);
  }
}

async function checkPlugins() {
  const text = await fetchText(`${links.raw}/main/plugins/catalog.json`);
  if (!text) return;
  const catalog = JSON.parse(text).plugins ?? [], state = loadState(); state.plugins ??= {};
  const changed = catalog.filter(plugin => state.plugins[plugin.id] !== plugin.version).map(plugin => ({ ...plugin, isNew: !(plugin.id in state.plugins) }));
  if (!changed.length) return;
  await toBoth(pluginsMessage(changed), 'plugins');
  for (const plugin of changed) state.plugins[plugin.id] = plugin.version;
  saveState(state); log(`announced ${changed.length} plugin(s)`);
}

log('watching', links.repo);
for (;;) {
  for (const task of [checkReleases, checkPlugins]) { try { await task(); } catch (error) { log(task.name, 'failed:', error.message); } }
  await sleep(INTERVAL);
}
