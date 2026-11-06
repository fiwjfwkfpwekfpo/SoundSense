// Scrobbles to ListenBrainz: a "playing_now" ping at the start and a "single" listen after half the track (max 4 min).
export function activate(api) {
  let tick, played = 0, current, counted = false;
  const stop = () => { clearInterval(tick); tick = undefined; };
  async function post(type, track, listenedAt) {
    const token = String(api.settings.get('token') ?? '').trim();
    if (!token) return false;
    const meta = { track_name: track.title, artist_name: track.artist, ...(track.album ? { release_name: track.album } : {}), additional_info: { media_player: 'SoundSense', duration: Math.round(track.duration) } };
    const payload = [{ ...(listenedAt ? { listened_at: listenedAt } : {}), track_metadata: meta }];
    const response = await api.net.fetch('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ listen_type: type, payload }),
    });
    if (response.status === 401) { await api.ui.toast('ListenBrainz: неверный токен'); return false; }
    return response.ok;
  }
  function run() {
    stop();
    tick = setInterval(async () => {
      if (!current || counted) return stop();
      played++;
      const need = Math.min(240, Math.max(30, current.duration / 2));
      if (played >= need) { counted = true; stop(); try { await post('single', current, Math.floor(Date.now() / 1000) - played); } catch (error) { api.log(String(error)); } }
    }, 1000);
  }
  api.on('track:change', async ({ track }) => {
    stop(); current = track ?? undefined; played = 0; counted = false;
    if (!track) return;
    run();
    if (api.settings.get('nowPlaying') !== false) { try { await post('playing_now', track); } catch (error) { api.log(String(error)); } }
  });
  api.on('player:pause', stop);
  api.on('player:play', () => { if (current && !counted) run(); });
  return stop;
}
