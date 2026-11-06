#!/usr/bin/env node
/**
 * One-time (and repeatable) setup of the channel and the forum: descriptions, topics, rules.
 * Rules are posted once, pinned silently and the "pinned" service message is deleted. Running it again edits the rules
 * in place instead of posting new ones.   TG_TOKEN=… node tools/telegram/setup.mjs
 */
import { api, send, pinClean, loadState, saveState, config, fetchText, links, sleep } from './lib.mjs';
import { descriptions, channelRules, generalRules, topics } from './content.mjs';

const state = loadState();
state.topics ??= {}; state.rules ??= {};
const same = error => /message is not modified/i.test(String(error?.message));

async function postRules(key, chat, text, extra = {}) {
  const known = state.rules[key];
  if (known) { try { await api('editMessageText', { chat_id: chat, message_id: known, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }); } catch (error) { if (!same(error)) throw error; } return; }
  const message = await send(chat, text, extra);
  state.rules[key] = message.message_id; saveState(state);
  await pinClean(chat, message.message_id);
}

const chunks = text => text;
// Descriptions
for (const [chat, text] of [[config.channel, descriptions.channel], [config.group, descriptions.group]]) {
  if (text.length > 255) throw new Error(`Description for ${chat} is ${text.length} characters (limit 255)`);
  await api('setChatDescription', { chat_id: chat, description: text });
}
console.log('descriptions set');

// Channel rules
await postRules('channel', config.channel, channelRules);
console.log('channel rules ok');

// Forum: General + topics
await postRules('general', config.group, generalRules, {});
for (const [key, topic] of Object.entries(topics)) {
  if (!state.topics[key]) {
    const created = await api('createForumTopic', { chat_id: config.group, name: topic.name, icon_color: topic.color });
    state.topics[key] = created.message_thread_id; saveState(state); await sleep(800);
  }
  await postRules(`topic:${key}`, config.group, topic.text, { message_thread_id: state.topics[key] });
  if (topic.close) { try { await api('closeForumTopic', { chat_id: config.group, message_thread_id: state.topics[key] }); } catch { /* Already closed. */ } }
  console.log(`topic ${topic.name} → ${state.topics[key]}`);
  await sleep(800);
}

// Baseline for the watcher: what already exists is not announced.
if (!state.releases) {
  state.releases = {};
  for (const channel of ['stable', 'beta']) {
    const text = await fetchText(`${links.raw}/releases/${channel}.json`).catch(() => null);
    if (text) { try { state.releases[channel] = JSON.parse(Buffer.from(JSON.parse(text).payload, 'base64').toString('utf8')).versionCode; } catch { /* Not readable, announced later. */ } }
  }
}
if (!state.plugins) {
  state.plugins = {};
  const text = await fetchText(`${links.raw}/main/plugins/catalog.json`).catch(() => null);
  if (text) for (const plugin of JSON.parse(text).plugins) state.plugins[plugin.id] = plugin.version;
}
saveState(state);
console.log('setup finished');
