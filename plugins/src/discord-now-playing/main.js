// Posts "now playing" to a Discord channel through a webhook (HTTPS only, no Discord login needed).
// Discord Rich Presence needs a local socket, which the plugin sandbox deliberately does not have.
const HOOK = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export function activate(api) {
  let timer, last = '';
  const clear = () => { clearTimeout(timer); timer = undefined; };
  async function send(track) {
    const url = String(api.settings.get('webhook') ?? '').trim();
    if (!HOOK.test(url)) return;
    const response = await api.net.fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: String(api.settings.get('name') || 'SoundSense').slice(0, 80),
        allowed_mentions: { parse: [] },
        embeds: [{ title: track.title.slice(0, 250), description: `**${track.artist.slice(0, 200)}**${track.album ? `\n${track.album.slice(0, 200)}` : ''}`, color: 0x8b5cf6, footer: { text: `Сейчас играет · ${track.source}` } }],
      }),
    });
    if (!response.ok) await api.ui.toast(`Discord: ошибка ${response.status}`);
  }
  function arm(track) {
    clear();
    if (!track || track.id === last) return;
    timer = setTimeout(async () => {
      try { const state = await api.player.state(); if (state.playing && state.track?.id === track.id) { last = track.id; await send(track); } } catch (error) { api.log(String(error)); }
    }, Number(api.settings.get('delay') || 20) * 1000);
  }
  api.on('track:change', ({ track }) => arm(track));
  api.on('player:pause', clear);
  api.on('player:play', ({ track }) => arm(track));
  return () => clear();
}
