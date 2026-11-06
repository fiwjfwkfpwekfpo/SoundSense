// Example plugin: events, own storage, a track menu item, a player button, a screen and a setting.
export async function activate(api) {
  const read = async () => (await api.storage.get('counts')) ?? {};
  const say = async track => {
    if (!track) return;
    const count = (await read())[track.id]?.n ?? 0;
    await api.ui.toast(count ? `«${track.title}»: ${count} раз` : `«${track.title}» ещё не слушал`);
  };
  async function render() {
    const counts = await read();
    const top = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 20);
    await api.ui.setScreen({
      title: 'Счётчик прослушиваний',
      content: [
        { type: 'section', title: 'Чаще всего', children: top.length
          ? top.map((item, index) => ({ type: 'row', title: `${index + 1}. ${item.title}`, subtitle: `${item.artist} · ${item.n} раз` }))
          : [{ type: 'empty', text: 'Пока пусто — включи что-нибудь' }] },
        { type: 'section', title: 'Настройки', children: [
          { type: 'toggle', label: 'Сообщать о 10, 50 и 100 прослушиваниях', value: api.settings.get('milestones') !== false, action: 'milestones' },
        ] },
        { type: 'button', title: 'Сбросить счётчик', action: 'reset', variant: 'secondary' },
      ],
    });
  }
  api.on('track:change', async ({ track }) => {
    if (!track) return;
    const counts = await read(), entry = counts[track.id] ?? { n: 0, title: track.title, artist: track.artist };
    entry.n++; counts[track.id] = entry;
    await api.storage.set('counts', counts);
    if (api.settings.get('milestones') !== false && [10, 50, 100].includes(entry.n)) await api.ui.toast(`«${track.title}» — ${entry.n}-е прослушивание`);
    await render();
  });
  api.ui.onAction(async (action, value) => {
    if (action === 'reset') { await api.storage.set('counts', {}); await api.ui.toast('Счётчик сброшен'); }
    if (action === 'milestones') await api.settings.set('milestones', value);
    await render();
  });
  await api.ui.addTrackMenuItem({ id: 'count', title: 'Сколько раз слушал', icon: 'clock', onSelect: say });
  await api.ui.addPlayerButton({ id: 'count', title: 'Сколько раз слушал', icon: 'clock', onPress: say });
  await render();
}
