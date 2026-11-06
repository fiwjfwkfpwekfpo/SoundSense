import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { goTab, actualApp, importFiles } from '../ui/helpers';
// Trace screenshots and DOM snapshots distort the frame timings being measured.
test.use({ trace: 'off' });
const first = 'Тест локального импорта — длинное название трека';
test('default tab changes keep a single route and avoid long frames under CPU throttling', async ({ page }, testInfo) => {
  await actualApp(page); const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => { (window as any).__frames = []; let previous = performance.now(); (window as any).__record = true; function frame(now: number) { (window as any).__frames.push(now - previous); previous = now; if ((window as any).__record) requestAnimationFrame(frame); } requestAnimationFrame(frame); });
  for (const tab of ['Библиотека', 'Поиск', 'Настройки', 'Главная']) { await goTab(page, tab); await expect(page.locator('[data-route]')).toHaveCount(1); await page.waitForTimeout(180); }
  const timing = await page.evaluate(() => { (window as any).__record = false; const values = ((window as any).__frames as number[]).slice(3).sort((a,b) => a-b); return { p95: values[Math.floor(values.length * .95)], max: Math.max(...values), frames: values.length }; });
  await testInfo.attach('CPU 4x frame timings', { body: JSON.stringify(timing), contentType: 'application/json' }); expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(220); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('real audio: first crossfade second stays responsive with CPU throttling', async ({ page }, testInfo) => {
  await actualApp(page); await importFiles(page, ['one.mp3', 'two.flac']); await page.getByRole('button', { name: 'Добавить треки · 2', exact: true }).click(); await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const profile = !!process.env.SS_PROFILE; const events: unknown[] = [];
  if (profile) { cdp.on('Tracing.dataCollected', value => events.push(...value.value)); await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,cc,gpu', options: 'record-until-full' }); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.getByRole('button', { name: `Воспроизвести: ${first}, SoundSense Test`, exact: true }).click();
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер' }).click();
  const timing = await page.evaluate(() => new Promise<{ p95: number; max: number; frames: number }>(resolve => {
    let start = 0, previous = 0; const intervals: number[] = [];
    function frame(now: number) { if (document.querySelector('[data-crossfade]') && !start) { start = previous = now; performance.mark('ss.crossfade.start'); } if (start && now > previous) { intervals.push(now - previous); previous = now; } if (start && now - start >= 1100) { performance.mark('ss.crossfade.end'); intervals.sort((a,b) => a-b); resolve({ p95: intervals[Math.floor(intervals.length * .95)]!, max: Math.max(...intervals), frames: intervals.length }); } else requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }));
  if (profile) { writeFileSync('/tmp/ss-crossfade.cpuprofile', JSON.stringify((await cdp.send('Profiler.stop')).profile)); await cdp.send('Tracing.end'); await new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve)); writeFileSync('/tmp/ss-crossfade.trace.json', JSON.stringify(events)); }
  await testInfo.attach('real audio crossfade first second CPU 4x', { body: JSON.stringify(timing), contentType: 'application/json' }); console.log('real crossfade timing', timing);
  expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(180); expect(timing.frames).toBeGreaterThan(20);
});

test.describe('large library on a high-resolution display', () => {
  test.use({ deviceScaleFactor: 3 });
  test('the complete crossfade remains responsive with 2087 entries and CPU 4x', async ({ page }, testInfo) => {
    test.setTimeout(45000);
    await actualApp(page); await importFiles(page, ['one.mp3', 'two.flac']);
    await page.getByRole('button', { name: 'Добавить треки · 2', exact: true }).click();
    await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
    await page.waitForTimeout(2500);
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('ss_library_v2')!));
    const originals = snapshot.tracks;
    // Shared real audio fixtures isolate the cost of library/queue size; this
    // does not claim to simulate 2087 independent network downloads.
    snapshot.tracks = Array.from({ length: 2087 }, (_, i) => i < 2 ? originals[i] : { ...originals[i % 2], id: `stress-${i}`, title: `Library track ${i}` });
    await page.addInitScript(({ snapshot }) => {
      localStorage.setItem('ss_library_v2', JSON.stringify(snapshot));
      localStorage.setItem('ss_player_v2', JSON.stringify({ queue: snapshot.tracks.map((track: { id: string }, index: number) => ({ id: `queue-${index + 1}`, trackId: track.id })), trackId: snapshot.tracks[0].id, currentIndex: 0, position: 0, playing: false, shuffle: false, repeat: 'off' }));
    }, { snapshot });
    await page.reload();
    const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.getByTestId('mini-player').getByRole('button', { name: 'Воспроизвести', exact: true }).click();
    await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
    const timing = await page.evaluate(() => new Promise<{ p95: number; max: number; frames: number }>(resolve => {
      let start = 0, previous = 0; const intervals: number[] = [];
      function frame(now: number) {
        if (!start && document.querySelector('[data-crossfade]')) start = previous = now;
        if (start && now > previous) { intervals.push(now - previous); previous = now; }
        if (start && now - start >= 3100) { intervals.sort((a, b) => a - b); resolve({ p95: intervals[Math.floor(intervals.length * .95)]!, max: Math.max(...intervals), frames: intervals.length }); } else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }));
    console.log('complete crossfade / 2087 / DPR 3 / CPU 4x', timing);
    await testInfo.attach('complete crossfade large library frame timings', { body: JSON.stringify(timing), contentType: 'application/json' });
    expect(timing.p95).toBeLessThan(85); expect(timing.max).toBeLessThan(180); expect(timing.frames).toBeGreaterThan(100);
  });
});

