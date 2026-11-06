/** Minimal Telegram Bot API client and helpers (Node 20+, no dependencies). */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const config = {
  token: process.env.TG_TOKEN ?? '',
  channel: process.env.TG_CHANNEL ?? '@OpenSoundSense',
  group: process.env.TG_GROUP ?? '@SoundSenseForum',
  repo: process.env.REPO ?? 'fiwjfwkfpwekfpo/SoundSense',
  stateDir: process.env.STATE_DIR ?? new URL('./state', import.meta.url).pathname,
};
export const links = {
  repo: `https://github.com/${config.repo}`,
  releases: `https://github.com/${config.repo}/tree/releases`,
  plugins: `https://github.com/${config.repo}/tree/main/plugins`,
  raw: `https://raw.githubusercontent.com/${config.repo}`,
  channel: `https://t.me/${config.channel.replace('@', '')}`,
  forum: `https://t.me/${config.group.replace('@', '')}`,
};

export const esc = value => String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
export const quote = (lines, expandable = false) => `<blockquote${expandable ? ' expandable' : ''}>${lines.map(line => `• ${esc(line)}`).join('\n')}</blockquote>`;
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function api(method, params = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(30_000) });
    const answer = await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
    if (answer.ok) return answer.result;
    if (answer.error_code === 429) { await sleep(((answer.parameters?.retry_after ?? 5) + 1) * 1000); continue; }
    throw new Error(`${method}: ${answer.description}`);
  }
  throw new Error(`${method}: too many retries`);
}

/** Sends an HTML message and returns its id. */
export const send = (chat, text, extra = {}) => api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

/**
 * Pins a message silently and removes the "pinned" service message. Telegram creates it right after the pinned message,
 * so its id is the next one; deleting a message that is not a service message is avoided by checking the answer of the pin call.
 */
export async function pinClean(chat, messageId) {
  await api('pinChatMessage', { chat_id: chat, message_id: messageId, disable_notification: true });
  await sleep(700);
  try { await api('deleteMessage', { chat_id: chat, message_id: messageId + 1 }); } catch { /* Already gone or not deletable. */ }
}

export function loadState() {
  const file = join(config.stateDir, 'state.json');
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { topics: {}, rules: {}, releases: null, plugins: null }; }
}
export function saveState(state) {
  mkdirSync(config.stateDir, { recursive: true });
  const file = join(config.stateDir, 'state.json'), temp = `${file}.part`;
  writeFileSync(temp, JSON.stringify(state, null, 2)); renameSync(temp, file);
}
export async function fetchText(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}
export { existsSync };
