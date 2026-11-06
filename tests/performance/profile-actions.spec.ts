import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { goTab, actualApp, importFiles } from '../ui/helpers';
// Manual profiling helper: SS_PROFILE_ACTIONS=1 npm run test:profile
test.use({ trace: 'off', deviceScaleFactor: 3 });
test('profile everyday actions with a large library', async ({ page }) => {
  test.skip(!process.env.SS_PROFILE_ACTIONS, 'manual profiling');
  test.setTimeout(120000);
  await actualApp(page); await importFiles(page, ['one.mp3', 'two.flac']);
  await page.getByRole('button', { name: 'Добавить треки · 2', exact: true }).click();
  await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await page.waitForTimeout(2500);
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('ss_library_v2')!));
  const originals = snapshot.tracks;
  snapshot.tracks = Array.from({ length: 2087 }, (_, i) => i < 2 ? originals[i] : { ...originals[i % 2], id: `stress-${i}`, title: `Library track ${i}`, liked: true });
  snapshot.playlists = snapshot.playlists.map((p: { id: string }) => p.id === 'liked' ? { ...p, trackIds: snapshot.tracks.map((t: { id: string }) => t.id) } : p);
  await page.addInitScript(({ snapshot }) => {
    localStorage.setItem('ss_library_v2', JSON.stringify(snapshot));
    localStorage.setItem('ss_player_v2', JSON.stringify({ queue: snapshot.tracks.map((track: { id: string }, index: number) => ({ id: `queue-${index + 1}`, trackId: track.id })), trackId: snapshot.tracks[0].id, currentIndex: 0, position: 0, playing: false, shuffle: false, repeat: 'off' }));
    localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true, crossfade: 0 }));
  }, { snapshot });
  await page.reload();
  await page.getByTestId('mini-player').getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await page.waitForTimeout(1000);
  if (process.env.SS_HIDE) await page.addStyleTag({ content: `${process.env.SS_HIDE} { display: none !important; }` });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.evaluate(() => { (window as any).__long = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) (window as any).__long.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: false }); });
  const events: any[] = []; cdp.on('Tracing.dataCollected', value => events.push(...value.value)); await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', options: 'record-until-full' });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  const marks: Record<string, number> = {};
  const time = async (name: string, action: () => Promise<void>) => { const start = Date.now(); await action(); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); marks[name] = Date.now() - start; };
  for (const tab of ['Библиотека', 'Поиск', 'Главная', 'Мне нравится', 'Главная']) await time(`tab:${tab}`, () => goTab(page, tab));
  await page.waitForTimeout(3000);
  await time('open player', async () => { await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер' }).click(); });
  for (let i = 0; i < 3; i++) { await time(`next ${i}`, async () => { await page.getByTestId('player').getByRole('button', { name: 'Следующий трек', exact: true }).click(); }); await page.waitForTimeout(700); }
  const frames = (ms: number) => page.evaluate(ms => new Promise<{ max: number; p95: number; long: number }>(resolve => { const values: number[] = []; let previous = performance.now(); const start = previous; function frame(now: number) { values.push(now - previous); previous = now; if (now - start < ms) requestAnimationFrame(frame); else { values.sort((a, b) => a - b); resolve({ max: Math.round(values.at(-1)!), p95: Math.round(values[Math.floor(values.length * .95)]!), long: values.filter(v => v > 50).length }); } } requestAnimationFrame(frame); }), ms);
  for (let i = 0; i < 2; i++) {
    const closing = frames(700); await page.getByTestId('player').getByRole('button', { name: 'Свернуть плеер', exact: true }).click(); console.log('close player', JSON.stringify(await closing));
    await page.waitForTimeout(400);
    if (i === 1) await page.evaluate(() => performance.mark('ss.open.start'));
    const opening = frames(700); await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер' }).click(); console.log('open player', JSON.stringify(await opening));
    if (i === 1) await page.evaluate(() => performance.mark('ss.open.end'));
    await page.waitForTimeout(400);
  }
  const idle = await page.evaluate(() => new Promise<{ busy: number; p95: number }>(resolve => { let busy = 0; const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) busy += entry.duration; }); observer.observe({ type: 'longtask' }); const frames: number[] = []; let previous = performance.now(); const start = previous; function frame(now: number) { frames.push(now - previous); previous = now; if (now - start < 4000) requestAnimationFrame(frame); else { observer.disconnect(); frames.sort((a, b) => a - b); resolve({ busy: Math.round(busy), p95: Math.round(frames[Math.floor(frames.length * .95)]!) }); } } requestAnimationFrame(frame); }));
  console.log('idle playback in player (4 s)', JSON.stringify(idle));
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync('/tmp/ss-actions.cpuprofile', JSON.stringify(profile));
  await cdp.send('Tracing.end'); await new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve)); writeFileSync('/tmp/ss-actions.trace.json', JSON.stringify(events));
  const long = await page.evaluate(() => (window as any).__long);
  console.log('marks', JSON.stringify(marks)); console.log('long tasks', JSON.stringify(long));
});
