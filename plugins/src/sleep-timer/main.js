// Sleep timer: pause after N minutes or after the current track. Screen with presets + a player button.
export async function activate(api) {
  let endAt = 0, afterTrack = false, trackId = null, timer, refresh;
  const left = () => Math.max(0, Math.ceil((endAt - Date.now()) / 60000));
  const status = () => afterTrack ? 'Пауза после этого трека' : endAt ? `Пауза через ${left()} мин` : 'Таймер выключен';
  async function render() {
    await api.ui.setScreen({ title: 'Таймер сна', content: [
      { type: 'section', title: status(), children: [
        ...[15, 30, 45, 60].map(m => ({ type: 'row', title: `${m} минут`, action: `min:${m}` })),
        { type: 'row', title: 'После этого трека', action: 'track' },
      ] },
      ...(endAt || afterTrack ? [{ type: 'button', title: 'Выключить таймер', action: 'off', variant: 'secondary' }] : []),
    ] });
  }
  function off() { clearTimeout(timer); clearInterval(refresh); timer = refresh = undefined; endAt = 0; afterTrack = false; }
  async function pause(text) { off(); try { await api.player.pause(); await api.ui.toast(text); } catch (error) { api.log(String(error)); } await render(); }
  function startMinutes(minutes) {
    off(); endAt = Date.now() + minutes * 60000;
    timer = setTimeout(() => pause('Таймер сна: пауза'), minutes * 60000);
    refresh = setInterval(render, 30000);
  }
  async function toggleOrOpen() { await api.ui.toast(status()); }
  api.on('track:change', ({ track, previous }) => { if (afterTrack && previous && track && track.id !== trackId) pause('Таймер сна: пауза'); else if (afterTrack && !trackId) trackId = track?.id ?? null; });
  api.ui.onAction(async action => {
    if (action.startsWith('min:')) { startMinutes(Number(action.slice(4))); await api.ui.toast(`Пауза через ${action.slice(4)} мин`); }
    else if (action === 'track') { off(); afterTrack = true; trackId = (await api.player.state()).track?.id ?? null; await api.ui.toast('Пауза после этого трека'); }
    else if (action === 'off') { off(); await api.ui.toast('Таймер выключен'); }
    await render();
  });
  await api.ui.addPlayerButton({ id: 'sleep', title: 'Таймер сна', icon: 'moon', onPress: toggleOrOpen });
  await render();
  return off;
}
